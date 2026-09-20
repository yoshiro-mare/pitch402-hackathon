/**
 * The buyer agent. It quotes a spot, pays the 402, and prints the receipt.
 *
 *   node --env-file=.env.local agent/buy-spot.ts --next --track spotify:track:4cOdK2wGLETKBW3PvgPWqT
 *   node --env-file=.env.local agent/buy-spot.ts --spot 7 --term 3m --track <uri>
 *
 * Nothing here knows Pitch402's pricing, inventory, or config. It reads a URL,
 * gets told what a spot costs, and pays. That is the whole point of the
 * agent-first API: the only shared vocabulary is HTTP 402.
 *
 * The wallet is a Privy agent wallet with a policy attached (agent/setup-wallet.ts).
 * There are two independent caps on what this can spend:
 *   1. client-side, via x402 spend controls — a bad quote is refused before signing
 *   2. server-side, via the Privy policy — a signature is refused inside the enclave
 * Only the second one survives a compromised agent, which is why both exist.
 */
import { wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch'
import type { Hex } from 'viem'
import { env, optionalEnv, payingClient, privyClient } from './privy.ts'

type Args = {
  baseUrl: string
  playlist: string
  spot: number | 'next'
  term: string
  track: string
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
  }
  const spotFlag = flag('spot')
  return {
    baseUrl: (flag('base-url') ?? optionalEnv('PITCH402_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, ''),
    playlist: flag('playlist') ?? 'demo',
    spot: argv.includes('--next') || !spotFlag ? 'next' : Number(spotFlag),
    term: flag('term') ?? 'cycle',
    track: flag('track') ?? 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const walletId = env('PITCH402_AGENT_WALLET_ID')
  const address = env('PITCH402_AGENT_ADDRESS') as Hex
  const maxUsdc = optionalEnv('PITCH402_AGENT_MAX_USDC') ?? '10'

  // Step 1: quote. Free, unauthenticated, and it tells the agent which spot is
  // free and what it costs — so the agent never guesses a price.
  const spotQuery = args.spot === 'next' ? 'next=1' : `spot=${args.spot}`
  const quoteUrl = `${args.baseUrl}/api/v1/playlists/${args.playlist}/quote?${spotQuery}&term=${args.term}&network=base-sepolia`
  const quoteRes = await fetch(quoteUrl)
  const quote = (await quoteRes.json()) as Record<string, any>

  if (!quoteRes.ok || quote.available === false) {
    console.error(`No spot to buy: ${quote.reason ?? quoteRes.status}`)
    console.error(JSON.stringify(quote, null, 2))
    process.exit(1)
  }

  const spot: number = quote.spot
  console.log(`Quote  playlist ${args.playlist}, spot ${spot}, term ${args.term}`)
  console.log(`Price  ${quote.price.amount} ${quote.price.currency} (${quote.price.amount_atomic} atomic)`)
  console.log(`Wallet ${address}`)
  console.log()

  // Step 2: buy. wrapFetchWithPayment does the 402 dance — first request comes
  // back 402 with payment requirements, the Privy wallet signs an EIP-3009
  // authorization for exactly that amount, the request is retried with an
  // X-PAYMENT header, and the facilitator settles it onchain.
  const privy = privyClient()
  const client = payingClient({ privy, walletId, address, maxUsdc })
  const fetchWithPayment = wrapFetchWithPayment(fetch, client)

  const buyUrl = `${args.baseUrl}/api/v1/playlists/${args.playlist}/spots/${spot}?term=${args.term}&network=base-sepolia`
  const res = await fetchWithPayment(buyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track_uri: args.track, buyer: `privy:${address}` }),
  })

  const body = (await res.json()) as Record<string, any>
  if (!res.ok) {
    console.error(`Buy failed (${res.status})`)
    console.error(JSON.stringify(body, null, 2))
    process.exit(1)
  }

  // Settlement finishes after the response, so the transaction hash arrives in
  // this header rather than in the JSON body.
  const paymentHeader = res.headers.get('payment-response')
  const settlement = paymentHeader ? decodePaymentResponseHeader(paymentHeader) : null

  console.log(`Bought spot ${body.spot} on "${body.playlist_name}" (cycle ${body.cycle})`)
  console.log(`  paid      ${body.amount_paid} ${body.currency}, term ${body.term}`)
  console.log(`  track     ${body.track_uri}`)
  console.log(`  receipt   ${body.receipt_url}`)

  // The thing the spot was actually bought for.
  const placed = body.spotify ?? {}
  if (placed.status === 'placed') {
    console.log(`  spotify   on the playlist at position ${placed.position} — ${placed.playlist_url}`)
  } else if (placed.status === 'failed') {
    console.log(`  spotify   NOT placed: ${placed.error}`)
    console.log(`            spot is paid for and held; retry with POST ${placed.retry_url}`)
  } else {
    console.log(`  spotify   not written: ${placed.reason}`)
  }
  if (settlement && (settlement as any).transaction) {
    console.log(`  tx        https://sepolia.basescan.org/tx/${(settlement as any).transaction}`)
  }
  console.log(`  next free ${body.next_free_spot ?? 'none — cycle is full'}`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
