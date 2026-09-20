import { type NextRequest } from 'next/server'
import { baseUrl, error, json } from '@/lib/http'
import { attachSpotifyPlaylist, getPlaylist } from '@/lib/store'
import {
  SpotifyError,
  createPlaylist,
  currentUser,
  exchangeCode,
  getPlaylist as getSpotifyPlaylist,
  saveConnection,
  takePendingAuth,
  type Connection,
} from '@/lib/spotify'

export const dynamic = 'force-dynamic'

/**
 * Spotify sends the curator back here. We exchange the code, find or create
 * the playlist, and attach it to the cycle.
 *
 * This is the only place a Spotify token enters the system, and the token
 * never leaves it — buyers get a playlist URL, never a credential.
 */
export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const params = req.nextUrl.searchParams

  const denied = params.get('error')
  if (denied) {
    return error(400, 'spotify_authorization_denied', `Spotify returned "${denied}".`, {
      hint: 'The curator declined, or the redirect URI does not match the one registered on the Spotify app.',
    })
  }

  // The state has to be one we issued. Anything else is a replay or a stale tab.
  const intent = await takePendingAuth(params.get('state'))
  if (!intent) {
    return error(400, 'invalid_state', 'This authorization link is unknown or expired.', {
      hint: 'Start again at /api/v1/curator/spotify/connect?playlist=demo',
    })
  }

  const code = params.get('code')
  if (!code) {
    return error(400, 'missing_code', 'Spotify did not return an authorization code.')
  }

  const playlist = await getPlaylist(intent.playlistId)
  if (!playlist) {
    return error(404, 'playlist_not_found', `no playlist with id "${intent.playlistId}"`)
  }

  try {
    const token = await exchangeCode(code, base)
    if (!token.refresh_token) {
      return error(502, 'missing_refresh_token', 'Spotify did not return a refresh token.', {
        hint: 'Without one we could not keep writing after an hour. Try connecting again.',
      })
    }

    const user = await currentUser(token.access_token)
    const connection: Connection = {
      playlistId: playlist.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: token.scope ?? '',
      spotifyUserId: user.id,
      spotifyUserName: user.display_name,
      connectedAt: new Date().toISOString(),
    }
    await saveConnection(connection)

    // Attach the curator's existing playlist, or make them a new one.
    const target = intent.attachPlaylistId
      ? await getSpotifyPlaylist(connection, intent.attachPlaylistId)
      : await createPlaylist(
          connection,
          user.id,
          playlist.name,
          `Pitch402 cycle ${playlist.cycle}. Spots are sold by position and paid in USDC over x402.`,
        )

    // We are only ever allowed to write to a playlist the curator owns.
    if (target.owner.id !== user.id) {
      return error(403, 'not_your_playlist', 'That playlist belongs to another Spotify account.', {
        playlist_owner: target.owner.id,
        authorized_as: user.id,
        hint: 'Pitch402 only writes to a playlist the connecting curator owns. Never an editorial playlist.',
      })
    }

    await attachSpotifyPlaylist(playlist.id, {
      playlistId: target.id,
      name: target.name,
      url: target.url,
      ownerId: target.owner.id,
      followers: target.followers,
      // Whatever is already on the playlist stays put, and spots are ordered
      // after it.
      baseOffset: target.total,
    })

    return json({
      connected: true,
      playlist_id: playlist.id,
      curator: { spotify_user_id: user.id, display_name: user.display_name },
      spotify_playlist: {
        id: target.id,
        name: target.name,
        url: target.url,
        public: target.public,
        followers: target.followers,
        existing_items: target.total,
        created_by_pitch402: intent.attachPlaylistId === null,
      },
      note: 'Paid spots from now on are written to this playlist. It is the curator’s own playlist, not a Spotify editorial playlist.',
      links: {
        playlist: `${base}/api/v1/playlists/${playlist.id}`,
        quote_next: `${base}/api/v1/playlists/${playlist.id}/quote?next=1`,
      },
    })
  } catch (err) {
    if (err instanceof SpotifyError) {
      return error(502, 'spotify_error', err.message, { status: err.status, detail: err.detail })
    }
    throw err
  }
}
