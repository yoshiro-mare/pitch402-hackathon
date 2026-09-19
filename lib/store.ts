import { SPOTS_PER_CYCLE, TERM_MULTIPLIERS, TIERS, type Term } from '@/config/pitch402.config'

/**
 * In-memory inventory for the MVP. One demo cycle, 100 empty spots.
 * Swapped for the contract + a real store later in the build order.
 */

export type SoldSpot = {
  spot: number
  /** price snapshotted at payment, in USDC's smallest unit */
  amountAtomic: string
  amount: string
  term: Term
  trackUri: string
  buyer: string
  addedAt: string
  receiptId: string
}

export type Playlist = {
  id: string
  name: string
  curator: string
  /** Spotify playlist this cycle writes to. Curator-owned, never editorial. */
  spotifyPlaylistId: string | null
  spotifyFollowers: number | null
  cycle: number
  status: 'open' | 'full' | 'closed'
  spotsPerCycle: number
  sold: SoldSpot[]
}

const demo: Playlist = {
  id: 'demo',
  name: 'Pitch402 Demo Cycle',
  curator: 'demo-curator',
  spotifyPlaylistId: null,
  spotifyFollowers: null,
  cycle: 1,
  status: 'open',
  spotsPerCycle: SPOTS_PER_CYCLE,
  sold: [],
}

const playlists = new Map<string, Playlist>([[demo.id, demo]])

export function listPlaylists(): Playlist[] {
  return [...playlists.values()]
}

export function getPlaylist(id: string): Playlist | undefined {
  return playlists.get(id)
}

export function isTaken(playlist: Playlist, spot: number): boolean {
  return playlist.sold.some((s) => s.spot === spot)
}

/** Lowest spot number still free in this cycle, or null when the cycle is full. */
export function nextFreeSpot(playlist: Playlist): number | null {
  for (let spot = 1; spot <= playlist.spotsPerCycle; spot += 1) {
    if (!isTaken(playlist, spot)) return spot
  }
  return null
}

export function spotsRemaining(playlist: Playlist): number {
  return playlist.spotsPerCycle - playlist.sold.length
}

/** Tier ladder and term multipliers as served to agents. */
export function publicTerms() {
  return {
    tiers: TIERS.map((t) => ({ from: t.from, to: t.to, price: t.price, currency: 'USDC' })),
    termMultipliers: TERM_MULTIPLIERS,
  }
}
