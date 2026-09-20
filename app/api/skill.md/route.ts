import { type NextRequest } from 'next/server'
import { baseUrl } from '@/lib/http'
import { SPOTS_PER_CYCLE, TERM_MULTIPLIERS, TIERS } from '@/config/pitch402.config'

export const dynamic = 'force-dynamic'

/**
 * A buyer skill, served over HTTP so an agent can install it without us
 * publishing a package.
 *
 *   curl -o .claude/skills/pitch402/SKILL.md https://…/skill.md
 *
 * The skill in .claude/skills/pitch402 in our own repo is the opposite of this
 * one: it teaches an agent to *build* Pitch402. This teaches an agent to buy
 * from it, and assumes nothing about who is running it.
 *
 * Served rather than committed so the prices in it are the prices the API
 * charges, always.
 */
export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const tiers = TIERS.map((t) => `| ${t.from === t.to ? t.from : `${t.from}-${t.to}`} | ${t.price} |`).join('\n')
  const terms = Object.entries(TERM_MULTIPLIERS).map(([t, m]) => `${t} = ${m}x`).join(', ')

  const body = `---
name: pitch402-buy
description: Buy a numbered spot on a curator's Spotify playlist with USDC over x402. Use when asked to pitch a song to a playlist, buy a playlist spot, or place a track on Pitch402. Requires a wallet with USDC on Base Sepolia.
---

# Buying a Pitch402 playlist spot

Pitch402 sells numbered positions on a curator-owned Spotify playlist. Paying for
a spot places the track on that playlist. Lower spot numbers cost more.

There is **no account, no API key and no signup**. The only requirement is a
wallet that can sign EIP-712 and holds USDC on Base Sepolia. No ETH is needed —
the x402 facilitator pays the gas, because the buyer signs an authorization
rather than sending a transaction.

Base URL: ${base}

## Before you spend anything

1. Confirm the track resolves to the song the user meant. Pass \`track_uri\` to the
   quote endpoint and read back the title and artist:

   \`\`\`
   GET ${base}/api/v1/playlists/demo/quote?next=1&track_uri=<url-or-uri>
   \`\`\`

   A track Spotify does not have is rejected here rather than after payment.

2. Confirm the spot is free and check the price. Quotes are free and
   unauthenticated. **Never assume a price** — the curator can change the ladder
   between cycles, and the quote is the authority.

3. If the user did not name a spot, use \`?next=1\` for the cheapest free one, and
   tell them which spot and price you are about to commit to before you pay.

## Buying

\`\`\`
POST ${base}/api/v1/playlists/{playlist}/spots/{n}?term=cycle&network=base-sepolia
Body: {"track_uri": "spotify:track:<id>"}
\`\`\`

With no payment attached this returns **HTTP 402** with x402 payment
requirements in the \`payment-required\` header. Sign an EIP-3009
\`transferWithAuthorization\` and retry with the \`X-PAYMENT\` header. You get 201
and a receipt.

- network: \`eip155:84532\` (Base Sepolia)
- asset: \`0x036CbD53842c5426634e7929541eC2318f3dCF7e\` (USDC, 6 decimals)

### Runnable client

\`\`\`ts
// npm i viem @x402/fetch @x402/evm
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, wrapFetchWithPayment } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as \`0x\${string}\`)

const client = new x402Client()
// The client default cap is $1. Set it from the quoted price or spots above the
// cheapest tier are refused before the request leaves the process.
client.setSpendControls({ maxAmountPerPayment: '$<quoted price>' })
// Without an explicit network list the scheme registers eip155:* and will sign
// on whatever chain a server names.
registerExactEvmScheme(client, { signer: account, networks: ['eip155:84532'] })

const res = await wrapFetchWithPayment(fetch, client)(
  '${base}/api/v1/playlists/demo/spots/<n>?term=cycle&network=base-sepolia',
  { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track_uri: '<uri>' }) },
)
\`\`\`

The settlement transaction hash is in the \`payment-response\` header on the way
back, not in the JSON body — settlement completes after the response.

## Prices

| Spot | USDC |
|------|------|
${tiers}

Term multipliers: ${terms}. There are ${SPOTS_PER_CYCLE} spots per cycle. The price
is snapshotted at payment and a paid spot is never repriced.

## Report back

- the spot number and what it cost
- the receipt URL
- the Spotify placement: \`placed\` and its position, or the failure
- the transaction, at https://sepolia.basescan.org/tx/<hash>

## Failure modes worth handling

- **409 spot_taken** — someone bought it first. The body carries
  \`next_free_spot\` and its price. Ask before buying a different spot; the user
  chose that number for a reason.
- **400 track_not_found** — Spotify has no such track. Do not retry; fix the URI.
- **402 settlement_unavailable_on_network** — you selected a network with no
  facilitator. Use \`base-sepolia\`.
- **Spotify placement \`failed\`** — the spot is paid for and still yours. Retry
  the placement for free with \`POST ${base}/api/v1/receipts/{id}/place\`. Do not
  buy another spot.

## Do not tell the user

- that a spot guarantees streams, saves or algorithmic placement. It buys a
  numbered position on one playlist for a term, nothing more.
- that this is a Spotify editorial playlist. It is a curator's own playlist.
- any play count. The Spotify Web API attributes no plays or royalties to a
  playlist, so nobody has that number, including us.

## More

- ${base}/llms.txt — the full API in prose
- ${base}/agents — integration guide
- ${base}/.well-known/agent.json — machine-readable
`

  return new Response(body, {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
  })
}
