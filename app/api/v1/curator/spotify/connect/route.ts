import { type NextRequest } from 'next/server'
import { baseUrl, error, json } from '@/lib/http'
import { getPlaylist } from '@/lib/store'
import { SCOPES, spotifyConfigured, redirectUri, startAuth } from '@/lib/spotify'

export const dynamic = 'force-dynamic'

/**
 * Start the curator's one-time Spotify authorization.
 *
 *   GET /api/v1/curator/spotify/connect?playlist=demo
 *   GET /api/v1/curator/spotify/connect?playlist=demo&spotify_playlist_id=<existing>
 *
 * Without `spotify_playlist_id` we create a fresh playlist on the curator's
 * account. With it, we attach the playlist they already run.
 *
 * Only the curator ever comes through here. Artists and agents buy spots
 * without a Spotify account of any kind.
 */
export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const playlistId = req.nextUrl.searchParams.get('playlist') ?? 'demo'
  const playlist = await getPlaylist(playlistId)
  if (!playlist) {
    return error(404, 'playlist_not_found', `no playlist with id "${playlistId}"`)
  }

  if (!spotifyConfigured()) {
    return error(503, 'spotify_not_configured', 'This server has no Spotify credentials.', {
      hint: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local, then restart.',
      redirect_uri_to_register: redirectUri(base),
      scopes: SCOPES,
    })
  }

  const attach = req.nextUrl.searchParams.get('spotify_playlist_id')
  const url = await startAuth({ base, playlistId, attachPlaylistId: attach?.trim() || null })

  // An agent hitting this with Accept: application/json gets the URL to open
  // rather than a redirect it cannot follow meaningfully.
  if ((req.headers.get('accept') ?? '').includes('application/json')) {
    return json({
      authorize_url: url,
      playlist_id: playlistId,
      scopes: SCOPES,
      note: 'Open this in a browser as the curator. Artists and agents never authorize Spotify.',
    })
  }

  return Response.redirect(url, 302)
}
