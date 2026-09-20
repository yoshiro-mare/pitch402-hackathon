import { type NextRequest } from 'next/server'
import { DEFAULT_TERM, isValidTerm, networkFor } from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist, isTaken, nextFreeSpot } from '@/lib/store'
import { acceptsList, resolveNetwork } from '@/lib/networks'
import { priceFor, serializePrice } from '@/lib/pricing'
import { payTo } from '@/lib/x402'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playlist = await getPlaylist(id)
  if (!playlist) {
    return error(404, 'playlist_not_found', `no playlist with id "${id}"`)
  }

  const base = baseUrl(req)
  const search = req.nextUrl.searchParams

  const termParam = search.get('term') ?? DEFAULT_TERM
  if (!isValidTerm(termParam)) {
    return error(400, 'invalid_term', `term must be one of cycle, 3m, 1y`, { got: termParam })
  }

  const resolved = resolveNetwork(search.get('network'), undefined)
  if ('error' in resolved) {
    return error(400, 'invalid_network', 'network must be one of base-sepolia, hsk-testnet', {
      got: resolved.got,
    })
  }
  const network = networkFor(resolved.network)

  const wantsNext = search.get('next') === '1'
  const spotParam = search.get('spot')
  if (!wantsNext && spotParam === null) {
    return error(400, 'missing_spot', 'pass ?spot=N for a specific spot or ?next=1 for the next free spot')
  }

  let spot: number
  if (spotParam !== null) {
    if (!/^\d+$/.test(spotParam)) {
      return error(400, 'invalid_spot', 'spot must be a whole number', { got: spotParam })
    }
    spot = Number(spotParam)
    if (spot < 1 || spot > playlist.spotsPerCycle) {
      return error(400, 'invalid_spot', `spot must be between 1 and ${playlist.spotsPerCycle}`, { got: spot })
    }
  } else {
    const next = nextFreeSpot(playlist)
    if (next === null) {
      return json(
        {
          playlist_id: playlist.id,
          cycle: playlist.cycle,
          available: false,
          reason: 'cycle_full',
          next_action: null,
          message: 'All spots in this cycle are sold. Next-cycle waitlist is not implemented yet.',
        },
        { status: 409 },
      )
    }
    spot = next
  }

  const taken = isTaken(playlist, spot)
  const price = priceFor(spot, termParam)
  const buyUrl = `${base}/api/v1/playlists/${playlist.id}/spots/${spot}`

  if (taken) {
    const next = nextFreeSpot(playlist)
    return json(
      {
        playlist_id: playlist.id,
        cycle: playlist.cycle,
        spot,
        available: false,
        reason: 'spot_taken',
        next_free_spot: next,
        next_price: next ? serializePrice(priceFor(next, termParam)) : null,
        next_action: next
          ? {
              method: 'POST',
              url: `${base}/api/v1/playlists/${playlist.id}/spots/${next}`,
              quote_url: `${base}/api/v1/playlists/${playlist.id}/quote?spot=${next}&term=${termParam}`,
            }
          : null,
      },
      { status: 409 },
    )
  }

  return json({
    playlist_id: playlist.id,
    cycle: playlist.cycle,
    spot,
    available: true,
    term: termParam,
    price: {
      currency: price.currency,
      decimals: price.decimals,
      tier_base: price.base,
      multiplier: price.multiplier,
      amount: price.amount,
      amount_atomic: price.amountAtomic,
    },
    payment: {
      protocol: 'x402',
      selected_network: network.id,
      settlement: network.settlement,
      pay_to: payTo(),
      // Both chains, priced identically in USDC units. Pick one with
      // ?network=<id> or a "network" field in the buy request body.
      accepts: acceptsList(price, payTo()),
    },
    next_action: {
      method: 'POST',
      url: `${buyUrl}?network=${network.id}&term=${termParam}`,
      body: {
        track_uri: 'spotify:track:<id>',
        term: termParam,
        network: network.id,
      },
      description:
        network.settlement === 'live'
          ? 'POST to this URL to buy the spot. Without a payment it answers HTTP 402 with x402 payment requirements.'
          : 'POST to this URL to buy the spot. This network has no confirmed facilitator, so settlement is unavailable — switch to base-sepolia to pay.',
    },
    note: 'Quote only. The price charged is snapshotted at payment and a paid spot is never repriced.',
  })
}
