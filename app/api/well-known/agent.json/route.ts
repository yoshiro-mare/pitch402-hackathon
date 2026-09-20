import { type NextRequest } from 'next/server'
import { DEFAULT_NETWORK, SPOTS_PER_CYCLE, USDC_DECIMALS } from '@/config/pitch402.config'
import { baseUrl, json } from '@/lib/http'
import { publicTerms } from '@/lib/store'
import { networkSummaries } from '@/lib/networks'

export const dynamic = 'force-dynamic'

// Served at /.well-known/agent.json via a rewrite in next.config.mjs.
export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const { tiers, termMultipliers } = publicTerms()

  return json({
    name: 'Pitch402',
    description:
      'Agent-native paid playlist pitching. A curator opens a 100-spot playlist; an artist or agent buys a numbered spot with USDC and the track is added to the curator-owned Spotify playlist.',
    version: '0.1.0',
    url: base,
    documentation: `${base}/llms.txt`,
    payment: {
      protocol: 'x402',
      default_network: DEFAULT_NETWORK,
      currency: 'USDC',
      decimals: USDC_DECIMALS,
      // Choose with ?network=<id> on a quote, or a "network" field when buying.
      networks: networkSummaries(),
      note: 'Settlement is live on base-sepolia only. Other networks are advertised for coverage and accept demo payments.',
    },
    pricing: {
      currency: 'USDC',
      spots_per_cycle: SPOTS_PER_CYCLE,
      tiers,
      term_multipliers: termMultipliers,
      note: 'Price is snapshotted at payment. A paid spot is never repriced.',
    },
    endpoints: [
      { method: 'GET', path: '/api/v1/playlists', description: 'List open playlist cycles.' },
      { method: 'GET', path: '/api/v1/playlists/{id}', description: 'Playlist detail, tiers, sold spots.' },
      {
        method: 'GET',
        path: '/api/v1/playlists/{id}/quote?spot=N',
        description: 'Quote one spot. Returns the next free spot if that one is taken.',
      },
      {
        method: 'GET',
        path: '/api/v1/playlists/{id}/quote?next=1',
        description: 'Quote the next free spot.',
      },
      {
        method: 'POST',
        path: '/api/v1/playlists/{id}/spots/{n}',
        description: 'Buy a spot. x402 gated. Not implemented yet.',
        status: 'not_implemented',
      },
      {
        method: 'GET',
        path: '/api/v1/receipts/{id}',
        description: 'Receipt for a paid spot. Not implemented yet.',
        status: 'not_implemented',
      },
    ],
    getting_started: {
      method: 'GET',
      url: `${base}/api/v1/playlists/demo/quote?next=1`,
      description: 'Quote the next free spot on the demo cycle, then POST to the returned next_action.url.',
    },
    honesty: [
      'Settlement is verified on Base Sepolia only. HashKey Chain Testnet is listed for network coverage; no facilitator is confirmed for it.',
      'Curator-owned playlists only. Never Spotify editorial playlists.',
      'No stream counts or royalty figures. The Spotify Web API does not expose playlist-attributed plays.',
      'No guaranteed algorithmic streams.',
    ],
  })
}
