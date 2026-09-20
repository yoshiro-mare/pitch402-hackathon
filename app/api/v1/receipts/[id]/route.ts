import { type NextRequest } from 'next/server'
import { networkFor } from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist, getReceipt } from '@/lib/store'
import { serializePlacement } from '@/lib/placement'

export const dynamic = 'force-dynamic'

// Minimal read-back so the receipt_url handed out by a buy actually resolves.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const receipt = await getReceipt(id)
  if (!receipt) {
    return error(404, 'receipt_not_found', `no receipt with id "${id}"`)
  }

  const base = baseUrl(req)
  const playlist = await getPlaylist(receipt.playlistId)

  return json({
    receipt_id: receipt.id,
    playlist_id: receipt.playlistId,
    playlist_name: playlist?.name ?? null,
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
      note:
        receipt.paymentMethod === 'fake'
          ? `DEMO ONLY. No ${receipt.currency} moved and nothing was settled onchain (${networkFor(receipt.network).name}).`
          : receipt.settled
            ? `Settled via x402 on ${networkFor(receipt.network).name}.`
            : 'Verified by the x402 facilitator; settlement not confirmed yet.',
    },
    added_at: receipt.addedAt,
    spotify: playlist
      ? serializePlacement(receipt.placement, playlist, base, receipt.id)
      : { status: receipt.placement.status, note: 'Playlist is no longer in the store.' },
    playlist_url: `${base}/api/v1/playlists/${receipt.playlistId}`,
  })
}
