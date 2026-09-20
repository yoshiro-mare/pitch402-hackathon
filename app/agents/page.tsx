import type { Metadata } from 'next'
import { SPOTS_PER_CYCLE, TERM_MULTIPLIERS, TIERS, networkList } from '@/config/pitch402.config'
import { payTo } from '@/lib/x402'

/**
 * The integration guide, written for whoever is wiring an agent up to Pitch402
 * — and readable by the agent itself.
 *
 * /llms.txt and /.well-known/agent.json are the machine-readable contracts;
 * this page is the same information with the reasoning left in, because the
 * question a newcomer actually asks is "who pays whom, and do I need an
 * account?" and no JSON document answers that well.
 *
 * Server-rendered from config/pitch402.config.ts so the prices here can never
 * drift from the prices the API charges.
 */
export const metadata: Metadata = {
  title: 'Pitch402 for agents',
  description: 'How an autonomous agent buys a numbered Spotify playlist spot with USDC over x402. No account, no signup, no custody.',
}

export const dynamic = 'force-dynamic'

const BASE = 'https://pitch402-hackathon.vercel.app'

export default function AgentsPage() {
  const networks = networkList()
  const live = networks.filter((n) => n.settlement === 'live')
  const address = payTo()

  return (
    <main style={S.page}>
      <style>{CSS}</style>

      <header style={S.header}>
        <p style={S.eyebrow}>Integration guide</p>
        <h1 style={S.h1}>Pitch402 for agents</h1>
        <p style={S.lede}>
          A curator opens a {SPOTS_PER_CYCLE}-spot Spotify playlist. You buy a numbered spot with
          USDC over x402, and the track goes on the playlist. Lower spot numbers cost more.
        </p>
      </header>

      <section style={S.callout}>
        <h2 style={S.calloutH}>You do not need an account</h2>
        <p style={S.calloutP}>
          There is no signup, no API key, and no onboarding. You bring a wallet that can sign an
          EIP-712 message and hold USDC. Pitch402 never takes custody of your funds, never sees your
          keys, and does not know who you are. Pay the 402 and the spot is yours.
        </p>
        <p style={S.calloutP}>
          You also never touch Spotify. Only the curator authorizes Spotify, once, over their own
          playlist. Your track is placed on your behalf.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>What access requires</h2>
        <table style={S.table}>
          <tbody>
            <tr><td style={S.td}>An account with us</td><td style={S.td}><span style={S.muted}>not required</span></td></tr>
            <tr><td style={S.td}>An API key or token</td><td style={S.td}><span style={S.muted}>not required</span></td></tr>
            <tr><td style={S.td}>An allowlist</td><td style={S.td}><span style={S.muted}>not required</span></td></tr>
            <tr><td style={S.td}>A Spotify account</td><td style={S.td}><span style={S.muted}>not required</span></td></tr>
            <tr><td style={S.td}>ETH for gas</td><td style={S.td}><span style={S.muted}>not required</span></td></tr>
            <tr><td style={S.td}>A wallet that signs EIP-712</td><td style={S.td}><span style={S.ok}>required</span></td></tr>
            <tr><td style={S.td}>USDC on Base Sepolia</td><td style={S.td}><span style={S.ok}>required</span></td></tr>
          </tbody>
        </table>
        <p style={S.p}>
          The endpoints are public and cross-origin, so an agent running in a page reaches them the
          same way a server does. Spam is self-limiting: taking a spot costs money.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Who pays whom</h2>
        <pre style={S.flow}>{`your wallet  ──signs EIP-3009 authorization──▶  x402 facilitator
                                               │ submits, pays the gas
                                               ▼
                                          USDC contract
                                               │
                                               ▼
                                    ${address ?? 'the curator payout address'}
                                      the curator's payout address`}</pre>
        <p style={S.p}>
          You pay gas for nothing. The facilitator submits the transfer and covers it, which is why
          your wallet needs USDC but no ETH.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Three requests</h2>

        <Step n={1} title="Find what is for sale">
          <pre style={S.code}>{`curl ${BASE}/api/v1/playlists`}</pre>
          <p style={S.p}>
            Or start from <Code>/.well-known/agent.json</Code>, which carries the price ladder, the
            networks, and the USDC contract address in one document.
          </p>
        </Step>

        <Step n={2} title="Quote a spot — optionally for a specific track">
          <pre style={S.code}>{`curl "${BASE}/api/v1/playlists/demo/quote?next=1\\
&track_uri=https://open.spotify.com/track/<id>"`}</pre>
          <p style={S.p}>
            Passing <Code>track_uri</Code> resolves the song against Spotify and returns its title,
            artist and album art, so you can confirm you picked the right track before spending
            anything. A track Spotify does not have is rejected here rather than after payment.
          </p>
        </Step>

        <Step n={3} title="Buy it">
          <pre style={S.code}>{`curl -X POST ${BASE}/api/v1/playlists/demo/spots/1 \\
  -H 'content-type: application/json' \\
  -d '{"track_uri":"spotify:track:<id>","term":"cycle"}'`}</pre>
          <p style={S.p}>
            With no payment attached this answers <strong>HTTP 402</strong> with x402 payment
            requirements in the <Code>payment-required</Code> header and a readable quote in the
            body. Sign it, retry with the payment attached, and you get <strong>201</strong> and a
            receipt.
          </p>
        </Step>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Paying it in code</h2>
        <p style={S.p}>
          Any x402 client works. This is the whole integration with{' '}
          <Code>@x402/fetch</Code> — the 402 is handled for you.
        </p>
        <pre style={S.code}>{`import { x402Client } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'

const client = new x402Client()
client.setSpendControls({ maxAmountPerPayment: '$10' })
registerExactEvmScheme(client, {
  signer: yourAccount,            // any viem LocalAccount
  networks: ['eip155:84532'],     // pin the chain; a wildcard signs anywhere
})

const res = await client.fetch(
  '${BASE}/api/v1/playlists/demo/spots/1',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track_uri: 'spotify:track:<id>' }),
  },
)
const receipt = await res.json()`}</pre>
        <p style={S.p}>
          A complete runnable version is in the repo at <Code>examples/buy-spot.ts</Code> — a plain
          private key, no SDK of ours, no credentials from us. That is the whole integration.
        </p>
        <p style={S.p}>
          Two settings worth copying. <Code>maxAmountPerPayment</Code> because the client default is
          $1 and spot 1 costs {TIERS[0]?.price} USDC, so an uncapped-looking buy is refused before it
          leaves your process. And an explicit <Code>networks</Code> list, because without it the
          scheme registers an <Code>eip155:*</Code> wildcard and your agent will sign for any EVM
          chain a server asks it to.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Give the wallet a spending limit</h2>
        <p style={S.p}>
          An agent that holds money should not hold unbounded authority over it. Our own demo buyer
          runs on a Privy wallet whose policy is evaluated inside an enclave, so it holds even if the
          agent process is compromised:
        </p>
        <pre style={S.code}>{`method             eth_signTypedData_v4      never eth_sendTransaction
chainId       eq   84532                     Base Sepolia only
verifyingContract eq 0x036CbD…F7e            the verified USDC, not a lookalike
to            eq   <payout address>          one payee and no other
value         lte  10000000                  10 USDC per payment`}</pre>
        <p style={S.p}>
          Everything not explicitly allowed is denied. You do not have to use Privy — the point is
          that whatever wallet you bring should be scoped this narrowly.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Prices</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Spot</th>
              <th style={S.th}>Price</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((t) => (
              <tr key={t.from}>
                <td style={S.td}>{t.from === t.to ? t.from : `${t.from}–${t.to}`}</td>
                <td style={S.td}>{t.price} USDC</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={S.p}>
          Multiply by the term: {Object.entries(TERM_MULTIPLIERS).map(([t, m], i) => (
            <span key={t}>
              {i > 0 && ', '}
              <Code>{t}</Code> ×{m}
            </span>
          ))}
          . The price is snapshotted at payment — a paid spot is never repriced, whatever the curator
          changes afterwards.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Networks</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Network</th>
              <th style={S.th}>Chain</th>
              <th style={S.th}>USDC</th>
              <th style={S.th}>Settlement</th>
            </tr>
          </thead>
          <tbody>
            {networks.map((n) => (
              <tr key={n.id}>
                <td style={S.td}>
                  <Code>{n.id}</Code>
                </td>
                <td style={S.td}>{n.chain}</td>
                <td style={S.td}>
                  {n.asset.address ? <Code>{n.asset.address}</Code> : <span style={S.muted}>none verified</span>}
                </td>
                <td style={S.td}>
                  {n.settlement === 'live' ? (
                    <span style={S.ok}>live</span>
                  ) : (
                    <span style={S.muted}>unavailable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={S.p}>
          {live.map((n) => n.name).join(', ')} {live.length === 1 ? 'is' : 'are'} the only{' '}
          {live.length === 1 ? 'network' : 'networks'} a spot can actually be bought on. The others
          are advertised for coverage; selecting one returns 402{' '}
          <Code>settlement_unavailable_on_network</Code> rather than payment requirements nobody can
          settle.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>What we do not claim</h2>
        <ul style={S.list}>
          <li>
            These are <strong>curator-owned playlists</strong>. Pitch402 never touches Spotify
            editorial playlists and cannot put you on one.
          </li>
          <li>
            <strong>No stream counts.</strong> The Spotify Web API reports no plays, saves or
            royalties attributable to a playlist, so we show none. Anything labelled an estimate came
            from a curator uploading their own Spotify for Artists data.
          </li>
          <li>
            <strong>No guaranteed outcome.</strong> You are buying a numbered position on a playlist
            for a term. That is all it is.
          </li>
          <li>
            A paid spot whose Spotify write fails stays yours — the receipt says{' '}
            <Code>failed</Code> with Spotify&rsquo;s own error, and{' '}
            <Code>POST /api/v1/receipts/:id/place</Code> retries it for free.
          </li>
        </ul>
      </section>

      <footer style={S.footer}>
        <p style={S.footerLabel}>Machine-readable</p>
        {[
          ['/.well-known/agent.json', 'capabilities, pricing, networks'],
          ['/llms.txt', 'the same in prose'],
          ['/api/v1/playlists', 'live inventory'],
        ].map(([href, what]) => (
          <a key={href} href={href} style={S.footerLink}>
            <Code>{href}</Code>
            <span style={S.muted}> — {what}</span>
          </a>
        ))}
        <p style={S.footerNote}>
          Testnet only. Base Sepolia USDC has no monetary value. <a href="/" style={S.inlineLink}>Back to the playlist</a>.
        </p>
      </footer>
    </main>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={S.step}>
      <div style={S.stepHead}>
        <span style={S.stepN}>{n}</span>
        <h3 style={S.h3}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code style={S.inlineCode}>{children}</code>
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #fafafa; }
  a { color: inherit; }
  @media (max-width: 640px) {
    pre { font-size: .68rem !important; }
  }
`

const S: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: '46rem',
    margin: '0 auto',
    padding: '2.5rem 1rem 4rem',
    font: '15px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    color: '#0f172a',
  },
  header: { marginBottom: '2rem' },
  eyebrow: { margin: 0, fontSize: '.72rem', letterSpacing: '.09em', textTransform: 'uppercase', color: '#64748b' },
  h1: { margin: '.3rem 0 .6rem', fontSize: '2rem', letterSpacing: '-.02em' },
  lede: { margin: 0, fontSize: '1.02rem', color: '#475569' },
  callout: {
    padding: '1.1rem 1.2rem',
    borderRadius: '.7rem',
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    marginBottom: '2.2rem',
  },
  calloutH: { margin: '0 0 .4rem', fontSize: '1.02rem' },
  calloutP: { margin: '0 0 .6rem', fontSize: '.9rem', color: '#065f46' },
  section: { marginBottom: '2.4rem' },
  h2: { margin: '0 0 .8rem', fontSize: '1.2rem', letterSpacing: '-.01em' },
  h3: { margin: 0, fontSize: '.98rem' },
  p: { margin: '.7rem 0 0', fontSize: '.88rem', color: '#475569' },
  step: { marginBottom: '1.5rem' },
  stepHead: { display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '.55rem' },
  stepN: {
    flex: '0 0 auto',
    width: '1.45rem',
    height: '1.45rem',
    borderRadius: '50%',
    background: '#0f172a',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontSize: '.76rem',
    fontWeight: 600,
  },
  code: {
    margin: 0,
    padding: '.8rem .9rem',
    borderRadius: '.5rem',
    background: '#0f172a',
    color: '#e2e8f0',
    fontSize: '.76rem',
    lineHeight: 1.65,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  flow: {
    margin: 0,
    padding: '.9rem',
    borderRadius: '.5rem',
    background: '#fff',
    border: '1px solid #e2e8f0',
    color: '#334155',
    fontSize: '.72rem',
    lineHeight: 1.7,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  inlineCode: {
    background: '#f1f5f9',
    borderRadius: '.25rem',
    padding: '.08rem .3rem',
    fontSize: '.84em',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' },
  th: {
    textAlign: 'left',
    padding: '.45rem .5rem',
    borderBottom: '2px solid #e2e8f0',
    fontSize: '.72rem',
    textTransform: 'uppercase',
    letterSpacing: '.05em',
    color: '#64748b',
  },
  td: { padding: '.45rem .5rem', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' },
  list: { margin: '.6rem 0 0', paddingLeft: '1.1rem', fontSize: '.88rem', color: '#475569' },
  muted: { color: '#94a3b8' },
  ok: { color: '#059669', fontWeight: 600 },
  footer: { borderTop: '1px solid #e2e8f0', paddingTop: '1.2rem', display: 'flex', flexDirection: 'column', gap: '.4rem' },
  footerLabel: { margin: '0 0 .2rem', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.07em', color: '#64748b' },
  footerLink: { fontSize: '.82rem', textDecoration: 'none' },
  footerNote: { margin: '.8rem 0 0', fontSize: '.76rem', color: '#94a3b8' },
  inlineLink: { color: '#0f172a' },
}
