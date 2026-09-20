import { type NextRequest } from 'next/server'
import { USDC_DECIMALS } from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist, nextFreeSpot, publicTerms, spotsRemaining, storageBackend } from '@/lib/store'
import { priceFor } from '@/lib/pricing'
import { networkSummaries } from '@/lib/networks'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playlist = await getPlaylist(id)
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
    // Which backend answered. On 'supabase' the one-buyer-per-spot rule is a
    // unique constraint and holds across instances; on 'memory' it only holds
    // inside this process.
    storage: storageBackend(),
    pricing: {
      currency: 'USDC',
      decimals: USDC_DECIMALS,
      tiers,
      term_multipliers: termMultipliers,
      note: 'Price is snapshotted at payment. A paid spot is never repriced.',
    },
    payment: {
      protocol: 'x402',
      default_network: 'base-sepolia',
      networks: networkSummaries(),
    },
    spotify: {
      connected: playlist.spotifyPlaylistId !== null,
      playlist_id: playlist.spotifyPlaylistId,
      playlist_name: playlist.spotifyPlaylistName,
      playlist_url: playlist.spotifyPlaylistUrl,
      owner_id: playlist.spotifyOwnerId,
      followers: playlist.spotifyFollowers,
      connected_at: playlist.spotifyConnectedAt,
      items_before_pitch402: playlist.spotifyBaseOffset,
      tracks_placed: playlist.sold.filter((s) => s.placement.status === 'placed').length,
      connect_url:
        playlist.spotifyPlaylistId === null
          ? `${base}/api/v1/curator/spotify/connect?playlist=${playlist.id}`
          : null,
      note: playlist.spotifyPlaylistId
        ? 'Paid spots are written to this curator-owned playlist. Not a Spotify editorial playlist. The Spotify Web API reports no plays, saves, or royalties for a playlist, so none are shown.'
        : 'No curator playlist is connected yet, so buying a spot records the sale but writes nothing to Spotify.',
    },
    sold: playlist.sold.map((s) => ({
      spot: s.spot,
      amount: s.amount,
      currency: 'USDC',
      term: s.term,
      network: s.network,
      added_at: s.addedAt,
      track_uri: s.trackUri,
      spotify_status: s.placement.status,
      spotify_position: s.placement.position,
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
