import { type NextRequest } from 'next/server'
import { SPOTS_PER_CYCLE, TERM_MULTIPLIERS, TIERS } from '@/config/pitch402.config'
import { baseUrl } from '@/lib/http'

export const dynamic = 'force-dynamic'

// Served at /llms.txt via a rewrite in next.config.mjs.
export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const tiers = TIERS.map((t) =>
    t.from === t.to ? `- spot ${t.from}: ${t.price} USDC` : `- spots ${t.from}-${t.to}: ${t.price} USDC`,
  ).join('\n')
  const terms = Object.entries(TERM_MULTIPLIERS)
    .map(([term, multiplier]) => `- ${term}: ${multiplier}x`)
    .join('\n')

  const body = `# Pitch402

Agent-native paid playlist pitching on Base + x402 + Spotify.

A curator opens a ${SPOTS_PER_CYCLE}-spot playlist. An artist or agent buys a numbered spot with USDC
via x402. Buying a spot places the track on the curator's own Spotify playlist.

## Prices (USDC, per cycle, editable by the curator)

${tiers}

## Term multipliers

${terms}

Price is snapshotted at payment. A paid spot is never repriced. When a spot is
taken, the quote endpoint returns the next free spot and its price. When all
${SPOTS_PER_CYCLE} spots are filled, buys close and a next-cycle waitlist opens.

## Endpoints

- GET ${base}/api/v1/playlists
- GET ${base}/api/v1/playlists/{id}
- GET ${base}/api/v1/playlists/{id}/quote?spot=N
- GET ${base}/api/v1/playlists/{id}/quote?next=1
- POST ${base}/api/v1/playlists/{id}/spots/{n}   (x402 gated, not implemented yet)
- GET ${base}/api/v1/receipts/{id}               (not implemented yet)
- GET ${base}/.well-known/agent.json

## Start here

GET ${base}/api/v1/playlists/demo/quote?next=1

The response carries next_action.url — POST to it to buy the quoted spot.

## Payment

x402 on Base Sepolia (eip155:84532), facilitator https://x402.org/facilitator.
USDC has 6 decimals. Payments are not enabled yet in this build.

## What we do not claim

- Curator-owned playlists only. Never Spotify editorial placement.
- No stream counts and no royalty figures. The Spotify Web API exposes no
  playlist-attributed plays. Any future estimate comes from curator-uploaded
  Spotify for Artists data and is labeled Estimate.
- No guaranteed algorithmic streams.
`

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
