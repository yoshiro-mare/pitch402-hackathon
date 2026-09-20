/**
 * Reset a Pitch402 cycle back to empty, so every spot is free again.
 *
 * Demos are run more than once. This puts the cycle back to the state a judge
 * should find it in: no spots sold, no orphaned settlement mappings, and the
 * tracks we placed taken back off the curator's Spotify playlist.
 *
 *   node --env-file=.env.local scripts/reset-demo.mjs            # dry run
 *   node --env-file=.env.local scripts/reset-demo.mjs --yes      # apply
 *
 * Flags:
 *   --playlist <id>   cycle to reset (default: demo)
 *   --yes             actually do it; without this nothing is written
 *   --keep-spotify    clear the database but leave the playlist alone
 *
 * It only ever removes tracks this cycle recorded as placed. Anything the
 * curator added by hand is not ours to delete and is left where it is.
 */

const args = new Map()
const flags = new Set()
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const next = process.argv[i + 1]
  if (next && !next.startsWith('--')) {
    args.set(arg.slice(2), next)
    i++
  } else {
    flags.add(arg.slice(2))
  }
}

const playlistId = args.get('playlist') ?? 'demo'
const apply = flags.has('yes')
const keepSpotify = flags.has('keep-spotify')

const SUPABASE_URL = need('SUPABASE_URL')
const SERVICE_KEY = need('SUPABASE_SERVICE_ROLE_KEY')

function need(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Run with --env-file=.env.local`)
    process.exit(1)
  }
  return value
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// --- spotify ---------------------------------------------------------------

/**
 * Spotify renamed the playlist-items endpoint. Try the new spelling, fall back
 * to the old one, exactly as lib/spotify.ts does.
 */
async function removeTrack(accessToken, spotifyPlaylistId, uri) {
  const id = encodeURIComponent(spotifyPlaylistId)
  for (const dialect of ['items', 'tracks']) {
    const res = await fetch(`https://api.spotify.com/v1/playlists/${id}/${dialect}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(dialect === 'items' ? { items: [{ uri }] } : { tracks: [{ uri }] }),
    })
    if (res.ok) return true
    if (res.status !== 404) {
      throw new Error(`Spotify refused the removal (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
    }
  }
  return false
}

/** A usable access token, refreshing and persisting it when it has expired. */
async function spotifyToken(connection) {
  if (connection.expires_at - Date.now() > 60_000) return connection.access_token

  const clientId = need('SPOTIFY_CLIENT_ID')
  const clientSecret = need('SPOTIFY_CLIENT_SECRET')
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refresh_token }),
  })
  if (!res.ok) throw new Error(`Spotify token refresh failed (HTTP ${res.status})`)
  const token = await res.json()

  await rest(`spotify_connections?playlist_id=eq.${playlistId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? connection.refresh_token,
      expires_at: Date.now() + token.expires_in * 1000,
    }),
  })
  return token.access_token
}

// --- run -------------------------------------------------------------------

const [playlist] = await rest(`playlists?id=eq.${playlistId}&select=*`)
if (!playlist) {
  console.error(`No playlist "${playlistId}".`)
  process.exit(1)
}

const spots = await rest(`spots?playlist_id=eq.${playlistId}&select=*&order=spot`)
const settlements = await rest('settlements?select=resource,receipt_id')

console.log(`Playlist  ${playlist.id} "${playlist.name}" (cycle ${playlist.cycle}, status ${playlist.status})`)
console.log(`Spotify   ${playlist.spotify_playlist_url ?? 'not connected'}`)
console.log()
console.log(`Will clear:`)
console.log(`  spots sold        ${spots.length}${spots.length ? `  (${spots.map((s) => s.spot).join(', ')})` : ''}`)
console.log(`  settlement rows   ${settlements.length}`)

const placedUris = [
  ...new Set(spots.filter((s) => s.placement?.status === 'placed').map((s) => s.track_uri)),
]
const willTouchSpotify = !keepSpotify && placedUris.length > 0 && playlist.spotify_playlist_id
console.log(
  `  spotify removals  ${
    keepSpotify ? 'skipped (--keep-spotify)' : placedUris.length ? `${placedUris.length} distinct track uri(s)` : 'none'
  }`,
)

if (!apply) {
  console.log(`\nDry run. Nothing was written. Re-run with --yes to apply.`)
  process.exit(0)
}

console.log()

if (willTouchSpotify) {
  const [connection] = await rest(`spotify_connections?playlist_id=eq.${playlistId}&select=*`)
  if (!connection) {
    console.log(`! No Spotify connection stored — leaving the playlist alone.`)
  } else {
    const token = await spotifyToken(connection)
    for (const uri of placedUris) {
      // Removing by uri takes every copy of that track off the playlist, which
      // is what we want: the same track was sold into several spots.
      const removed = await removeTrack(token, playlist.spotify_playlist_id, uri)
      console.log(`  spotify  ${removed ? 'removed' : 'not found'}  ${uri}`)
    }
  }
}

await rest(`spots?playlist_id=eq.${playlistId}`, { method: 'DELETE' })
console.log(`  db       deleted ${spots.length} spot row(s)`)

if (settlements.length) {
  await rest(`settlements?receipt_id=not.is.null`, { method: 'DELETE' })
  console.log(`  db       deleted ${settlements.length} settlement row(s)`)
}

if (playlist.status !== 'open') {
  await rest(`playlists?id=eq.${playlistId}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) })
  console.log(`  db       status ${playlist.status} -> open`)
}

const after = await rest(`spots?playlist_id=eq.${playlistId}&select=id`)
console.log(`\nDone. ${after.length === 0 ? 'Every spot is free.' : `${after.length} spot row(s) remain.`}`)
