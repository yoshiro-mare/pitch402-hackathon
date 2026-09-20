/**
 * Spotify Web API transport for Pitch402.
 *
 * Only the curator ever authorizes, and only over their own playlist. An
 * artist or agent buying a spot never sees Spotify at all — they POST to our
 * API, and we write to the curator's playlist on their behalf.
 *
 * What the Web API can and cannot tell us is a product constraint, not an
 * oversight: it exposes playlist followers and nothing about plays, saves, or
 * royalties attributable to a playlist. Nothing here invents those numbers.
 */

/**
 * Overridable only so the OAuth and write paths can be exercised against a
 * stub in tests. Unset in every real environment, which is where the Spotify
 * hosts below apply.
 */
import { db, dbEnabled } from '@/lib/db'

const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_BASE?.trim() || 'https://accounts.spotify.com'
const API = process.env.SPOTIFY_API_BASE?.trim() || 'https://api.spotify.com/v1'

/** The narrowest scopes that let us add and remove items on a curator playlist. */
export const SCOPES = ['playlist-modify-public', 'playlist-modify-private'] as const

export type Connection = {
  /** Pitch402 playlist this connection writes to. */
  playlistId: string
  accessToken: string
  refreshToken: string
  /** epoch ms; we refresh a minute early rather than racing the expiry */
  expiresAt: number
  scope: string
  spotifyUserId: string
  spotifyUserName: string | null
  connectedAt: string
}

/**
 * Spotify runs two dialects of the same API.
 *
 * Development Mode apps — which is what every new app is — were moved in
 * February/March 2026 to renamed playlist endpoints: /playlists/{id}/items
 * instead of /tracks, POST /me/playlists instead of POST /users/{id}/playlists,
 * and a playlist's `tracks` object renamed to `items`. Extended Quota Mode
 * apps keep the old spelling.
 *
 * We cannot know which mode an app is in, and asking the developer to declare
 * it is one more thing to get wrong. Instead the first call tries the modern
 * spelling, falls back to the legacy one on a 404, and remembers which worked.
 */
export type Dialect = 'items' | 'tracks'

type SpotifyGlobals = {
  connections?: Map<string, Connection>
  /** OAuth state -> what we were doing, so a callback cannot be replayed blind */
  pending?: Map<string, { playlistId: string; attachPlaylistId: string | null; createdAt: number }>
  dialect?: Dialect
}

/**
 * In memory, on globalThis, for the same reason lib/store.ts is: Next bundles
 * each route separately. Tokens die on restart and the curator reconnects.
 * A real deployment puts these in an encrypted store, not a Map.
 */
const globalForSpotify = globalThis as unknown as { __pitch402Spotify?: SpotifyGlobals }
const spotify = (globalForSpotify.__pitch402Spotify ??= {})
const connections = (spotify.connections ??= new Map<string, Connection>())
const pending = (spotify.pending ??= new Map())

/** Which endpoint spelling this app answered to, once we have found out. */
export function knownDialect(): Dialect | null {
  return spotify.dialect ?? null
}

function rememberDialect(dialect: Dialect): void {
  spotify.dialect = dialect
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly detail: string | null = null,
  ) {
    super(message)
    this.name = 'SpotifyError'
  }
}

export function clientId(): string | null {
  return process.env.SPOTIFY_CLIENT_ID?.trim() || null
}

function clientSecret(): string | null {
  return process.env.SPOTIFY_CLIENT_SECRET?.trim() || null
}

export function spotifyConfigured(): boolean {
  return clientId() !== null && clientSecret() !== null
}

/**
 * Must match a redirect URI registered on the Spotify app exactly, including
 * the scheme and any trailing path. Derived from the request when unset so
 * localhost works without configuration.
 */
export function redirectUri(base: string): string {
  const configured = process.env.SPOTIFY_REDIRECT_URI?.trim()
  return configured || `${base}/api/v1/curator/spotify/callback`
}

/** Playlists we create are private unless the curator opts them public. */
export function createPublicPlaylists(): boolean {
  return process.env.SPOTIFY_PLAYLIST_PUBLIC === '1'
}

// --- connections -----------------------------------------------------------

type ConnectionRow = {
  playlist_id: string
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
  spotify_user_id: string
  spotify_user_name: string | null
  connected_at: string
}

export async function getConnection(playlistId: string): Promise<Connection | null> {
  if (!dbEnabled()) return connections.get(playlistId) ?? null
  const { data } = await db()
    .from('spotify_connections')
    .select('*')
    .eq('playlist_id', playlistId)
    .maybeSingle()
  if (!data) return null
  const row = data as ConnectionRow
  return {
    playlistId: row.playlist_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: Number(row.expires_at),
    scope: row.scope,
    spotifyUserId: row.spotify_user_id,
    spotifyUserName: row.spotify_user_name,
    connectedAt: row.connected_at,
  }
}

export async function saveConnection(connection: Connection): Promise<void> {
  if (!dbEnabled()) {
    connections.set(connection.playlistId, connection)
    return
  }
  await db().from('spotify_connections').upsert({
    playlist_id: connection.playlistId,
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expires_at: connection.expiresAt,
    scope: connection.scope,
    spotify_user_id: connection.spotifyUserId,
    spotify_user_name: connection.spotifyUserName,
    connected_at: connection.connectedAt,
  })
}

export async function clearConnection(playlistId: string): Promise<void> {
  if (!dbEnabled()) {
    connections.delete(playlistId)
    return
  }
  await db().from('spotify_connections').delete().eq('playlist_id', playlistId)
}

// --- oauth -----------------------------------------------------------------

export async function startAuth(input: {
  base: string
  playlistId: string
  attachPlaylistId: string | null
}): Promise<string> {
  const id = clientId()
  if (!id) throw new SpotifyError('SPOTIFY_CLIENT_ID is not set')

  // Random state, remembered server-side. A callback carrying a state we never
  // issued is rejected rather than trusted. It has to outlive the request that
  // created it and be readable by whichever instance the callback lands on,
  // which is why it is stored rather than signed into a cookie.
  const state = crypto.randomUUID().replace(/-/g, '')
  if (dbEnabled()) {
    await db().from('oauth_states').insert({
      state,
      playlist_id: input.playlistId,
      attach_playlist_id: input.attachPlaylistId,
    })
  } else {
    pending.set(state, {
      playlistId: input.playlistId,
      attachPlaylistId: input.attachPlaylistId,
      createdAt: Date.now(),
    })
    prunePending()
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(input.base),
    state,
    // Force the consent screen so a curator can switch accounts mid-demo.
    show_dialog: 'true',
  })
  return `${ACCOUNTS}/authorize?${params.toString()}`
}

const STATE_TTL_MS = 10 * 60 * 1000

export async function takePendingAuth(
  state: string | null,
): Promise<{ playlistId: string; attachPlaylistId: string | null } | null> {
  if (!state) return null

  if (!dbEnabled()) {
    const entry = pending.get(state)
    if (!entry) return null
    pending.delete(state)
    // Ten minutes is plenty for a consent screen and short enough to matter.
    if (Date.now() - entry.createdAt > STATE_TTL_MS) return null
    return entry
  }

  const { data } = await db().from('oauth_states').select('*').eq('state', state).maybeSingle()
  if (!data) return null
  const row = data as { playlist_id: string; attach_playlist_id: string | null; created_at: string }
  // Single use, whether or not it turns out to be expired.
  await db().from('oauth_states').delete().eq('state', state)
  if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) return null
  return { playlistId: row.playlist_id, attachPlaylistId: row.attach_playlist_id }
}

function prunePending(): void {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [state, entry] of pending) {
    if (entry.createdAt < cutoff) pending.delete(state)
  }
}

function basicAuth(): string {
  const id = clientId()
  const secret = clientSecret()
  if (!id || !secret) throw new SpotifyError('Spotify client credentials are not configured')
  return Buffer.from(`${id}:${secret}`).toString('base64')
}

type TokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basicAuth()}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new SpotifyError('Spotify rejected the token request', res.status, text.slice(0, 400))
  }
  return JSON.parse(text) as TokenResponse
}

export async function exchangeCode(code: string, base: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(base),
    }),
  )
}

/**
 * Refresh an expiring access token. Spotify does not always return a new
 * refresh token; when it does not, the existing one stays valid.
 */
async function refresh(connection: Connection): Promise<Connection> {
  const token = await tokenRequest(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refreshToken }),
  )
  const updated: Connection = {
    ...connection,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? connection.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? connection.scope,
  }
  await saveConnection(updated)
  return updated
}

/** A token good for at least another minute. */
async function freshToken(connection: Connection): Promise<string> {
  if (connection.expiresAt - Date.now() > 60_000) return connection.accessToken
  const updated = await refresh(connection)
  return updated.accessToken
}

// --- api -------------------------------------------------------------------

async function call<T>(
  connection: Connection,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await freshToken(connection)
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: 'no-store',
  })

  const text = await res.text()
  if (!res.ok) {
    // Spotify's error bodies are small and useful; keep them for the receipt
    // rather than flattening every failure into "something went wrong".
    throw new SpotifyError(`Spotify ${init.method ?? 'GET'} ${path} failed`, res.status, text.slice(0, 400))
  }
  return (text ? JSON.parse(text) : {}) as T
}

export type SpotifyUser = { id: string; display_name: string | null }

export async function currentUser(accessToken: string): Promise<SpotifyUser> {
  const res = await fetch(`${API}/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    throw new SpotifyError('Could not read the Spotify account', res.status, text.slice(0, 400))
  }
  return JSON.parse(text) as SpotifyUser
}

/** A playlist exactly as Spotify sent it, in either dialect. */
type RawPlaylist = {
  id: string
  name: string
  external_urls?: { spotify?: string }
  owner: { id: string; display_name: string | null }
  followers?: { total: number }
  /** modern dialect */
  items?: { total?: number }
  /** legacy dialect */
  tracks?: { total?: number }
  public?: boolean | null
}

/** A playlist with one shape, whichever dialect it arrived in. */
export type SpotifyPlaylist = {
  id: string
  name: string
  url: string
  owner: { id: string; display_name: string | null }
  followers: number | null
  /** how many items are on the playlist right now */
  total: number
  public: boolean | null
}

function normalizePlaylist(raw: RawPlaylist): SpotifyPlaylist {
  return {
    id: raw.id,
    name: raw.name,
    url: raw.external_urls?.spotify ?? `https://open.spotify.com/playlist/${raw.id}`,
    owner: raw.owner,
    followers: raw.followers?.total ?? null,
    total: raw.items?.total ?? raw.tracks?.total ?? 0,
    public: raw.public ?? null,
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof SpotifyError && err.status === 404
}

/**
 * Run a playlist-items call in whichever dialect this app speaks, learning it
 * on the first call. A 404 on the modern path means an Extended Quota Mode app
 * that still uses the old one; anything else is a real error and is rethrown.
 */
async function withDialect<T>(run: (dialect: Dialect) => Promise<T>): Promise<T> {
  const known = knownDialect()
  if (known) return run(known)
  try {
    const result = await run('items')
    rememberDialect('items')
    return result
  } catch (err) {
    if (!isNotFound(err)) throw err
    const result = await run('tracks')
    rememberDialect('tracks')
    return result
  }
}

export async function createPlaylist(
  connection: Connection,
  userId: string,
  name: string,
  description: string,
): Promise<SpotifyPlaylist> {
  const body = { name, public: createPublicPlaylists(), description }
  try {
    return normalizePlaylist(await call<RawPlaylist>(connection, '/me/playlists', { method: 'POST', body }))
  } catch (err) {
    // Extended Quota Mode apps still only answer the older per-user path.
    if (!isNotFound(err)) throw err
    return normalizePlaylist(
      await call<RawPlaylist>(connection, `/users/${encodeURIComponent(userId)}/playlists`, {
        method: 'POST',
        body,
      }),
    )
  }
}

export async function getPlaylist(connection: Connection, playlistId: string): Promise<SpotifyPlaylist> {
  // Both spellings are requested because `fields` is a filter, not a schema:
  // whichever of `items` and `tracks` the app's dialect returns comes back and
  // the other is simply absent.
  const fields = 'id,name,external_urls,owner(id,display_name),followers(total),items(total),tracks(total),public'
  const path = `/playlists/${encodeURIComponent(playlistId)}`
  try {
    return normalizePlaylist(await call<RawPlaylist>(connection, `${path}?fields=${fields}`))
  } catch (err) {
    // If the field filter itself is rejected, ask for the whole object.
    if (err instanceof SpotifyError && err.status !== null && err.status >= 500) throw err
    return normalizePlaylist(await call<RawPlaylist>(connection, path))
  }
}

/**
 * Insert one track at a zero-based position. Spotify rejects a position past
 * the end of the playlist, so callers compute it from what is already placed
 * rather than from the spot number alone.
 */
export async function addTrackAt(
  connection: Connection,
  playlistId: string,
  trackUri: string,
  position: number,
): Promise<{ snapshot_id: string }> {
  const id = encodeURIComponent(playlistId)
  return withDialect((dialect) =>
    call<{ snapshot_id: string }>(connection, `/playlists/${id}/${dialect}`, {
      method: 'POST',
      body: { uris: [trackUri], position },
    }),
  )
}

/** Remove every occurrence of a track. Used to undo a placement whose payment then failed. */
export async function removeTrack(
  connection: Connection,
  playlistId: string,
  trackUri: string,
): Promise<{ snapshot_id: string }> {
  const id = encodeURIComponent(playlistId)
  return withDialect((dialect) =>
    call<{ snapshot_id: string }>(connection, `/playlists/${id}/${dialect}`, {
      method: 'DELETE',
      // The body key was renamed alongside the path.
      body: dialect === 'items' ? { items: [{ uri: trackUri }] } : { tracks: [{ uri: trackUri }] },
    }),
  )
}
