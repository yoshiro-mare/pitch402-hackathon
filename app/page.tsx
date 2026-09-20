'use client'

import { useCallback, useEffect, useState } from 'react'

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
  sold: { spot: number; amount: string; term: string; added_at: string; receipt_url: string }[]
}

type Quote = {
  spot: number
  term: string
  price: { amount: string; amount_atomic: string }
  next_action: { method: string; url: string }
}

type Receipt = {
  receipt_id: string
  spot: number
  term: string
  amount_paid: string
  track_uri: string
  added_at: string
  payment: { method: string; settled: boolean; note: string }
}

const API = '/api/v1/playlists/demo'

export default function Home() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [track, setTrack] = useState('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
  const [spot, setSpot] = useState('')
  const [term, setTerm] = useState('cycle')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
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

  async function buy(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setReceipt(null)
    try {
      const res = await fetch(`${API}/spots/${selected}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-PITCH402-FAKE-PAY': '1' },
        body: JSON.stringify({ track_uri: track, term, buyer: 'demo-ui' }),
      })
      const data = await res.json()
      if (!res.ok) {
        const next = data.next_free_spot
        setError(
          `${data.error?.message ?? 'Buy failed'}${next ? ` — next free spot is ${next}` : ''}`,
        )
        if (next) setSpot(String(next))
      } else {
        setReceipt(data)
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

      <header>
        <h1 style={S.h1}>Pitch402</h1>
        <p style={S.sub}>
          A curator opens a 100-spot playlist. An artist or agent buys a numbered spot with USDC over
          x402 on Base Sepolia. Cheaper spots sit lower in the list.
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
        <form onSubmit={buy} style={S.form}>
          <label style={S.label}>
            Spotify track URL
            <input value={track} onChange={(e) => setTrack(e.target.value)} style={S.input} required />
          </label>
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
          <button type="submit" disabled={busy} style={S.button}>
            {busy ? 'Buying…' : 'Buy (demo / fake pay)'}
          </button>
          <p style={S.fine}>
            Demo shortcut: this sends the fake-pay header. No wallet, no USDC moves, nothing settles
            onchain. The same endpoint answers 402 with real x402 requirements when that header is absent.
          </p>
        </form>

        {error && <p style={S.error}>{error}</p>}

        {receipt && (
          <div style={S.receipt}>
            <strong>Receipt {receipt.receipt_id.slice(0, 14)}…</strong>
            <dl style={S.dl}>
              <Row k="Spot" v={`#${receipt.spot}`} />
              <Row k="Paid" v={`${receipt.amount_paid} USDC (${receipt.term})`} />
              <Row k="Track" v={receipt.track_uri} />
              <Row k="Added" v={new Date(receipt.added_at).toLocaleTimeString()} />
              <Row k="Payment" v={`${receipt.payment.method} · settled: ${String(receipt.payment.settled)}`} />
            </dl>
            <p style={S.fine}>{receipt.payment.note}</p>
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
        Agent API:{' '}
        {['/api/v1/playlists/demo', '/api/v1/playlists/demo/quote?next=1', '/llms.txt', '/.well-known/agent.json'].map(
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
`

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: '54rem', margin: '0 auto', color: '#111' },
  h1: { margin: '0 0 .2rem', fontSize: '1.6rem' },
  sub: { margin: '0 0 1.2rem', color: '#555', maxWidth: '42rem' },
  stats: { display: 'flex', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1.2rem' },
  stat: { flex: '1 1 8rem', border: '1px solid #e5e5ec', borderRadius: '.5rem', padding: '.6rem .7rem', background: '#fff' },
  statLabel: { display: 'block', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#777' },
  statValue: { display: 'block', fontSize: '1.15rem', fontWeight: 600 },
  card: { border: '1px solid #e5e5ec', borderRadius: '.6rem', padding: '1rem', background: '#fff', marginBottom: '1.2rem' },
  h2: { margin: '0 0 .7rem', fontSize: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '.6rem' },
  row: { display: 'flex', flexWrap: 'wrap', gap: '.6rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8rem', color: '#555' },
  input: { padding: '.45rem .55rem', border: '1px solid #d7d7e0', borderRadius: '.35rem', font: 'inherit', fontSize: '.85rem', color: '#111', background: '#fff' },
  total: { display: 'flex', alignItems: 'center', fontWeight: 600, background: '#fafafe' },
  button: { alignSelf: 'flex-start', padding: '.55rem 1rem', border: 0, borderRadius: '.4rem', background: '#4f46e5', color: '#fff', font: 'inherit', fontWeight: 600, cursor: 'pointer' },
  fine: { margin: 0, fontSize: '.75rem', color: '#777', lineHeight: 1.45 },
  error: { marginTop: '.8rem', padding: '.55rem .7rem', borderRadius: '.4rem', background: '#fef2f2', color: '#b91c1c', fontSize: '.85rem' },
  receipt: { marginTop: '.9rem', padding: '.8rem', borderRadius: '.5rem', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '.85rem' },
  dl: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.15rem .7rem', margin: '.5rem 0' },
  dt: { color: '#555' },
  dd: { margin: 0, wordBreak: 'break-all' },
  legendRow: { display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'baseline', justifyContent: 'space-between' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: '.7rem', fontSize: '.72rem', color: '#666', marginBottom: '.7rem' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: '.3rem' },
  footer: { display: 'flex', flexWrap: 'wrap', gap: '.7rem', fontSize: '.78rem', color: '#777' },
  link: { color: '#4f46e5' },
}
