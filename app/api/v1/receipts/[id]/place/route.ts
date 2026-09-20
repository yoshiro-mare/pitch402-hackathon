import { type NextRequest } from 'next/server'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist, getReceipt } from '@/lib/store'
import { placeTrack, serializePlacement } from '@/lib/placement'

export const dynamic = 'force-dynamic'

/**
 * Retry the Spotify write for a paid spot.
 *
 *   POST /api/v1/receipts/:id/place
 *
 * A sale and a playlist write are two different things that can fail
 * separately. When the payment went through and Spotify did not, the buyer is
 * owed the placement, not a refund — this is how they, or their agent, claim
 * it. No payment is involved and none is charged: the spot is already theirs.
 *
 * Placing an already-placed track would duplicate it on the playlist, so a
 * successful placement is not retried.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = baseUrl(req)

  const receipt = await getReceipt(id)
  if (!receipt) {
    return error(404, 'receipt_not_found', `no receipt with id "${id}"`)
  }
  const playlist = await getPlaylist(receipt.playlistId)
  if (!playlist) {
    return error(404, 'playlist_not_found', `no playlist with id "${receipt.playlistId}"`)
  }

  if (receipt.placement.status === 'placed') {
    return json({
      receipt_id: receipt.id,
      spot: receipt.spot,
      retried: false,
      reason: 'already_placed',
      spotify: serializePlacement(receipt.placement, playlist, base, receipt.id),
    })
  }

  const placement = await placeTrack(playlist, receipt)

  return json(
    {
      receipt_id: receipt.id,
      spot: receipt.spot,
      track_uri: receipt.trackUri,
      retried: true,
      spotify: serializePlacement(placement, playlist, base, receipt.id),
      receipt_url: `${base}/api/v1/receipts/${receipt.id}`,
    },
    { status: placement.status === 'placed' ? 200 : 502 },
  )
}
