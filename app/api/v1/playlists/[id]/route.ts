import { type NextRequest } from 'next/server'
import { PAYMENT } from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist, nextFreeSpot, publicTerms, spotsRemaining } from '@/lib/store'
import { priceFor } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playlist = getPlaylist(id)
  if (!playlist) {
    return error(404, 'playlist_not_found', `no playlist with id "${id}"`)
  }

  const base = baseUrl(req)
  const next = nextFreeSpot(playlist)
  const { tiers, termMultipliers } = publicTerms()

  return json({
    id: playlist.id,
    name: playlist.name,
    curator: playlist.curator,
    cycle: playlist.cycle,
    status: playlist.status,
    spots_per_cycle: playlist.spotsPerCycle,
    spots_sold: playlist.sold.length,
    spots_remaining: spotsRemaining(playlist),
    next_free_spot: next,
    pricing: {
      currency: 'USDC',
      decimals: PAYMENT.decimals,
      tiers,
      term_multipliers: termMultipliers,
      note: 'Price is snapshotted at payment. A paid spot is never repriced.',
    },
    payment: {
      protocol: 'x402',
      status: 'not_enabled_yet',
      network: PAYMENT.network,
      chain: PAYMENT.chain,
      asset: PAYMENT.asset,
      facilitator: PAYMENT.facilitator,
    },
    spotify: {
      playlist_id: playlist.spotifyPlaylistId,
      followers: playlist.spotifyFollowers,
      note: 'Curator-owned playlist only. Not a Spotify editorial playlist. No play or royalty data is available from the Spotify Web API.',
    },
    sold: playlist.sold.map((s) => ({
      spot: s.spot,
      amount: s.amount,
      currency: 'USDC',
      term: s.term,
      added_at: s.addedAt,
      receipt_url: `${base}/api/v1/receipts/${s.receiptId}`,
    })),
    links: {
      self: `${base}/api/v1/playlists/${playlist.id}`,
      quote_next: `${base}/api/v1/playlists/${playlist.id}/quote?next=1`,
      quote_spot: `${base}/api/v1/playlists/${playlist.id}/quote?spot={n}`,
      buy_spot: `${base}/api/v1/playlists/${playlist.id}/spots/{n}`,
    },
    next_action: next
      ? {
          method: 'GET',
          url: `${base}/api/v1/playlists/${playlist.id}/quote?next=1`,
          description: 'Quote the next free spot, then POST to the returned buy URL.',
        }
      : {
          method: null,
          url: null,
          description: 'Cycle is full. Next-cycle waitlist is not implemented yet.',
        },
  })
}
