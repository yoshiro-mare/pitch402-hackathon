import { NextRequest, NextResponse } from 'next/server'
import { withX402 } from '@x402/next'
import {
  DEFAULT_TERM,
  isValidTerm,
  networkFor,
  type NetworkConfig,
  type Term,
} from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { priceFor, serializePrice, type Price } from '@/lib/pricing'
import {
  SpotTakenError,
  getPlaylist,
  isTaken,
  nextFreeSpot,
  releaseSpot,
  sellSpot,
  type Playlist,
  type Receipt,
} from '@/lib/store'
import { normalizeTrackUri } from '@/lib/track'
import { placeTrack, serializePlacement, unplaceTrack } from '@/lib/placement'
import { acceptsList, resolveNetwork } from '@/lib/networks'
import {
  assetPrice,
  canSettle,
  ensureX402Ready,
  payTo,
  rememberPendingSettlement,
  resourceServer,
  x402Enabled,
} from '@/lib/x402'

export const dynamic = 'force-dynamic'

/** Must match the served path exactly or withX402 skips payment protection. */
const ROUTE_PATTERN = '/api/v1/playlists/[id]/spots/[n]'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params
  const base = baseUrl(req)

  const playlist = await getPlaylist(id)
  if (!playlist) {
    return error(404, 'playlist_not_found', `no playlist with id "${id}"`)
  }

  if (!/^\d+$/.test(n)) {
    return error(400, 'invalid_spot', 'spot must be a whole number', { got: n })
  }
  const spot = Number(n)
  if (spot < 1 || spot > playlist.spotsPerCycle) {
    return error(400, 'invalid_spot', `spot must be between 1 and ${playlist.spotsPerCycle}`, { got: spot })
  }

  if (playlist.status !== 'open') {
    return error(409, 'cycle_closed', `this cycle is ${playlist.status}`, {
      next_action: null,
      message: 'Next-cycle waitlist is not implemented yet.',
    })
  }

  // Read the body once here: the x402 wrapper may also inspect the request, and
  // a body can only be consumed a single time.
  const raw = await req.text()
  const body = parseBody(raw)
  if (body === null) {
    return error(400, 'invalid_body', 'body must be JSON')
  }

  // Term can come from the query string or the body. The query string wins,
  // because the paid flow prices the request before the body is in play.
  const queryTerm = req.nextUrl.searchParams.get('term')
  const bodyTerm = body.term === undefined ? null : body.term
  if (bodyTerm !== null && typeof bodyTerm !== 'string') {
    return error(400, 'invalid_term', 'term must be one of cycle, 3m, 1y', { got: bodyTerm })
  }
  if (queryTerm !== null && bodyTerm !== null && queryTerm !== bodyTerm) {
    return error(400, 'term_conflict', 'term in the query string and the body disagree', {
      query: queryTerm,
      body: bodyTerm,
      hint: 'Send term in the query string for paid requests.',
    })
  }
  const termValue = queryTerm ?? bodyTerm ?? DEFAULT_TERM
  if (!isValidTerm(termValue)) {
    return error(400, 'invalid_term', 'term must be one of cycle, 3m, 1y', { got: termValue })
  }
  const term: Term = termValue

  const resolvedNetwork = resolveNetwork(req.nextUrl.searchParams.get('network'), body.network)
  if ('error' in resolvedNetwork) {
    return error(
      400,
      resolvedNetwork.error === 'conflict' ? 'network_conflict' : 'invalid_network',
      resolvedNetwork.error === 'conflict'
        ? 'network in the query string and the body disagree'
        : 'network must be one of base-sepolia, hsk-testnet',
      { got: resolvedNetwork.got },
    )
  }
  const network = networkFor(resolvedNetwork.network)

  // Reject a taken spot before any payment is described or charged.
  if (isTaken(playlist, spot)) {
    return takenResponse(base, playlist, spot, term)
  }

  const trackUri = normalizeTrackUri(body.track_uri)
  if (!trackUri) {
    return error(400, 'invalid_track_uri', 'track_uri must be a Spotify track URI, URL, or 22-character track id', {
      got: body.track_uri ?? null,
      example: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    })
  }

  const buyer = typeof body.buyer === 'string' && body.buyer.trim() ? body.buyer.trim() : null

  // Price snapshot. Stored as paid and never recomputed, so a later tier change
  // cannot reprice a spot that someone already bought.
  const price = priceFor(spot, term)

  const purchase = { spot, trackUri, buyer, term, price, network }

  // Advertised network with no facilitator: say so plainly instead of issuing
  // payment requirements nobody can settle.
  if (!canSettle(network)) {
    return settlementUnavailableResponse(base, playlist, purchase)
  }

  // No payout address configured — describe the payment we would want rather
  // than handing x402 an unusable route config.
  if (!x402Enabled()) {
    return unconfiguredPaymentResponse(base, playlist, purchase)
  }

  return paidPost(req, raw, base, playlist, purchase)
}

type Purchase = {
  spot: number
  trackUri: string
  buyer: string | null
  term: Term
  price: Price
  network: NetworkConfig
}

/**
 * The real x402 path. withX402 answers 402 with signed payment requirements
 * when no payment is attached, verifies an attached payment before the handler
 * runs, and settles only after the handler returns a status below 400 — so a
 * spot that gets taken in the meantime returns 409 and nothing is charged.
 */
async function paidPost(
  req: NextRequest,
  raw: string,
  base: string,
  playlist: Playlist,
  purchase: Purchase,
): Promise<Response> {
  const address = payTo()
  if (!address) return unconfiguredPaymentResponse(base, playlist, purchase)

  try {
    await ensureX402Ready()
  } catch (err) {
    return error(503, 'facilitator_unavailable', 'could not reach the x402 facilitator', {
      facilitator: purchase.network.facilitator,
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  const resource = `${base}/api/v1/playlists/${playlist.id}/spots/${purchase.spot}`
  let receiptId: string | null = null

  const handler = async (): Promise<NextResponse> => {
    // Re-check under the verified payment: another buyer may have taken it.
    if (isTaken(playlist, purchase.spot)) {
      const taken = await takenResponse(base, playlist, purchase.spot, purchase.term).json()
      return NextResponse.json(taken, { status: 409 })
    }
    const response = await settle(base, playlist, purchase)
    const payload = (await response.clone().json()) as { receipt_id?: string }
    receiptId = payload.receipt_id ?? null
    if (receiptId) await rememberPendingSettlement(resource, receiptId)
    return NextResponse.json(payload, { status: response.status })
  }

  const wrapped = withX402(
    handler,
    {
      [ROUTE_PATTERN]: {
        accepts: {
          scheme: 'exact',
          network: purchase.network.chain,
          payTo: address,
          price: assetPrice(purchase.network, purchase.price.amountAtomic),
          maxTimeoutSeconds: 120,
        },
        resource,
        description: `Pitch402 spot ${purchase.spot} on "${playlist.name}" (cycle ${playlist.cycle}, term ${purchase.term}, ${purchase.network.name})`,
        mimeType: 'application/json',
        unpaidResponseBody: () => ({
          contentType: 'application/json',
          body: quoteBody(base, playlist, purchase, address),
        }),
        // Payment verified but settlement failed: give the spot back rather
        // than holding it against money that never moved.
        settlementFailedResponseBody: (_context, result) => {
          // Money never moved, so the track must not stay on the playlist
          // either. Best effort, and the sale is released regardless.
          if (receiptId) {
            void unplaceTrack(playlist, purchase.trackUri)
            void releaseSpot(playlist.id, receiptId)
          }
          return {
            contentType: 'application/json',
            body: {
              error: {
                code: 'settlement_failed',
                message: 'Payment did not settle. The spot was released and you were not charged.',
                reason: result.errorReason ?? null,
              },
              ...quoteBody(base, playlist, purchase, address),
            },
          }
        },
      },
    },
    resourceServer,
    undefined,
    undefined,
    false,
  )

  // The body was already consumed above, so hand the wrapper a fresh request.
  const replay = new NextRequest(req.url, { method: 'POST', headers: req.headers, body: raw })
  return wrapped(replay)
}

/** Take the spot and build the receipt, once a payment has been verified. */
async function settle(base: string, playlist: Playlist, purchase: Purchase): Promise<Response> {
  let receipt: Receipt
  try {
    receipt = await sellSpot(playlist, {
      spot: purchase.spot,
      amountAtomic: purchase.price.amountAtomic,
      amount: purchase.price.amount,
      term: purchase.term,
      trackUri: purchase.trackUri,
      buyer: purchase.buyer,
      network: purchase.network.id,
      paymentMethod: 'x402',
      paymentReference: null,
    })
  } catch (err) {
    if (err instanceof SpotTakenError) {
      return takenResponse(base, playlist, purchase.spot, purchase.term)
    }
    throw err
  }

  // The payment is good and the spot is taken. Now do the thing the buyer
  // actually paid for: put the track on the curator's Spotify playlist. This
  // is awaited so the response reports what really happened rather than a
  // promise to try later, and it never throws — a failed write leaves the spot
  // paid for and retryable.
  await placeTrack(playlist, receipt)

  return json(serializeReceipt(base, receipt, playlist), {
    status: 201,
    headers: { location: `${base}/api/v1/receipts/${receipt.id}` },
  })
}

function parseBody(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function takenResponse(base: string, playlist: Playlist, spot: number, term: Term): Response {
  const next = nextFreeSpot(playlist)
  return json(
    {
      error: { code: 'spot_taken', message: `spot ${spot} is already taken` },
      playlist_id: playlist.id,
      cycle: playlist.cycle,
      spot,
      available: false,
      next_free_spot: next,
      next_price: next ? serializePrice(priceFor(next, term)) : null,
      next_action: next
        ? {
            method: 'POST',
            url: `${base}/api/v1/playlists/${playlist.id}/spots/${next}`,
            quote_url: `${base}/api/v1/playlists/${playlist.id}/quote?spot=${next}&term=${term}`,
          }
        : null,
    },
    { status: 409 },
  )
}

/** Quote details attached to the 402 body alongside x402's own requirements. */
function quoteBody(base: string, playlist: Playlist, purchase: Purchase, address: string) {
  return {
    playlist_id: playlist.id,
    playlist_name: playlist.name,
    cycle: playlist.cycle,
    spot: purchase.spot,
    term: purchase.term,
    price: serializePrice(purchase.price),
    payment: {
      protocol: 'x402',
      selected_network: purchase.network.id,
      settlement: purchase.network.settlement,
      pay_to: address,
      // Both chains, priced identically in USDC units. Choose with
      // ?network=<id> or a "network" field in the body.
      accepts: acceptsList(purchase.price, address),
    },
    quote_url: `${base}/api/v1/playlists/${playlist.id}/quote?spot=${purchase.spot}&term=${purchase.term}&network=${purchase.network.id}`,
    note: 'Price is snapshotted at payment. A paid spot is never repriced.',
  }
}

/** 402 for when PITCH402_PAY_TO is unset: x402 cannot quote without a payee. */
function unconfiguredPaymentResponse(base: string, playlist: Playlist, purchase: Purchase): Response {
  return json(
    {
      x402Version: 2,
      error: 'payment_unavailable',
      message: 'This server has no payout address configured, so it cannot accept x402 payments yet.',
      hint: 'Set PITCH402_PAY_TO to an EVM address and restart. The same address works on both testnets.',
      ...quoteBody(base, playlist, purchase, '0x0000000000000000000000000000000000000000'),
    },
    { status: 402 },
  )
}

/**
 * 402 for a network we advertise but cannot settle on. The spot is still for
 * sale — just not payable here yet — so the response names what will work
 * rather than issuing requirements no facilitator would honour.
 */
function settlementUnavailableResponse(base: string, playlist: Playlist, purchase: Purchase): Response {
  return json(
    {
      x402Version: 2,
      error: 'settlement_unavailable_on_network',
      message: `${purchase.network.name} is advertised for network coverage, but no x402 facilitator is confirmed for ${purchase.network.chain}, so a payment here cannot be settled yet.`,
      hint: 'Buy on base-sepolia for a real x402 payment.',
      ...quoteBody(base, playlist, purchase, payTo() ?? '0x0000000000000000000000000000000000000000'),
    },
    { status: 402 },
  )
}

function serializeReceipt(base: string, receipt: Receipt, playlist: Playlist) {
  return {
    receipt_id: receipt.id,
    receipt_url: `${base}/api/v1/receipts/${receipt.id}`,
    playlist_id: receipt.playlistId,
    playlist_name: playlist.name,
    cycle: receipt.cycle,
    spot: receipt.spot,
    term: receipt.term,
    track_uri: receipt.trackUri,
    buyer: receipt.buyer,
    amount_paid: receipt.amount,
    amount_paid_atomic: receipt.amountAtomic,
    currency: receipt.currency,
    decimals: receipt.decimals,
    payment: {
      method: receipt.paymentMethod,
      reference: receipt.paymentReference,
      network: receipt.network,
      network_name: networkFor(receipt.network).name,
      chain: networkFor(receipt.network).chain,
      settled: receipt.settled,
      note: 'Verified by the x402 facilitator. Settlement completes after this response; the transaction hash lands on the receipt and in the PAYMENT-RESPONSE header.',
    },
    added_at: receipt.addedAt,
    spotify: serializePlacement(receipt.placement, playlist, base, receipt.id),
    next_free_spot: nextFreeSpot(playlist),
    playlist_url: `${base}/api/v1/playlists/${playlist.id}`,
  }
}
