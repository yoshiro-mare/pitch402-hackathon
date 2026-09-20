'use client'

/**
 * The landing page, ported from the Claude Design bundle.
 *
 * One thing changed on the way in. The design shipped its inventory as a prop
 * — fourteen spots taken, a couple carved out by hand — which is fine for a
 * mockup and would be a lie on the front page of a thing that sells those
 * spots. The grid below reads the same API an agent reads, so what a visitor
 * counts is what they can actually buy. If that call fails the grid renders
 * every spot open and says the count is unknown, rather than inventing one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'

import { ACCENT, BG, DIM, GUTTER, INK, LINE, LINE_2, MAX_W, MONO, MUTED, MUTED_2, PANEL, tierStyle } from './theme'

const API = '/api/v1/playlists/demo'
const SOURCE = 'https://github.com/yoshiro-mare/pitch402-hackathon'

type Tier = { from: number; to: number; price: string }

type Inventory = {
  spotsPerCycle: number
  cycle: number
  taken: Set<number>
  nextFree: number | null
  tiers: Tier[]
  playlistUrl: string | null
  /** false until the API has answered, so nothing claims a count it does not have */
  known: boolean
}

const UNKNOWN: Inventory = {
  spotsPerCycle: 100,
  cycle: 1,
  taken: new Set(),
  nextFree: 1,
  tiers: [
    { from: 1, to: 1, price: '10' },
    { from: 2, to: 3, price: '5' },
    { from: 4, to: 10, price: '3' },
    { from: 11, to: 100, price: '1' },
  ],
  playlistUrl: null,
  known: false,
}

export default function Landing({ onPickSpot }: { onPickSpot?: (spot: number) => void }) {
  const [inv, setInv] = useState<Inventory>(UNKNOWN)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(API)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        setInv({
          spotsPerCycle: d.spots_per_cycle ?? 100,
          cycle: d.cycle ?? 1,
          taken: new Set<number>((d.sold ?? []).map((s: { spot: number }) => s.spot)),
          nextFree: d.next_free_spot ?? null,
          tiers: d.pricing?.tiers ?? UNKNOWN.tiers,
          playlistUrl: d.spotify?.playlist_url ?? null,
          known: true,
        })
      })
      .catch(() => {
        // Leave the grid in its unknown state. It renders as all-open and the
        // counts read "—", which is true: we do not know.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const priceOf = useCallback(
    (n: number): string => inv.tiers.find((t) => n >= t.from && n <= t.to)?.price ?? '1',
    [inv.tiers],
  )

  // The selected spot, falling back to the next free one — and falling back
  // again the moment someone else buys the spot that was selected.
  const spot = picked !== null && !inv.taken.has(picked) ? picked : (inv.nextFree ?? 1)
  const spotLabel = String(spot).padStart(2, '0')
  const unit = priceOf(spot)

  const takenCount = inv.taken.size
  const freeCount = inv.spotsPerCycle - takenCount

  const pick = useCallback(
    (n: number) => {
      setPicked(n)
      onPickSpot?.(n)
    },
    [onPickSpot],
  )

  const cells = useMemo(
    () =>
      Array.from({ length: inv.spotsPerCycle }, (_, i) => {
        const n = i + 1
        const isTaken = inv.taken.has(n)
        const { bg, fg } = tierStyle(priceOf(n))
        return {
          n,
          isTaken,
          bg: isTaken ? 'transparent' : bg,
          fg: isTaken ? DIM : fg,
          border: isTaken ? '1px dashed #4A473F' : '1px solid transparent',
          ring: n === spot ? `2px solid ${INK}` : '0px solid transparent',
        }
      }),
    [inv.spotsPerCycle, inv.taken, priceOf, spot],
  )

  return (
    <div style={{ maxWidth: MAX_W, margin: '0 auto', padding: GUTTER }}>
      <style>{CSS}</style>

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          padding: '26px 0',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Image src="/pitch402-mark.png" alt="Pitch402" width={28} height={28} style={{ objectFit: 'contain', filter: 'invert(1)' }} />
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.03em' }}>PITCH402</span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 28, font: `11px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          <a className="lnk" href="#rails">The rail</a>
          <a className="lnk" href="#spots">The 100</a>
          <a className="lnk" href="#agents">Agents</a>
          <a className="btn-light" href="#console">Open the endpoint</a>
        </nav>
      </header>

      {/* ── hero ───────────────────────────────────────────────────────── */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))',
          gap: 'clamp(28px,4vw,56px)',
          alignItems: 'end',
          padding: 'clamp(30px,5vw,70px) 0 clamp(40px,6vw,90px)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: `11px ${MONO}`, letterSpacing: '0.16em', textTransform: 'uppercase', color: MUTED }}>
            <span style={{ width: 26, height: 1, background: ACCENT }} />
            <span>{inv.spotsPerCycle} spots · one cycle · x402</span>
          </div>
          <h1 style={{ margin: '26px 0 0', fontSize: 'clamp(56px,11vw,150px)', lineHeight: 0.82, letterSpacing: '-0.06em', fontWeight: 800, textTransform: 'uppercase' }}>
            Buy the
            <br />
            shelf
          </h1>
          <p style={{ margin: '30px 0 0', fontSize: 'clamp(16px,1.5vw,19px)', lineHeight: 1.5, color: MUTED_2, maxWidth: '30em' }}>
            Agents already make the music. They still cannot buy the shelf without a form, an inbox, and a week or months of waiting.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 36 }}>
            <a className="btn-accent" href="#console">
              Take spot {spotLabel} — {unit} USDC
            </a>
            <a className="btn-ghost" href="#rails">
              How the rail works
            </a>
          </div>
        </div>

        <div>
          <div style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 4, overflow: 'hidden', background: PANEL }}>
            <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg,rgba(241,239,233,0.05) 0px,rgba(241,239,233,0.05) 1px,transparent 1px,transparent 22px)' }} />
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(90% 70% at 50% 40%,oklch(0.68 0.17 265 / 0.28) 0%,rgba(11,11,10,0) 62%)` }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12% 18% 24%' }}>
              <Image src="/pitch402-mark.png" alt="" width={553} height={575} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'invert(1)', opacity: 0.94 }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <div style={{ background: 'rgba(11,11,10,0.86)', border: `1px solid ${LINE}`, borderRadius: 3, padding: '16px 20px' }}>
              <div style={{ font: `10px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Next free spot</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 8 }}>
                <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 0.85 }}>{spotLabel}</span>
                <span style={{ font: `11px ${MONO}`, color: MUTED, paddingBottom: 5 }}>/ {inv.spotsPerCycle}</span>
              </div>
            </div>
            <div style={{ background: 'rgba(11,11,10,0.86)', border: `1px solid ${LINE}`, borderRadius: 3, padding: '16px 20px', textAlign: 'right' }}>
              <div style={{ font: `10px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Public price</div>
              <div style={{ font: `26px ${MONO}`, letterSpacing: '-0.03em', marginTop: 8 }}>{unit} USDC</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── the pitch ──────────────────────────────────────────────────── */}
      <section style={{ paddingBottom: 'clamp(36px,5vw,72px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 20, font: `11px ${MONO}`, letterSpacing: '0.16em', textTransform: 'uppercase', color: MUTED }}>
          <span>The pitch · 2 min</span>
          <span>Why the rail exists</span>
        </div>
        {/*
          A still that links out, not an embed. Nothing from YouTube loads
          until someone asks for it.
        */}
        <a
          className="poster"
          href="https://youtu.be/D22WmXAc1kk"
          target="_blank"
          rel="noopener noreferrer"
          style={{ position: 'relative', display: 'block', aspectRatio: '16/9', border: `1px solid ${LINE}`, borderRadius: 4, overflow: 'hidden', background: PANEL }}
        >
          <Image src="/pitch-thumbnail.jpg" alt="Pitch402 — the pitch" width={1280} height={720} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.72 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(11,11,10,0.15) 0%,rgba(11,11,10,0.8) 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 74, height: 74, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 36px 6px oklch(0.68 0.17 265 / 0.35)` }}>
              <span style={{ width: 0, height: 0, borderLeft: '20px solid #FFFFFF', borderTop: '13px solid transparent', borderBottom: '13px solid transparent', marginLeft: 5 }} />
            </span>
          </div>
          <span style={{ position: 'absolute', left: 20, bottom: 18, font: `11px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK }}>
            Watch the pitch on YouTube
          </span>
        </a>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(20px,4vw,56px)', padding: '26px 0', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, font: `11px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>
        <span>Public price</span>
        <span>Instant slot</span>
        <span>Machine-readable discovery</span>
        <span style={{ color: INK }}>No human in the loop</span>
      </div>

      {/* ── the rail ───────────────────────────────────────────────────── */}
      <section id="rails" style={{ padding: 'clamp(56px,8vw,110px) 0' }}>
        <p style={{ margin: 0, fontSize: 'clamp(24px,3.4vw,46px)', lineHeight: 1.1, letterSpacing: '-0.04em', fontWeight: 700, maxWidth: '24em' }}>
          That economy will not email PDFs to A&amp;R. It will hit an endpoint.
        </p>
        <p style={{ margin: '22px 0 0', fontSize: 16, lineHeight: 1.6, color: MUTED, maxWidth: '38em' }}>
          Pitch402 is that endpoint for the one resource that still matters in music: being on the list.
        </p>

        <div style={{ marginTop: 'clamp(36px,5vw,64px)', borderTop: `1px solid ${LINE}` }}>
          <Rail
            n="01"
            title="Public price"
            body={`Position is the product. ${inv.tiers.map((t) => (t.from === t.to ? `Spot ${t.from} costs ${t.price}` : `${t.from}–${t.to} cost ${t.price}`)).join(', ')} USDC. The amount is fixed at payment, so retiering never reprices a spot someone already bought.`}
            figure={<PriceFigure />}
          />
          <Rail
            n="02"
            title="Instant slot"
            body="Payment and placement are one request. The track lands on the curator’s own playlist at the spot that was bought, in spot order, however the sales arrive."
            figure={<SlotFigure />}
          />
          <Rail
            n="03"
            title="Machine-readable discovery"
            body="Every response carries the exact URL to call next, and the service describes itself to any crawling agent. No scraping, no login, no human approval."
            figure={<DiscoveryFigure />}
          />
        </div>
      </section>

      {/* ── live on spotify ────────────────────────────────────────────── */}
      <section style={{ paddingBottom: 'clamp(56px,8vw,110px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(24px,3vw,40px)', lineHeight: 1, letterSpacing: '-0.04em', fontWeight: 800, textTransform: 'uppercase' }}>Live on Spotify</h2>
          <span style={{ font: `11px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Pitch402 Demo Cycle · cycle {inv.cycle}</span>
        </div>
        <a
          href={inv.playlistUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', border: `1px solid ${LINE}`, borderRadius: 4, overflow: 'hidden', background: PANEL }}
        >
          <Image src="/demo-playlist.jpg" alt="The Pitch402 Demo Cycle playlist on Spotify" width={1280} height={662} style={{ display: 'block', width: '100%', height: 'auto' }} />
        </a>
        <p style={{ margin: '18px 0 0', font: `12px ${MONO}`, lineHeight: 1.7, color: MUTED, maxWidth: '44em' }}>
          The curator’s own playlist. Spots are sold by position and paid in USDC over x402 — a paid spot is inserted after every lower-numbered spot already placed, so the order holds however the sales arrive.
        </p>
      </section>

      {/* ── the 100 ────────────────────────────────────────────────────── */}
      <section id="spots" style={{ paddingBottom: 'clamp(56px,8vw,110px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 30 }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(28px,4vw,54px)', lineHeight: 1, letterSpacing: '-0.045em', fontWeight: 800, textTransform: 'uppercase' }}>The {inv.spotsPerCycle}</h2>
          <span style={{ font: `11px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>
            {inv.known ? `${freeCount} open · ${takenCount} taken` : 'loading inventory'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(42px,1fr))', gap: 5 }}>
          {cells.map((c) => (
            <button
              key={c.n}
              type="button"
              className="cell"
              disabled={c.isTaken}
              onClick={() => pick(c.n)}
              title={c.isTaken ? `Spot ${c.n} — taken` : `Spot ${c.n} — ${priceOf(c.n)} USDC`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                aspectRatio: '1',
                borderRadius: 2,
                font: `11px ${MONO}`,
                padding: 0,
                border: c.border,
                background: c.bg,
                color: c.fg,
                outline: c.ring,
                outlineOffset: 2,
              }}
            >
              {c.n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'center', marginTop: 24, font: `10px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          {inv.tiers.map((t) => {
            const { bg } = tierStyle(t.price)
            return (
              <span key={`${t.from}-${t.to}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: bg }} />
                {t.from === t.to ? `Spot ${t.from}` : `${t.from}–${t.to}`} · {t.price}
              </span>
            )
          })}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, border: '1px dashed #4A473F' }} />
            taken
          </span>
          <span style={{ color: INK }}>
            Selected: spot {spotLabel} · {unit} USDC
          </span>
        </div>
      </section>

      {/* ── agents ─────────────────────────────────────────────────────── */}
      <section id="agents" style={{ paddingBottom: 'clamp(56px,8vw,110px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 'clamp(24px,4vw,48px)', alignItems: 'start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 'clamp(28px,4vw,54px)', lineHeight: 1, letterSpacing: '-0.045em', fontWeight: 800, textTransform: 'uppercase' }}>
              What an agent
              <br />
              does, unaided
            </h2>
            <p style={{ margin: '24px 0 0', fontSize: 15, lineHeight: 1.6, color: MUTED, maxWidth: '32em' }}>
              Three calls, no inbox. The price was agreed before payment, and the receipt proves what was bought.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Step n="01" title="Ask the price" body="One call returns the spot, the price, and the exact URL to call next." />
            <Step n="02" title="Answer the 402" body="The server demands payment in USDC with signed requirements. The wallet signs the amount it was quoted." />
            <Step n="03" title="Keep the receipt" body="Settlement runs only after the placement succeeds. A spot taken mid-request returns 409 and the buyer is never charged." last />
          </div>
        </div>
      </section>

      {/* ── cta ────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', marginBottom: 'clamp(40px,6vw,80px)', background: PANEL }}>
        <div style={{ position: 'relative', padding: 'clamp(40px,7vw,110px) clamp(24px,4vw,60px)' }}>
          <p style={{ margin: 0, fontSize: 'clamp(26px,3.8vw,52px)', lineHeight: 1.05, letterSpacing: '-0.045em', fontWeight: 700, maxWidth: '24em' }}>
            Once that rail exists, labels, managers, and scouts can run the same motion while they sleep and anyone can build the next layer on top of it.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 36 }}>
            <a className="btn-light" href="#console" style={{ padding: '16px 26px', fontSize: 15, fontWeight: 700, letterSpacing: '-0.015em' }}>
              Open the endpoint
            </a>
            <a className="btn-ghost" href={SOURCE} target="_blank" rel="noopener noreferrer" style={{ borderColor: DIM }}>
              Read the source
            </a>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: `1px solid ${LINE}`, padding: '26px 0 46px', display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', justifyContent: 'space-between', font: `11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: DIM }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Image src="/pitch402-mark.png" alt="" width={18} height={18} style={{ objectFit: 'contain', filter: 'invert(1)' }} />
          <span>Pitch402 — testnets only, Base Sepolia settles live</span>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <a className="lnk" href="https://x402.org" target="_blank" rel="noopener noreferrer">x402.org</a>
          <a className="lnk" href="/llms.txt">llms.txt</a>
          <a className="lnk" href={SOURCE} target="_blank" rel="noopener noreferrer">github</a>
        </div>
      </footer>
    </div>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────── */

function Rail({ n, title, body, figure }: { n: string; title: string; body: string; figure: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 'clamp(18px,3vw,40px)', padding: 'clamp(26px,3vw,38px) 0', borderBottom: `1px solid ${LINE}`, alignItems: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <span style={{ font: `11px ${MONO}`, color: ACCENT }}>{n}</span>
        <h3 style={{ margin: 0, fontSize: 'clamp(22px,2.4vw,32px)', letterSpacing: '-0.035em', fontWeight: 700 }}>{title}</h3>
      </div>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: MUTED_2 }}>{body}</p>
      {figure}
    </div>
  )
}

function Step({ n, title, body, last }: { n: string; title: string; body: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', padding: '22px 0', borderTop: `1px solid ${LINE}`, borderBottom: last ? `1px solid ${LINE}` : undefined }}>
      <span style={{ font: `11px ${MONO}`, color: ACCENT }}>{n}</span>
      <div>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.025em' }}>{title}</div>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: MUTED, marginTop: 6 }}>{body}</div>
      </div>
    </div>
  )
}

/** Descending bars: the price ladder from spot 1 down to spot 100. */
function PriceFigure() {
  const heights = [100, 86, 74, 64, 55, 47, 40, 34, 29, 25]
  return (
    <div style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 3, overflow: 'hidden', background: PANEL }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: '3%', padding: '16% 9%' }}>
        {heights.map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 0 ? ACCENT : i < 3 ? DIM : '#2E2C28', borderRadius: 1 }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: '9%', right: '9%', bottom: '16%', height: 1, background: '#3A3833' }} />
    </div>
  )
}

/** One slot lighting up in a row of empties: the bought position. */
function SlotFigure() {
  return (
    <div style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 3, overflow: 'hidden', background: PANEL }}>
      <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '26%', height: 2, background: LINE_2 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: '2.4%', padding: '0 8% 26%' }}>
        {Array.from({ length: 8 }, (_, i) =>
          i === 3 ? (
            <div key={i} style={{ flex: 1, height: '78%', background: ACCENT, borderRadius: 2, boxShadow: `0 0 26px 2px oklch(0.68 0.17 265 / 0.4)` }} />
          ) : (
            <div key={i} style={{ flex: 1, height: '58%', background: '#1C1A18', border: '1px solid #2E2C28', borderRadius: 2 }} />
          ),
        )}
      </div>
    </div>
  )
}

/** A scan line sweeping a ruled field: agent.json and llms.txt being read. */
function DiscoveryFigure() {
  return (
    <div style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 3, overflow: 'hidden', background: PANEL }}>
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(101deg,rgba(241,239,233,0.42) 0px,rgba(241,239,233,0.42) 1px,transparent 1px,transparent 13px)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(101deg,rgba(241,239,233,0.14) 0px,rgba(241,239,233,0.14) 1px,transparent 1px,transparent 5px)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 100% 50%,rgba(11,11,10,0) 0%,rgba(11,11,10,0.55) 42%,rgba(11,11,10,0.97) 78%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: ACCENT, boxShadow: `0 0 22px 3px oklch(0.68 0.17 265 / 0.45)` }} />
      <div style={{ position: 'absolute', right: 18, bottom: 14, font: `10px ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>agent.json · llms.txt</div>
    </div>
  )
}

/**
 * The design expressed hover with a `style-hover` attribute its own runtime
 * understood. React has no such thing, so those states live here.
 */
const CSS = `
a { color: ${INK}; text-decoration: none; }
::selection { background: ${INK}; color: ${BG}; }

.lnk:hover { color: ${ACCENT}; }

.btn-light, .btn-accent, .btn-ghost {
  display: inline-flex; align-items: center; gap: 10px;
  border-radius: 2px; letter-spacing: -0.015em; font-weight: 700;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.btn-light { background: ${INK}; color: ${BG}; padding: 10px 18px;
  font: 500 11px ${MONO}; letter-spacing: 0.1em; }
.btn-light:hover { background: ${ACCENT}; color: #FFFFFF; }
.btn-accent { background: ${ACCENT}; color: #FFFFFF; padding: 16px 26px; font-size: 15px; }
.btn-accent:hover { background: ${INK}; color: ${BG}; }
.btn-ghost { border: 1px solid ${LINE_2}; padding: 16px 26px; font-size: 15px; font-weight: 600; }
.btn-ghost:hover { border-color: ${INK}; }

.poster { transition: border-color .15s ease; }
.poster:hover { border-color: ${INK}; }

.cell { cursor: pointer; transition: transform .12s ease; }
.cell:hover:not(:disabled) { transform: translateY(-2px); }
.cell:disabled { cursor: not-allowed; }

html { scroll-behavior: smooth; }
`
