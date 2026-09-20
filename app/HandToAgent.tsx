'use client'

import { useState } from 'react'
import { BG, INK, LINE, LINE_2, MONO, MUTED, MUTED_2, PANEL } from './theme'

/**
 * The order, written out so it can be handed to something that is not this page.
 *
 * "Inspect the 402" showed the raw challenge, which is the right thing for a
 * developer and useless to everyone else. What a person actually wants is a
 * block they can paste into their own agent so it goes and buys the spot —
 * which is the product's whole claim, made concrete enough to try in one
 * paste.
 *
 * Three renderings of the same order. The prompt is for an agent that can read
 * docs and write code; the curl shows the 402 without paying it; the snippet is
 * a complete client for anyone who would rather run it themselves.
 */
export type Order = {
  base: string
  playlist: string
  spot: number
  term: string
  trackUri: string
  price: string
}

const TABS = ['Prompt', 'curl', 'TypeScript'] as const
type Tab = (typeof TABS)[number]

export function promptFor(o: Order): string {
  return `Buy me spot ${o.spot} on the Pitch402 "${o.playlist}" playlist for this track:
${o.trackUri}

Pitch402 sells numbered positions on a curator's Spotify playlist. Spot ${o.spot}
costs ${o.price} USDC for the "${o.term}" term.

The protocol is x402 — there is no account, no API key and no signup:
  1. POST ${o.base}/api/v1/playlists/${o.playlist}/spots/${o.spot}?term=${o.term}&network=base-sepolia
     with body {"track_uri":"${o.trackUri}"}
  2. It answers HTTP 402 with payment requirements in the payment-required header.
  3. Sign an EIP-3009 transferWithAuthorization for USDC on Base Sepolia
     (eip155:84532, asset 0x036CbD53842c5426634e7929541eC2318f3dCF7e).
  4. Retry the POST with the X-PAYMENT header. You get 201 and a receipt, and the
     track is added to the curator's playlist.

You need a wallet holding USDC on Base Sepolia. You do NOT need ETH — the x402
facilitator pays the gas, because you are signing an authorization rather than
sending a transaction.

Full docs: ${o.base}/llms.txt
Integration guide with runnable code: ${o.base}/agents
Machine-readable: ${o.base}/.well-known/agent.json

Quote it first to confirm the spot is still free and the price has not changed:
  GET ${o.base}/api/v1/playlists/${o.playlist}/quote?spot=${o.spot}&term=${o.term}

Tell me the receipt URL and the Spotify position when you are done.`
}

export function curlFor(o: Order): string {
  return `# See the 402 challenge. This does not pay it — paying needs a signature.
curl -i -X POST "${o.base}/api/v1/playlists/${o.playlist}/spots/${o.spot}?term=${o.term}&network=base-sepolia" \\
  -H 'content-type: application/json' \\
  -d '{"track_uri":"${o.trackUri}"}'

# The payment-required header is base64 x402 requirements. Decode it:
curl -sS -D - -o /dev/null -X POST "${o.base}/api/v1/playlists/${o.playlist}/spots/${o.spot}" \\
  -H 'content-type: application/json' -d '{"track_uri":"${o.trackUri}"}' \\
  | grep -i '^payment-required:' | cut -d' ' -f2- | base64 -d`
}

export function codeFor(o: Order): string {
  return `// npm i viem @x402/fetch @x402/evm
// BUYER_PRIVATE_KEY=0x… node buy.ts
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, wrapFetchWithPayment } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as \`0x\${string}\`)

const client = new x402Client()
client.setSpendControls({ maxAmountPerPayment: '$${o.price}' })
registerExactEvmScheme(client, { signer: account, networks: ['eip155:84532'] })

const res = await wrapFetchWithPayment(fetch, client)(
  '${o.base}/api/v1/playlists/${o.playlist}/spots/${o.spot}?term=${o.term}&network=base-sepolia',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track_uri: '${o.trackUri}' }),
  },
)
console.log(await res.json())`
}

export default function HandToAgent({ order }: { order: Order }) {
  const [tab, setTab] = useState<Tab>('Prompt')
  const [copied, setCopied] = useState(false)

  const text = tab === 'Prompt' ? promptFor(order) : tab === 'curl' ? curlFor(order) : codeFor(order)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <div style={S.tabs}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{ ...S.tab, ...(t === tab ? S.tabOn : null) }}
            >
              {t}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} style={S.copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={S.pre}>{text}</pre>
      <p style={S.note}>
        {tab === 'Prompt'
          ? 'Paste into Claude, or any agent that can read docs and sign with a wallet. It has everything needed and names nothing it cannot find.'
          : tab === 'curl'
            ? 'Shows the challenge without paying it. Completing the purchase needs a signature, which curl cannot produce.'
            : 'A complete buyer. The only Pitch402-specific thing in it is the URL.'}
      </p>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: '1rem', border: `1px solid ${LINE_2}`, borderRadius: 3, overflow: 'hidden', background: BG },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', padding: '.5rem .6rem', borderBottom: `1px solid ${LINE}` },
  tabs: { display: 'flex', gap: '.2rem' },
  tab: { padding: '.35rem .7rem', borderRadius: 2, border: 'none', background: 'transparent', color: MUTED, font: `10px ${MONO}`, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer' },
  tabOn: { background: INK, color: BG },
  copy: { padding: '.35rem .8rem', borderRadius: 2, border: `1px solid ${LINE_2}`, background: 'transparent', color: INK, font: `10px ${MONO}`, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer' },
  pre: { margin: 0, padding: '1rem', background: BG, color: MUTED_2, font: `11px ${MONO}`, lineHeight: 1.7, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '22rem' },
  note: { margin: 0, padding: '.6rem .7rem', font: `10px ${MONO}`, lineHeight: 1.7, letterSpacing: '.06em', color: MUTED, background: PANEL, borderTop: `1px solid ${LINE}` },
}
