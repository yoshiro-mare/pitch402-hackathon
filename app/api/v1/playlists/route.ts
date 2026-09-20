import { type NextRequest } from 'next/server'
import { baseUrl, json } from '@/lib/http'
import { listPlaylists, nextFreeSpot, spotsRemaining } from '@/lib/store'
import { priceFor } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const playlists = (await listPlaylists()).map((playlist) => {
    const next = nextFreeSpot(playlist)
    return {
      id: playlist.id,
      name: playlist.name,
      curator: playlist.curator,
      cycle: playlist.cycle,
      status: playlist.status,
      spots_per_cycle: playlist.spotsPerCycle,
      spots_sold: playlist.sold.length,
      spots_remaining: spotsRemaining(playlist),
      next_free_spot: next,
      next_price: next ? priceFor(next).amount : null,
      currency: 'USDC',
      url: `${base}/api/v1/playlists/${playlist.id}`,
      quote_url: `${base}/api/v1/playlists/${playlist.id}/quote?next=1`,
    }
  })

  return json({ playlists, count: playlists.length })
}
