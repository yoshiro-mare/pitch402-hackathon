'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Hex } from 'viem'
import { connect, EXPLORER, explain, injected, payingFetch, settlementTx, usdcBalance, WalletError } from './wallet'
import HandToAgent from './HandToAgent'

type Tier = { from: number; to: number; price: string }

type Playlist = {
  id: string
  name: string
  cycle: number
  status: string
  spots_per_cycle: number
  spots_sold: number
  spots_remaining: number
  next_free_spot: number | null
  pricing: { tiers: Tier[]; term_multipliers: Record<string, number> }
  payment: { default_network: string; networks: NetworkInfo[] }
  sold: { spot: number; amount: string; term: string; added_at: string; receipt_url: string }[]
}

type NetworkInfo = {
  network: string
  name: string
  chain: string
  settlement: 'live' | 'unavailable'
  asset_address: string | null
  default?: boolean
}

type Quote = {
  spot: number
  term: string
  price: { amount: string; amount_atomic: string }
  next_action: { method: string; url: string }
}

type Receipt = {
  receipt_id: string
  receipt_url: string
  spot: number
  term: string
  amount_paid: string
  currency: string
  track_uri: string
  track: TrackInfo | null
  payment: { method: string; settled: boolean; network_name: string; note: string }
  spotify: { status: string; position?: number; playlist_url?: string; error?: string; reason?: string; retry_url?: string }
}

/**
 * What a POST without payment answers with: HTTP 402 carrying the x402
 * requirements an agent needs in order to pay. Nothing is bought here — the UI
 * has no wallet, so it shows the challenge rather than pretending to settle.
 */
type Challenge = {
  status: number
  body: {
    error?: string
    message?: string
    spot?: number
    term?: string
    price?: { amount: string; amount_atomic: string; currency: string }
    payment?: {
      selected_network: string
      settlement: string
      pay_to: string
      accepts?: { network: string; chain: string; amount: string; settlement: string }[]
    }
    [k: string]: unknown
  }
}

type TrackInfo = {
  uri: string
  name: string
  artist: string
  album: string
  album_image: string | null
  duration_ms: number
  explicit: boolean
  url: string
}

const API = '/api/v1/playlists/demo'

function mmss(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * `selectedSpot` lets the landing page above drive this form. It is optional:
 * the demo still works standalone, defaulting to whatever the quote says is
 * free next.
 */
export default function Demo({ selectedSpot }: { selectedSpot?: number }) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [track, setTrack] = useState('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
  const [spot, setSpot] = useState('')
  const [term, setTerm] = useState('cycle')
  const [network, setNetwork] = useState('base-sepolia')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null)
  const [trackErr, setTrackErr] = useState<string | null>(null)
  const [trackBusy, setTrackBusy] = useState(false)
  const [wallet, setWallet] = useState<Hex | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [paying, setPaying] = useState(false)
  const [showAgent, setShowAgent] = useState(false)
  const [tx, setTx] = useState<string | null>(null)
  const hasWallet = typeof window !== 'undefined' && injected() !== null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, q] = await Promise.all([
      fetch(API).then((r) => r.json()),
      fetch(`${API}/quote?next=1`).then((r) => (r.ok ? r.json() : null)),
    ])
    setPlaylist(p)
    setQuote(q)
    setSpot((current) => current || String(q?.spot ?? p.next_free_spot ?? 1))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A spot chosen in the grid upstairs wins over the next-free default.
  useEffect(() => {
    if (selectedSpot) setSpot(String(selectedSpot))
  }, [selectedSpot])

  /**
   * Resolve whatever is in the track box against the Spotify catalog so the
   * buyer sees the song before paying for the spot. Debounced, and cancelled on
   * every keystroke so a slow lookup cannot overwrite a newer one.
   */
  useEffect(() => {
    const value = track.trim()
    if (!value) {
      setTrackInfo(null)
      setTrackErr(null)
      return
    }
    let cancelled = false
    setTrackBusy(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/quote?next=1&track_uri=${encodeURIComponent(value)}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setTrackInfo(null)
          setTrackErr(data.error?.message ?? 'Could not resolve that track')
        } else {
          setTrackInfo(data.track ?? null)
          setTrackErr(data.track_error ?? null)
        }
      } catch {
        if (!cancelled) {
          setTrackInfo(null)
          setTrackErr('Lookup failed')
        }
      } finally {
        if (!cancelled) setTrackBusy(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [track])

  const priceOf = (n: number): string => {
    const tier = playlist?.pricing.tiers.find((t) => n >= t.from && n <= t.to)
    return tier ? tier.price : '?'
  }

  const takenSet = new Set(playlist?.sold.map((s) => s.spot) ?? [])
  const multiplier = playlist?.pricing.term_multipliers[term] ?? 1
  const selected = Number(spot)
  const selectedTotal =
    playlist && selected >= 1 && selected <= playlist.spots_per_cycle
      ? `${Number(priceOf(selected)) * multiplier} USDC`
      : '—'

  async function connectWallet() {
    setError(null)
    try {
      const address = await connect()
      setWallet(address)
      setBalance(await usdcBalance(address))
    } catch (err) {
      setError(err instanceof WalletError ? err.message : explain(err))
    }
  }

  /**
   * Buy the spot for real: POST, get 402, sign the EIP-3009 authorization in
   * the wallet, retry with the payment attached. Same protocol an agent
   * speaks — the only difference is that a person approves the signature.
   */
  async function buyWithWallet(e: React.FormEvent) {
    e.preventDefault()
    if (!wallet) return connectWallet()
    setPaying(true)
    setError(null)
    setChallenge(null)
    setReceipt(null)
    setTx(null)
    try {
      const price = String(Number(priceOf(selected)) * multiplier)
      const res = await payingFetch(wallet, price)(
        `${API}/spots/${selected}?term=${term}&network=base-sepolia`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ track_uri: track, buyer: wallet }),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        const next = data.next_free_spot
        setError(`${data.error?.message ?? data.message ?? 'Buy failed'}${next ? ` — next free spot is ${next}` : ''}`)
        if (next) setSpot(String(next))
      } else {
        setReceipt(data)
        // Settlement runs after the response, so the hash is in this header and
        // the receipt's own `settled` flag is still false at this instant.
        setTx(settlementTx(res))
        setBalance(await usdcBalance(wallet))

        // Re-read the receipt once settlement has had a moment to land, so the
        // panel ends up showing what the server recorded rather than what we
        // hoped for.
        setTimeout(async () => {
          try {
            const fresh = await fetch(data.receipt_url).then((r) => (r.ok ? r.json() : null))
            if (fresh) {
              setReceipt(fresh)
              if (fresh.payment?.reference) setTx(fresh.payment.reference)
            }
          } catch {
            // The receipt we already have is still correct about the purchase.
          }
        }, 4000)
      }
      await load()
    } catch (err) {
      setError(explain(err))
    } finally {
      setPaying(false)
    }
  }

  /**
   * POST the spot with no payment attached. The server answers 402 with real
   * x402 payment requirements, which is exactly what a paying agent receives
   * before it signs. A 409 means someone took the spot first.
   */
  async function requestPayment(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setChallenge(null)
    try {
      const res = await fetch(`${API}/spots/${selected}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ track_uri: track, term, network, buyer: 'demo-ui' }),
      })
      const data = await res.json()
      if (res.status === 402) {
        setChallenge({ status: res.status, body: data })
      } else if (!res.ok) {
        const next = data.next_free_spot
        setError(`${data.error?.message ?? data.message ?? 'Request failed'}${next ? ` — next free spot is ${next}` : ''}`)
        if (next) setSpot(String(next))
      } else {
        // Only reachable when a payment was attached, which this page cannot do.
        setChallenge({ status: res.status, body: data })
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={S.page}>
      <style>{CSS}</style>

      {/*
        Not "Pitch402" — the page above already said that. This is the working
        half, and it should announce itself as the thing that actually charges.
      */}
      <header>
        <h1 style={S.h1}>Live console</h1>
        <p style={S.sub}>
          The same API an agent calls, with a browser wallet in front of it. A curator opens a
          100-spot playlist. An artist or agent buys a numbered spot with USDC over
          x402 — on Base Sepolia or HashKey Chain Testnet. Cheaper spots sit lower in the list.
        </p>
      </header>

      <section style={S.stats}>
        <Stat label="Cycle" value={playlist ? `#${playlist.cycle}` : '…'} />
        <Stat label="Sold" value={playlist ? `${playlist.spots_sold} / ${playlist.spots_per_cycle}` : '…'} />
        <Stat label="Next free spot" value={playlist?.next_free_spot ? `#${playlist.next_free_spot}` : '—'} />
        <Stat label="Next spot price" value={quote ? `${quote.price.amount} USDC` : '—'} />
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>Buy a spot</h2>

        <div style={S.netRow}>
          <span style={S.netLabel}>Pay on</span>
          {(playlist?.payment.networks ?? []).map((n) => (
            <button
              key={n.network}
              type="button"
              onClick={() => setNetwork(n.network)}
              className={`net ${network === n.network ? 'on' : ''}`}
              title={`${n.name} · ${n.chain}`}
            >
              {n.name}
              <small>{n.settlement === 'live' ? 'settles live' : 'no facilitator'}</small>
            </button>
          ))}
        </div>

        <form onSubmit={buyWithWallet} style={S.form}>
          <label style={S.label}>
            Spotify track URL
            <input value={track} onChange={(e) => setTrack(e.target.value)} style={S.input} required />
          </label>

          {trackInfo && (
            <a href={trackInfo.url} target="_blank" rel="noreferrer" style={S.trackCard}>
              {trackInfo.album_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={trackInfo.album_image} alt="" width={56} height={56} style={S.art} />
              ) : (
                <div style={{ ...S.art, ...S.artFallback }}>♪</div>
              )}
              <div style={S.trackMeta}>
                <strong style={S.trackName}>
                  {trackInfo.name}
                  {trackInfo.explicit && <span style={S.explicit}>E</span>}
                </strong>
                <span style={S.trackSub}>{trackInfo.artist}</span>
                <span style={S.trackSub}>
                  {trackInfo.album} · {mmss(trackInfo.duration_ms)}
                </span>
              </div>
            </a>
          )}
          {!trackInfo && trackBusy && <p style={S.fine}>Looking up track…</p>}
          {trackErr && <p style={S.error}>{trackErr}</p>}
          <div style={S.row}>
            <label style={{ ...S.label, flex: '1 1 8rem' }}>
              Spot
              <input
                type="number"
                min={1}
                max={playlist?.spots_per_cycle ?? 100}
                value={spot}
                onChange={(e) => setSpot(e.target.value)}
                style={S.input}
                required
              />
            </label>
            <label style={{ ...S.label, flex: '1 1 8rem' }}>
              Term
              <select value={term} onChange={(e) => setTerm(e.target.value)} style={S.input}>
                {Object.entries(playlist?.pricing.term_multipliers ?? { cycle: 1 }).map(([t, m]) => (
                  <option key={t} value={t}>
                    {t} ({m}x)
                  </option>
                ))}
              </select>
            </label>
            <div style={{ ...S.label, flex: '1 1 8rem' }}>
              Total
              <div style={{ ...S.input, ...S.total }}>{selectedTotal}</div>
            </div>
          </div>
          <div style={S.actions}>
            <button type="submit" disabled={paying || busy} style={S.button}>
              {paying ? 'Waiting for your wallet…' : wallet ? `Buy spot ${selected} — ${selectedTotal}` : 'Connect wallet & buy'}
            </button>
            <button type="button" onClick={() => setShowAgent((v) => !v)} style={S.buttonGhost}>
              {showAgent ? 'Hide' : 'Hand this to an agent'}
            </button>
            <button type="button" onClick={requestPayment} disabled={busy || paying} style={S.buttonGhostQuiet}>
              {busy ? 'Requesting…' : 'Raw 402'}
            </button>
          </div>

          {showAgent && (
            <HandToAgent
              order={{
                base: typeof window === 'undefined' ? '' : window.location.origin,
                playlist: 'demo',
                spot: selected,
                term,
                trackUri: trackInfo?.uri ?? track,
                price: String(Number(priceOf(selected)) * multiplier),
              }}
            />
          )}

          {wallet ? (
            <p style={S.fine}>
              Paying from <Code>{`${wallet.slice(0, 6)}…${wallet.slice(-4)}`}</Code>
              {balance !== null && <> · {balance} USDC on Base Sepolia</>}
              {balance !== null && balance < Number(priceOf(selected)) * multiplier && (
                <span style={S.warn}> — not enough for this spot</span>
              )}
              . You sign an authorization, not a transaction: no ETH, no gas.
            </p>
          ) : (
            <p style={S.fine}>
              {hasWallet
                ? 'Needs Base Sepolia USDC. You will be asked to switch network, then to sign — no gas, no account, no signup.'
                : 'No browser wallet detected. Install MetaMask, or buy headlessly with examples/buy-spot.ts — no credentials from us either way.'}
            </p>
          )}
        </form>

        {error && <p style={S.error}>{error}</p>}

        {receipt && (
          <div style={S.paid}>
            <strong>Paid — spot {receipt.spot} is yours</strong>
            <dl style={S.dl}>
              <Row k="Amount" v={`${receipt.amount_paid} ${receipt.currency} (${receipt.term})`} />
              <Row k="Track" v={receipt.track ? `${receipt.track.name} — ${receipt.track.artist}` : receipt.track_uri} />
              <Row k="Network" v={receipt.payment.network_name} />
              <Row k="Settled" v={receipt.payment.settled ? 'yes, onchain' : 'confirming…'} />
              <Row
                k="Spotify"
                v={
                  receipt.spotify.status === 'placed'
                    ? `on the playlist at position ${receipt.spotify.position}`
                    : `${receipt.spotify.status}: ${receipt.spotify.error ?? receipt.spotify.reason ?? ''}`
                }
              />
            </dl>
            {tx && (
              <p style={S.fine}>
                <a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer" style={S.txLink}>
                  View the USDC transfer on Basescan ↗
                </a>
                <br />
                <code style={S.txHash}>{tx}</code>
              </p>
            )}
            <p style={S.fine}>
              <a href={receipt.receipt_url} target="_blank" rel="noreferrer">Receipt</a>
              {receipt.spotify.playlist_url && (
                <>
                  {' · '}
                  <a href={receipt.spotify.playlist_url} target="_blank" rel="noreferrer">Open the playlist</a>
                </>
              )}
              {receipt.spotify.status === 'failed' && receipt.spotify.retry_url && (
                <> · the spot is paid for and held; the placement can be retried</>
              )}
            </p>
          </div>
        )}

        {challenge && (
          <div style={S.receipt}>
            <strong>HTTP {challenge.status} — payment required</strong>
            <dl style={S.dl}>
              <Row k="Spot" v={`#${challenge.body.spot ?? selected}`} />
              <Row
                k="Price"
                v={
                  challenge.body.price
                    ? `${challenge.body.price.amount} ${challenge.body.price.currency} (${challenge.body.term ?? term})`
                    : '—'
                }
              />
              <Row k="Pay to" v={challenge.body.payment?.pay_to ?? '—'} />
              <Row k="Network" v={challenge.body.payment?.selected_network ?? network} />
              <Row k="Settlement" v={challenge.body.payment?.settlement ?? '—'} />
            </dl>
            {challenge.body.message && <p style={S.fine}>{challenge.body.message}</p>}
            <details>
              <summary style={S.fine}>Raw 402 body</summary>
              <pre style={S.pre}>{JSON.stringify(challenge.body, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>

      <section style={S.card}>
        <div style={S.legendRow}>
          <h2 style={S.h2}>100 spots</h2>
          <div style={S.legend}>
            {(playlist?.pricing.tiers ?? []).map((t) => (
              <span key={t.from} style={S.legendItem}>
                <i className={`sw t${t.price}`} /> {t.price} USDC
              </span>
            ))}
            <span style={S.legendItem}>
              <i className="sw taken" /> taken
            </span>
          </div>
        </div>
        <div className="grid">
          {Array.from({ length: playlist?.spots_per_cycle ?? 100 }, (_, i) => i + 1).map((n) => {
            const taken = takenSet.has(n)
            return (
              <button
                key={n}
                type="button"
                onClick={() => !taken && setSpot(String(n))}
                disabled={taken}
                className={`spot t${priceOf(n)} ${taken ? 'taken' : ''} ${selected === n ? 'sel' : ''}`}
                title={taken ? `Spot ${n} — taken` : `Spot ${n} — ${priceOf(n)} USDC`}
              >
                <b>{n}</b>
                <small>{taken ? '—' : priceOf(n)}</small>
              </button>
            )
          })}
        </div>
      </section>

      <footer style={S.footer}>
        For agents:{' '}
        {['/agents', '/api/v1/playlists/demo', '/api/v1/playlists/demo/quote?next=1', '/llms.txt', '/.well-known/agent.json'].map(
          (href) => (
            <a key={href} href={href} style={S.link}>
              {href}
            </a>
          ),
        )}
      </footer>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.stat}>
      <span style={S.statLabel}>{label}</span>
      <span style={S.statValue}>{value}</span>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ background: '#f1f5f9', borderRadius: '.2rem', padding: '.05rem .25rem' }}>{children}</code>
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={S.dt}>{k}</dt>
      <dd style={S.dd}>{v}</dd>
    </>
  )
}

const CSS = `
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.4rem, 1fr)); gap: .35rem; }
.spot { display:flex; flex-direction:column; align-items:center; gap:.1rem; padding:.4rem .2rem;
  border:1px solid #d7d7e0; border-radius:.4rem; background:#fff; cursor:pointer; font:inherit; color:#111; }
.spot b { font-size:.8rem; font-weight:600; }
.spot small { font-size:.65rem; color:#666; }
.spot:hover:not(:disabled) { border-color:#4f46e5; }
.spot.sel { outline:2px solid #4f46e5; outline-offset:1px; }
.spot.taken { background:#f1f1f4; color:#9a9aa8; cursor:not-allowed; text-decoration:line-through; }
.spot.t10 { background:#eef2ff; } .spot.t5 { background:#f5f3ff; } .spot.t3 { background:#f8fafc; }
.spot.taken.t10, .spot.taken.t5, .spot.taken.t3 { background:#f1f1f4; }
.sw { display:inline-block; width:.7rem; height:.7rem; border-radius:.2rem; border:1px solid #d7d7e0; vertical-align:middle; }
.sw.t10 { background:#eef2ff; } .sw.t5 { background:#f5f3ff; } .sw.t3 { background:#f8fafc; }
.sw.t1 { background:#fff; } .sw.taken { background:#f1f1f4; }
.net { display:flex; flex-direction:column; align-items:flex-start; gap:.05rem; padding:.35rem .6rem;
  border:1px solid #d7d7e0; border-radius:.4rem; background:#fff; font:inherit; font-size:.82rem;
  color:#111; cursor:pointer; }
.net small { font-size:.65rem; color:#777; }
.net.on { border-color:#4f46e5; background:#eef2ff; }
.net.on small { color:#4f46e5; }
`

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: '54rem', margin: '0 auto', padding: '2rem', color: '#111' },
  h1: { margin: '0 0 .2rem', fontSize: '1.6rem' },
  sub: { margin: '0 0 1.2rem', color: '#555', maxWidth: '42rem' },
  stats: { display: 'flex', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1.2rem' },
  stat: { flex: '1 1 8rem', border: '1px solid #e5e5ec', borderRadius: '.5rem', padding: '.6rem .7rem', background: '#fff' },
  statLabel: { display: 'block', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#777' },
  statValue: { display: 'block', fontSize: '1.15rem', fontWeight: 600 },
  card: { border: '1px solid #e5e5ec', borderRadius: '.6rem', padding: '1rem', background: '#fff', marginBottom: '1.2rem' },
  h2: { margin: '0 0 .7rem', fontSize: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '.6rem' },
  netRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.4rem', marginBottom: '.8rem' },
  netLabel: { fontSize: '.8rem', color: '#555', marginRight: '.2rem' },
  row: { display: 'flex', flexWrap: 'wrap', gap: '.6rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8rem', color: '#555' },
  input: { padding: '.45rem .55rem', border: '1px solid #d7d7e0', borderRadius: '.35rem', font: 'inherit', fontSize: '.85rem', color: '#111', background: '#fff' },
  total: { display: 'flex', alignItems: 'center', fontWeight: 600, background: '#fafafe' },
  button: { alignSelf: 'flex-start', padding: '.55rem 1rem', border: 0, borderRadius: '.4rem', background: '#4f46e5', color: '#fff', font: 'inherit', fontWeight: 600, cursor: 'pointer' },
  fine: { margin: 0, fontSize: '.75rem', color: '#777', lineHeight: 1.45 },
  actions: { display: 'flex', gap: '.5rem', flexWrap: 'wrap' },
  buttonGhost: { padding: '.6rem .9rem', borderRadius: '.45rem', border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: '.82rem', cursor: 'pointer' },
  buttonGhostQuiet: { padding: '.6rem .7rem', borderRadius: '.45rem', border: '1px solid transparent', background: 'transparent', color: '#94a3b8', fontSize: '.78rem', cursor: 'pointer' },
  paid: { marginTop: '.9rem', padding: '.8rem', borderRadius: '.5rem', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '.85rem' },
  warn: { color: '#b45309', fontWeight: 600 },
  txLink: { color: '#047857', fontWeight: 600 },
  txHash: { fontSize: '.66rem', color: '#94a3b8', wordBreak: 'break-all' },
  trackCard: { display: 'flex', gap: '.7rem', alignItems: 'center', padding: '.55rem', borderRadius: '.5rem', border: '1px solid #e2e8f0', background: '#fff', textDecoration: 'none', color: 'inherit' },
  art: { borderRadius: '.3rem', objectFit: 'cover', flex: '0 0 auto' },
  artFallback: { width: 56, height: 56, display: 'grid', placeItems: 'center', background: '#f1f5f9', color: '#94a3b8', fontSize: '1.4rem' },
  trackMeta: { display: 'flex', flexDirection: 'column', gap: '.12rem', minWidth: 0 },
  trackName: { fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: '.35rem' },
  trackSub: { fontSize: '.75rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  explicit: { fontSize: '.6rem', background: '#94a3b8', color: '#fff', borderRadius: '.15rem', padding: '0 .2rem', lineHeight: 1.5 },
  error: { marginTop: '.8rem', padding: '.55rem .7rem', borderRadius: '.4rem', background: '#fef2f2', color: '#b91c1c', fontSize: '.85rem' },
  receipt: { marginTop: '.9rem', padding: '.8rem', borderRadius: '.5rem', background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '.85rem' },
  pre: { margin: '.5rem 0 0', padding: '.6rem', borderRadius: '.4rem', background: '#0f172a', color: '#e2e8f0', fontSize: '.7rem', lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  dl: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.15rem .7rem', margin: '.5rem 0' },
  dt: { color: '#555' },
  dd: { margin: 0, wordBreak: 'break-all' },
  legendRow: { display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'baseline', justifyContent: 'space-between' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: '.7rem', fontSize: '.72rem', color: '#666', marginBottom: '.7rem' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: '.3rem' },
  footer: { display: 'flex', flexWrap: 'wrap', gap: '.7rem', fontSize: '.78rem', color: '#777' },
  link: { color: '#4f46e5' },
}
