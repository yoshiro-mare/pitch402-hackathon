/**
 * Buy a Pitch402 spot from any wallet. Nothing in here is ours.
 *
 *   BUYER_PRIVATE_KEY=0x… node examples/buy-spot.ts --next --track spotify:track:<id>
 *   BUYER_PRIVATE_KEY=0x… node examples/buy-spot.ts --spot 7 --term 3m --track <uri>
 *
 * The companion script in agent/ pays from a Privy wallet, which needs Privy
 * credentials that only we have. That is our demo buyer, not the product. This
 * is the product: a plain private key, a public endpoint, and no relationship
 * with us of any kind. No account, no API key, no allowlist.
 *
 * Copy this file into your own project. The only Pitch402-specific thing in it
 * is a URL — pricing, inventory and payment terms all arrive over HTTP.
 *
 * Needs: npm i viem @x402/fetch @x402/evm
 * Needs: USDC on Base Sepolia. No ETH — the facilitator pays the gas.
 */
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import type { Hex } from 'viem'

const BASE = process.env.PITCH402_BASE_URL ?? 'https://pitch402-hackathon.vercel.app'
const BASE_SEPOLIA = 'eip155:84532'

function flag(name: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

async function main() {
  const key = process.env.BUYER_PRIVATE_KEY
  if (!key) throw new Error('Set BUYER_PRIVATE_KEY to a funded Base Sepolia key.')

  const account = privateKeyToAccount(key as Hex)
  const playlist = flag('playlist') ?? 'demo'
  const term = flag('term') ?? 'cycle'
  const track = flag('track') ?? 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
  const spotFlag = flag('spot')

  // 1. Quote. Free and unauthenticated. The agent is told the price rather than
  //    assuming one, so a curator can reprice without breaking any buyer.
  const query = spotFlag ? `spot=${spotFlag}` : 'next=1'
  const quoteRes = await fetch(
    `${BASE}/api/v1/playlists/${playlist}/quote?${query}&term=${term}&track_uri=${encodeURIComponent(track)}`,
  )
  const quote = (await quoteRes.json()) as any
  if (!quoteRes.ok || quote.available === false) {
    console.error('Nothing to buy:', JSON.stringify(quote, null, 2))
    process.exit(1)
  }

  console.log(`Spot   ${quote.spot} on ${playlist} (${term})`)
  console.log(`Price  ${quote.price.amount} ${quote.price.currency}`)
  if (quote.track) console.log(`Track  ${quote.track.name} — ${quote.track.artist}`)
  console.log(`Wallet ${account.address}`)
  console.log()

  // 2. Pay. The first POST comes back 402 with requirements; the client signs an
  //    EIP-3009 authorization for exactly that amount and retries. Two settings
  //    matter and both fail closed:
  const client = new x402Client()
  //    - the client default cap is $1, and spot 1 costs 10 USDC
  client.setSpendControls({ maxAmountPerPayment: `$${quote.price.amount}` })
  //    - without an explicit network list the scheme registers eip155:*, which
  //      would sign for any EVM chain a server happened to name
  registerExactEvmScheme(client, { signer: account, networks: [BASE_SEPOLIA] })

  const res = await wrapFetchWithPayment(fetch, client)(
    `${BASE}/api/v1/playlists/${playlist}/spots/${quote.spot}?term=${term}&network=base-sepolia`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track_uri: track, buyer: account.address }),
    },
  )

  const body = (await res.json()) as any
  if (!res.ok) {
    console.error(`Buy failed (${res.status}):`, JSON.stringify(body, null, 2))
    process.exit(1)
  }

  console.log(`Bought spot ${body.spot} — ${body.amount_paid} ${body.currency}`)
  console.log(`  receipt  ${body.receipt_url}`)

  const placed = body.spotify ?? {}
  if (placed.status === 'placed') {
    console.log(`  spotify  position ${placed.position} — ${placed.playlist_url}`)
  } else {
    // A paid spot whose Spotify write failed is still yours, and retryable.
    console.log(`  spotify  ${placed.status}: ${placed.error ?? placed.reason}`)
    if (placed.retry_url) console.log(`           retry: POST ${placed.retry_url}`)
  }

  // Settlement completes after the response, so the hash arrives in a header.
  const header = res.headers.get('payment-response')
  const settled: any = header ? decodePaymentResponseHeader(header) : null
  if (settled?.transaction) {
    console.log(`  tx       https://sepolia.basescan.org/tx/${settled.transaction}`)
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
