import { randomUUID } from 'node:crypto'
import {
  SPOTS_PER_CYCLE,
  TERM_MULTIPLIERS,
  TIERS,
  USDC_DECIMALS,
  type NetworkId,
  type Term,
} from '@/config/pitch402.config'
import { db, dbEnabled, isUniqueViolation } from '@/lib/db'

/**
 * Inventory and receipts.
 *
 * Two backends behind one API. With Supabase configured, everything lives in
 * Postgres and survives restarts and multiple server instances. Without it,
 * everything lives in memory so the project runs with no setup — which is the
 * right default for a demo, and unsafe for anything else.
 *
 * Reads that only look at an already-loaded playlist stay synchronous; anything
 * that touches storage is async.
 */

/**
 * What happened when we tried to put this track on the curator's Spotify
 * playlist. Recorded per sale, never assumed: a spot can be paid for and the
 * Spotify write can still fail, and the receipt has to say so.
 */
export type Placement = {
  /**
   * 'placed'  — the track is on the playlist at `position`
   * 'failed'  — Spotify refused; `error` says why, and the sale can be retried
   * 'skipped' — no curator playlist is connected, so there was nothing to write to
   */
  status: 'placed' | 'failed' | 'skipped'
  /** zero-based index we asked Spotify to insert at, or null when nothing was written */
  position: number | null
  /** Spotify's snapshot id for the version of the playlist we created */
  snapshotId: string | null
  placedAt: string | null
  error: string | null
  reason: string | null
}

export type SoldSpot = {
  spot: number
  /** price snapshotted at payment, in USDC's smallest unit */
  amountAtomic: string
  amount: string
  term: Term
  trackUri: string
  buyer: string | null
  /** which chain the buyer chose to pay on */
  network: NetworkId
  addedAt: string
  receiptId: string
  placement: Placement
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
  spotifyPlaylistName: string | null
  spotifyPlaylistUrl: string | null
  spotifyOwnerId: string | null
  spotifyFollowers: number | null
  /**
   * How many items the playlist already held when the curator connected it.
   * Spot ordering is kept relative to those, so attaching a playlist that is
   * not empty does not scramble it.
   */
  spotifyBaseOffset: number
  spotifyConnectedAt: string | null
  cycle: number
  status: 'open' | 'full' | 'closed'
  spotsPerCycle: number
  sold: SoldSpot[]
}

export class SpotTakenError extends Error {
  constructor(public readonly spot: number) {
    super(`spot ${spot} is already taken`)
    this.name = 'SpotTakenError'
  }
}

export type SellInput = {
  spot: number
  /** price snapshotted at purchase, in USDC's smallest unit */
  amountAtomic: string
  amount: string
  term: Term
  trackUri: string
  buyer: string | null
  network: NetworkId
  paymentMethod: 'x402' | 'fake'
  paymentReference: string | null
}

export type SpotifyPlaylistMeta = {
  playlistId: string
  name: string
  url: string
  ownerId: string
  followers: number | null
  /** items already on the playlist when the curator connected it */
  baseOffset: number
}

const NEW_PLACEMENT: Placement = {
  status: 'skipped',
  position: null,
  snapshotId: null,
  placedAt: null,
  error: null,
  reason: 'not attempted yet',
}

function newReceiptId(): string {
  return `rcpt_${randomUUID().replace(/-/g, '')}`
}

function buildReceipt(playlist: Playlist, input: SellInput, receiptId: string, addedAt: string): Receipt {
  return {
    spot: input.spot,
    amountAtomic: input.amountAtomic,
    amount: input.amount,
    term: input.term,
    trackUri: input.trackUri,
    buyer: input.buyer,
    network: input.network,
    addedAt,
    receiptId,
    placement: { ...NEW_PLACEMENT },
    id: receiptId,
    playlistId: playlist.id,
    cycle: playlist.cycle,
    currency: 'USDC',
    decimals: USDC_DECIMALS,
    paymentMethod: input.paymentMethod,
    paymentReference: input.paymentReference,
    settled: false,
  }
}

// --- pure reads over an already-loaded playlist -----------------------------

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

/**
 * Where a spot's track belongs in the Spotify playlist right now.
 *
 * Not `spot - 1`: spots sell out of order, so spot 40 may be the first thing
 * ever placed. The index is the base offset plus however many lower-numbered
 * spots are already on the playlist, which keeps the playlist in spot order
 * whatever order the sales arrive in, and is never past the end of the list —
 * a position past the end is an error from Spotify.
 */
export function placementIndex(playlist: Playlist, spot: number): number {
  const placedBefore = playlist.sold.filter((s) => s.spot < spot && s.placement.status === 'placed').length
  return playlist.spotifyBaseOffset + placedBefore
}

/** Tier ladder and term multipliers as served to agents. */
export function publicTerms() {
  return {
    tiers: TIERS.map((t) => ({ from: t.from, to: t.to, price: t.price, currency: 'USDC' })),
    termMultipliers: TERM_MULTIPLIERS,
  }
}

// --- in-memory backend ------------------------------------------------------

function seed(): { playlists: Map<string, Playlist>; receipts: Map<string, Receipt> } {
  const demo: Playlist = {
    id: 'demo',
    name: 'Pitch402 Demo Cycle',
    curator: 'demo-curator',
    spotifyPlaylistId: null,
    spotifyPlaylistName: null,
    spotifyPlaylistUrl: null,
    spotifyOwnerId: null,
    spotifyFollowers: null,
    spotifyBaseOffset: 0,
    spotifyConnectedAt: null,
    cycle: 1,
    status: 'open',
    spotsPerCycle: SPOTS_PER_CYCLE,
    sold: [],
  }
  return { playlists: new Map([[demo.id, demo]]), receipts: new Map() }
}

/**
 * Held on globalThis on purpose. Next bundles each route handler separately,
 * so a plain module-level Map gives every route its own copy. This survives a
 * hot reload and nothing else — which is why Supabase exists.
 */
const globalForStore = globalThis as unknown as { __pitch402Store?: ReturnType<typeof seed> }
const state = (globalForStore.__pitch402Store ??= seed())

const memory = {
  async listPlaylists(): Promise<Playlist[]> {
    return [...state.playlists.values()]
  },

  async getPlaylist(id: string): Promise<Playlist | undefined> {
    return state.playlists.get(id)
  },

  async getReceipt(id: string): Promise<Receipt | undefined> {
    return state.receipts.get(id)
  },

  async sellSpot(playlist: Playlist, input: SellInput): Promise<Receipt> {
    if (isTaken(playlist, input.spot)) throw new SpotTakenError(input.spot)
    const receipt = buildReceipt(playlist, input, newReceiptId(), new Date().toISOString())
    playlist.sold.push(receipt)
    if (spotsRemaining(playlist) === 0) playlist.status = 'full'
    state.receipts.set(receipt.id, receipt)
    return receipt
  },

  async releaseSpot(playlistId: string, receiptId: string): Promise<boolean> {
    const playlist = state.playlists.get(playlistId)
    if (!playlist) return false
    const index = playlist.sold.findIndex((s) => s.receiptId === receiptId)
    if (index === -1) return false
    playlist.sold.splice(index, 1)
    state.receipts.delete(receiptId)
    if (playlist.status === 'full') playlist.status = 'open'
    return true
  },

  async markReceiptSettled(receiptId: string, reference: string | null): Promise<boolean> {
    const receipt = state.receipts.get(receiptId)
    if (!receipt) return false
    receipt.paymentReference = reference
    receipt.settled = true
    return true
  },

  async setPlacement(playlistId: string, receiptId: string, placement: Placement): Promise<void> {
    const playlist = state.playlists.get(playlistId)
    const sold = playlist?.sold.find((s) => s.receiptId === receiptId)
    if (sold) sold.placement = placement
    const receipt = state.receipts.get(receiptId)
    if (receipt) receipt.placement = placement
  },

  async attachSpotifyPlaylist(playlistId: string, meta: SpotifyPlaylistMeta): Promise<Playlist | null> {
    const playlist = state.playlists.get(playlistId)
    if (!playlist) return null
    playlist.spotifyPlaylistId = meta.playlistId
    playlist.spotifyPlaylistName = meta.name
    playlist.spotifyPlaylistUrl = meta.url
    playlist.spotifyOwnerId = meta.ownerId
    playlist.spotifyFollowers = meta.followers
    playlist.spotifyBaseOffset = meta.baseOffset
    playlist.spotifyConnectedAt = new Date().toISOString()
    return playlist
  },

  async setSpotifyFollowers(playlistId: string, followers: number | null): Promise<void> {
    const playlist = state.playlists.get(playlistId)
    if (playlist) playlist.spotifyFollowers = followers
  },
}

// --- postgres backend -------------------------------------------------------

type PlaylistRow = {
  id: string
  name: string
  curator: string
  cycle: number
  status: string
  spots_per_cycle: number
  spotify_playlist_id: string | null
  spotify_playlist_name: string | null
  spotify_playlist_url: string | null
  spotify_owner_id: string | null
  spotify_followers: number | null
  spotify_base_offset: number
  spotify_connected_at: string | null
}

type SpotRow = {
  id: string
  playlist_id: string
  cycle: number
  spot: number
  amount_atomic: string
  amount: string
  term: string
  track_uri: string
  buyer: string | null
  network: string
  payment_method: string
  payment_reference: string | null
  settled: boolean
  added_at: string
  placement: Placement
}

function toSold(row: SpotRow): SoldSpot {
  return {
    spot: row.spot,
    amountAtomic: row.amount_atomic,
    amount: row.amount,
    term: row.term as Term,
    trackUri: row.track_uri,
    buyer: row.buyer,
    network: row.network as NetworkId,
    addedAt: row.added_at,
    receiptId: row.id,
    placement: row.placement,
  }
}

function toReceipt(row: SpotRow): Receipt {
  return {
    ...toSold(row),
    id: row.id,
    playlistId: row.playlist_id,
    cycle: row.cycle,
    currency: 'USDC',
    decimals: USDC_DECIMALS,
    paymentMethod: row.payment_method as 'x402' | 'fake',
    paymentReference: row.payment_reference,
    settled: row.settled,
  }
}

function toPlaylist(row: PlaylistRow, sold: SoldSpot[]): Playlist {
  return {
    id: row.id,
    name: row.name,
    curator: row.curator,
    spotifyPlaylistId: row.spotify_playlist_id,
    spotifyPlaylistName: row.spotify_playlist_name,
    spotifyPlaylistUrl: row.spotify_playlist_url,
    spotifyOwnerId: row.spotify_owner_id,
    spotifyFollowers: row.spotify_followers,
    spotifyBaseOffset: row.spotify_base_offset,
    spotifyConnectedAt: row.spotify_connected_at,
    cycle: row.cycle,
    status: row.status as Playlist['status'],
    spotsPerCycle: row.spots_per_cycle,
    sold: [...sold].sort((a, b) => a.spot - b.spot),
  }
}

/** Recompute `full` from what is actually sold, rather than tracking a counter. */
async function syncStatus(playlist: Playlist): Promise<void> {
  const next = playlist.sold.length >= playlist.spotsPerCycle ? 'full' : 'open'
  if (playlist.status === 'closed' || playlist.status === next) return
  playlist.status = next
  await db().from('playlists').update({ status: next }).eq('id', playlist.id)
}

const postgres = {
  async listPlaylists(): Promise<Playlist[]> {
    const { data, error } = await db().from('playlists').select('*')
    if (error) throw new Error(`listPlaylists: ${error.message}`)
    const rows = (data ?? []) as PlaylistRow[]
    return Promise.all(
      rows.map(async (row) => toPlaylist(row, await loadSold(row.id, row.cycle))),
    )
  },

  async getPlaylist(id: string): Promise<Playlist | undefined> {
    const { data, error } = await db().from('playlists').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`getPlaylist: ${error.message}`)
    if (!data) return undefined
    const row = data as PlaylistRow
    return toPlaylist(row, await loadSold(row.id, row.cycle))
  },

  async getReceipt(id: string): Promise<Receipt | undefined> {
    const { data, error } = await db().from('spots').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`getReceipt: ${error.message}`)
    return data ? toReceipt(data as SpotRow) : undefined
  },

  /**
   * The race is settled here, by the database.
   *
   * Checking "is this spot free?" and then writing is two steps, and two
   * buyers can pass the check between them. The unique constraint on
   * (playlist_id, cycle, spot) makes the insert itself the check: exactly one
   * insert wins, the other comes back as a unique violation, and that becomes
   * a SpotTakenError — which the buy route turns into a 409 before x402
   * settles anything.
   */
  async sellSpot(playlist: Playlist, input: SellInput): Promise<Receipt> {
    const receipt = buildReceipt(playlist, input, newReceiptId(), new Date().toISOString())
    const { data, error } = await db()
      .from('spots')
      .insert({
        id: receipt.id,
        playlist_id: playlist.id,
        cycle: playlist.cycle,
        spot: input.spot,
        amount_atomic: input.amountAtomic,
        amount: input.amount,
        term: input.term,
        track_uri: input.trackUri,
        buyer: input.buyer,
        network: input.network,
        payment_method: input.paymentMethod,
        payment_reference: input.paymentReference,
        settled: false,
        added_at: receipt.addedAt,
        placement: receipt.placement,
      })
      .select()
      .single()

    if (error) {
      if (isUniqueViolation(error)) throw new SpotTakenError(input.spot)
      throw new Error(`sellSpot: ${error.message}`)
    }

    const sold = toSold(data as SpotRow)
    playlist.sold.push(sold)
    playlist.sold.sort((a, b) => a.spot - b.spot)
    await syncStatus(playlist)
    return toReceipt(data as SpotRow)
  },

  async releaseSpot(playlistId: string, receiptId: string): Promise<boolean> {
    const { data, error } = await db().from('spots').delete().eq('id', receiptId).select()
    if (error) throw new Error(`releaseSpot: ${error.message}`)
    if (!data || data.length === 0) return false
    await db().from('settlements').delete().eq('receipt_id', receiptId)
    const playlist = await postgres.getPlaylist(playlistId)
    if (playlist) await syncStatus(playlist)
    return true
  },

  async markReceiptSettled(receiptId: string, reference: string | null): Promise<boolean> {
    const { data, error } = await db()
      .from('spots')
      .update({ settled: true, payment_reference: reference })
      .eq('id', receiptId)
      .select()
    if (error) throw new Error(`markReceiptSettled: ${error.message}`)
    return (data ?? []).length > 0
  },

  async setPlacement(_playlistId: string, receiptId: string, placement: Placement): Promise<void> {
    const { error } = await db().from('spots').update({ placement }).eq('id', receiptId)
    if (error) throw new Error(`setPlacement: ${error.message}`)
  },

  async attachSpotifyPlaylist(playlistId: string, meta: SpotifyPlaylistMeta): Promise<Playlist | null> {
    const { error } = await db()
      .from('playlists')
      .update({
        spotify_playlist_id: meta.playlistId,
        spotify_playlist_name: meta.name,
        spotify_playlist_url: meta.url,
        spotify_owner_id: meta.ownerId,
        spotify_followers: meta.followers,
        spotify_base_offset: meta.baseOffset,
        spotify_connected_at: new Date().toISOString(),
      })
      .eq('id', playlistId)
    if (error) throw new Error(`attachSpotifyPlaylist: ${error.message}`)
    return (await postgres.getPlaylist(playlistId)) ?? null
  },

  async setSpotifyFollowers(playlistId: string, followers: number | null): Promise<void> {
    const { error } = await db().from('playlists').update({ spotify_followers: followers }).eq('id', playlistId)
    if (error) throw new Error(`setSpotifyFollowers: ${error.message}`)
  },
}

async function loadSold(playlistId: string, cycle: number): Promise<SoldSpot[]> {
  const { data, error } = await db()
    .from('spots')
    .select('*')
    .eq('playlist_id', playlistId)
    .eq('cycle', cycle)
    .order('spot', { ascending: true })
  if (error) throw new Error(`loadSold: ${error.message}`)
  return (data ?? []).map((row) => toSold(row as SpotRow))
}

// --- the API the routes use -------------------------------------------------

function backend() {
  return dbEnabled() ? postgres : memory
}

/** Which store is in use, so the API can say so rather than let people guess. */
export function storageBackend(): 'supabase' | 'memory' {
  return dbEnabled() ? 'supabase' : 'memory'
}

export const listPlaylists = (): Promise<Playlist[]> => backend().listPlaylists()
export const getPlaylist = (id: string): Promise<Playlist | undefined> => backend().getPlaylist(id)
export const getReceipt = (id: string): Promise<Receipt | undefined> => backend().getReceipt(id)

/**
 * Take a spot. Throws SpotTakenError if it was claimed first — on Supabase
 * that decision is made by a unique constraint, so it is correct even when two
 * buyers arrive at the same instant.
 */
export const sellSpot = (playlist: Playlist, input: SellInput): Promise<Receipt> =>
  backend().sellSpot(playlist, input)

/**
 * Undo a sale. Used when a payment is verified but settlement then fails, so a
 * spot is never held against money that never moved.
 */
export const releaseSpot = (playlistId: string, receiptId: string): Promise<boolean> =>
  backend().releaseSpot(playlistId, receiptId)

/** Record the settlement transaction once the facilitator confirms it. */
export const markReceiptSettled = (receiptId: string, reference: string | null): Promise<boolean> =>
  backend().markReceiptSettled(receiptId, reference)

/** Record the outcome of a Spotify write against the sale. */
export const setPlacement = (playlistId: string, receiptId: string, placement: Placement): Promise<void> =>
  backend().setPlacement(playlistId, receiptId, placement)

/** Point a Pitch402 cycle at a curator-owned Spotify playlist. */
export const attachSpotifyPlaylist = (playlistId: string, meta: SpotifyPlaylistMeta): Promise<Playlist | null> =>
  backend().attachSpotifyPlaylist(playlistId, meta)

/** Follower count, refreshed from Spotify. The one audience number the Web API gives us. */
export const setSpotifyFollowers = (playlistId: string, followers: number | null): Promise<void> =>
  backend().setSpotifyFollowers(playlistId, followers)
