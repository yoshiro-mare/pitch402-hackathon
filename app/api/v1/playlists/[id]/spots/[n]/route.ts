import { type NextRequest } from 'next/server'
import {
  DEFAULT_TERM,
  FAKE_PAY_HEADER,
  PAYMENT,
  fakePayAllowed,
  isValidTerm,
  type Term,
} from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { priceFor, serializePrice } from '@/lib/pricing'
import { SpotTakenError, getPlaylist, isTaken, nextFreeSpot, sellSpot, type Playlist, type Receipt } from '@/lib/store'
import { normalizeTrackUri } from '@/lib/track'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params
  const base = baseUrl(req)

  const playlist = getPlaylist(id)
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

  const body = await readBody(req)
  if (body === null) {
    return error(400, 'invalid_body', 'body must be JSON')
  }

  const term = body.term === undefined ? DEFAULT_TERM : body.term
  if (typeof term !== 'string' || !isValidTerm(term)) {
    return error(400, 'invalid_term', 'term must be one of cycle, 3m, 1y', { got: body.term })
  }

  // Taken spots are rejected before payment is even described.
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

  // Price snapshot. Everything below stores this exact amount; it is never
  // recomputed, so a later tier change cannot reprice a paid spot.
  const price = priceFor(spot, term)

  const fakePayHeader = req.headers.get(FAKE_PAY_HEADER)
  const wantsFakePay = fakePayHeader === '1'

  if (!wantsFakePay) {
    return paymentRequiredResponse(base, playlist, spot, term, price)
  }

  if (!fakePayAllowed()) {
    return error(403, 'fake_pay_disabled', 'fake payments are disabled in this environment', {
      hint: 'Pay with x402 instead.',
    })
  }

  let receipt: Receipt
  try {
    receipt = sellSpot(playlist, {
      spot,
      amountAtomic: price.amountAtomic,
      amount: price.amount,
      term,
      trackUri,
      buyer,
      paymentMethod: 'fake',
      paymentReference: null,
    })
  } catch (err) {
    // Lost a race against another buyer between the check above and the write.
    if (err instanceof SpotTakenError) {
      return takenResponse(base, playlist, spot, term)
    }
    throw err
  }

  return json(serializeReceipt(base, receipt, playlist), {
    status: 201,
    headers: { location: `${base}/api/v1/receipts/${receipt.id}` },
  })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const raw = await req.text()
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
      error: {
        code: 'spot_taken',
        message: `spot ${spot} is already taken`,
      },
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

/**
 * HTTP 402 with x402-shaped payment requirements. Hand-rolled on purpose —
 * the real x402 SDK lands in the next pass, and this keeps the response shape
 * visible while we demo.
 */
function paymentRequiredResponse(
  base: string,
  playlist: Playlist,
  spot: number,
  term: Term,
  price: ReturnType<typeof priceFor>,
): Response {
  const resource = `${base}/api/v1/playlists/${playlist.id}/spots/${spot}`
  return json(
    {
      x402Version: 1,
      error: 'payment_required',
      accepts: [
        {
          scheme: 'exact',
          network: PAYMENT.network,
          chain: PAYMENT.chain,
          maxAmountRequired: price.amountAtomic,
          asset: PAYMENT.assetAddress,
          asset_symbol: PAYMENT.asset,
          asset_decimals: PAYMENT.decimals,
          asset_address_verified: PAYMENT.assetAddressVerified,
          payTo: PAYMENT.payTo,
          resource,
          description: `Pitch402 spot ${spot} on "${playlist.name}" (cycle ${playlist.cycle}, term ${term})`,
          mimeType: 'application/json',
          maxTimeoutSeconds: 120,
          facilitator: PAYMENT.facilitator,
        },
      ],
      quote: {
        playlist_id: playlist.id,
        cycle: playlist.cycle,
        spot,
        term,
        amount: price.amount,
        amount_atomic: price.amountAtomic,
        currency: price.currency,
        decimals: price.decimals,
      },
      warnings: [
        ...(PAYMENT.payTo ? [] : ['payTo is not configured — set PITCH402_PAY_TO before accepting real payments.']),
        ...(PAYMENT.assetAddressVerified
          ? []
          : ['The USDC asset address is unverified — confirm it on a Base Sepolia explorer before paying.']),
        'The real x402 SDK is not wired up yet. This body describes the intended payment only.',
      ],
      fake_payment: fakePayAllowed()
        ? {
            header: 'X-PITCH402-FAKE-PAY: 1',
            description: 'Demo shortcut. Settles the buy with no wallet and no onchain transfer.',
          }
        : null,
      note: 'Price is snapshotted at payment. A paid spot is never repriced.',
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
      network: PAYMENT.network,
      chain: PAYMENT.chain,
      settled: receipt.paymentMethod === 'x402',
      note:
        receipt.paymentMethod === 'fake'
          ? 'DEMO ONLY. No USDC moved and nothing was settled onchain.'
          : 'Settled via x402.',
    },
    added_at: receipt.addedAt,
    spotify: {
      status: 'not_added',
      note: 'Spotify write is not implemented yet. The track is recorded against the spot only.',
    },
    next_free_spot: nextFreeSpot(playlist),
    playlist_url: `${base}/api/v1/playlists/${playlist.id}`,
  }
}
