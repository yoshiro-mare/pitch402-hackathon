import { type NextRequest } from 'next/server'
import { PAYMENT } from '@/config/pitch402.config'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist, getReceipt } from '@/lib/store'

export const dynamic = 'force-dynamic'

// Minimal read-back so the receipt_url handed out by a buy actually resolves.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const receipt = getReceipt(id)
  if (!receipt) {
    return error(404, 'receipt_not_found', `no receipt with id "${id}"`)
  }

  const base = baseUrl(req)
  const playlist = getPlaylist(receipt.playlistId)

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
      network: PAYMENT.network,
      chain: PAYMENT.chain,
      settled: receipt.paymentMethod === 'x402',
      note:
        receipt.paymentMethod === 'fake'
          ? 'DEMO ONLY. No USDC moved and nothing was settled onchain.'
          : 'Settled via x402.',
    },
    added_at: receipt.addedAt,
    playlist_url: `${base}/api/v1/playlists/${receipt.playlistId}`,
  })
}
