import { randomUUID } from 'node:crypto'
import {
  SPOTS_PER_CYCLE,
  TERM_MULTIPLIERS,
  TIERS,
  USDC_DECIMALS,
  type Term,
} from '@/config/pitch402.config'

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
  buyer: string | null
  addedAt: string
  receiptId: string
}

export type Receipt = SoldSpot & {
  id: string
  playlistId: string
  cycle: number
  currency: 'USDC'
  decimals: number
  /** how the payment was settled: a real x402 payment, or the demo shortcut */
  paymentMethod: 'x402' | 'fake'
  paymentReference: string | null
  /** true once the facilitator confirms settlement; fake payments never settle */
  settled: boolean
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

function seed(): { playlists: Map<string, Playlist>; receipts: Map<string, Receipt> } {
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
  return { playlists: new Map([[demo.id, demo]]), receipts: new Map() }
}

/**
 * Held on globalThis on purpose. Next bundles each route handler separately,
 * so a plain module-level Map gives every route its own copy and a spot bought
 * through POST stays invisible to the quote and receipt routes. Dies on restart
 * — real persistence arrives with the contract.
 */
const globalForStore = globalThis as unknown as {
  __pitch402Store?: ReturnType<typeof seed>
}

const state = (globalForStore.__pitch402Store ??= seed())
const playlists = state.playlists

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

const receipts = state.receipts

export function getReceipt(id: string): Receipt | undefined {
  return receipts.get(id)
}

export type SellInput = {
  spot: number
  /** price snapshotted at purchase, in USDC's smallest unit */
  amountAtomic: string
  amount: string
  term: Term
  trackUri: string
  buyer: string | null
  paymentMethod: 'x402' | 'fake'
  paymentReference: string | null
}

/**
 * Take a spot. Rejects if the spot was claimed in the meantime, so the caller
 * always re-checks rather than trusting an earlier quote. The price passed in
 * is the snapshot: it is stored as paid and never recomputed afterwards.
 */
export function sellSpot(playlist: Playlist, input: SellInput): Receipt {
  if (isTaken(playlist, input.spot)) {
    throw new SpotTakenError(input.spot)
  }

  const receiptId = `rcpt_${randomUUID().replace(/-/g, '')}`
  const sold: SoldSpot = {
    spot: input.spot,
    amountAtomic: input.amountAtomic,
    amount: input.amount,
    term: input.term,
    trackUri: input.trackUri,
    buyer: input.buyer,
    addedAt: new Date().toISOString(),
    receiptId,
  }
  playlist.sold.push(sold)
  if (spotsRemaining(playlist) === 0) {
    playlist.status = 'full'
  }

  const receipt: Receipt = {
    ...sold,
    id: receiptId,
    playlistId: playlist.id,
    cycle: playlist.cycle,
    currency: 'USDC',
    decimals: USDC_DECIMALS,
    paymentMethod: input.paymentMethod,
    paymentReference: input.paymentReference,
    settled: false,
  }
  receipts.set(receiptId, receipt)
  return receipt
}

/**
 * Undo a sale. Used when a payment is verified but settlement then fails, so a
 * spot is never held against money that never moved.
 */
export function releaseSpot(playlistId: string, receiptId: string): boolean {
  const playlist = playlists.get(playlistId)
  if (!playlist) return false
  const index = playlist.sold.findIndex((s) => s.receiptId === receiptId)
  if (index === -1) return false
  playlist.sold.splice(index, 1)
  receipts.delete(receiptId)
  if (playlist.status === 'full') playlist.status = 'open'
  return true
}

/** Record the settlement transaction once the facilitator confirms it. */
export function markReceiptSettled(receiptId: string, reference: string | null): boolean {
  const receipt = receipts.get(receiptId)
  if (!receipt) return false
  receipt.paymentReference = reference
  receipt.settled = true
  return true
}

export class SpotTakenError extends Error {
  constructor(public readonly spot: number) {
    super(`spot ${spot} is already taken`)
    this.name = 'SpotTakenError'
  }
}

/** Tier ladder and term multipliers as served to agents. */
export function publicTerms() {
  return {
    tiers: TIERS.map((t) => ({ from: t.from, to: t.to, price: t.price, currency: 'USDC' })),
    termMultipliers: TERM_MULTIPLIERS,
  }
}
