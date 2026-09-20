/**
 * The palette the landing page was designed in, in one place so the landing
 * and the console cannot drift apart.
 *
 * The three status colours are not invented: they are the alternate accents
 * the design itself shipped as options, reused for success, warning and error
 * so they sit in the same family as everything else.
 */

export const BG = '#0B0B0A'
export const PANEL = '#131210'
export const PANEL_2 = '#1C1A18'

export const INK = '#F1EFE9'
export const MUTED = '#9A968E'
export const MUTED_2 = '#B3AFA6'
export const DIM = '#6B6862'

export const LINE = '#23211E'
export const LINE_2 = '#33302B'
export const LINE_3 = '#2E2C28'

export const ACCENT = 'oklch(0.68 0.17 265)'
export const OK = 'oklch(0.75 0.16 145)'
export const WARN = 'oklch(0.8 0.15 85)'
export const BAD = 'oklch(0.68 0.19 25)'

export const MONO = 'var(--font-mono), ui-monospace, monospace'

/** The landing's container, so both halves share one left edge. */
export const GUTTER = '0 clamp(18px,3vw,40px)'
export const MAX_W = 1320

/**
 * Tier colour keyed off the price rather than the spot number, because tiers
 * are editable per cycle. Shared by the landing grid and the console grid.
 */
export function tierStyle(price: string): { bg: string; fg: string } {
  switch (price) {
    case '10':
      return { bg: INK, fg: BG }
    case '5':
      return { bg: ACCENT, fg: '#FFFFFF' }
    case '3':
      return { bg: `color-mix(in oklch, ${ACCENT} 36%, ${BG})`, fg: INK }
    default:
      return { bg: LINE, fg: INK }
  }
}
