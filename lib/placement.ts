/**
 * Paying for a spot puts the track on the curator's Spotify playlist. This is
 * where that actually happens.
 *
 * Two rules shape everything here:
 *
 * 1. Never report a placement that did not happen. A sale can succeed and the
 *    Spotify write can still fail — expired token, deleted playlist, bad track
 *    id. The receipt then says `failed` with Spotify's own error, and the buy
 *    still returns 201 because the payment was real and the spot is theirs.
 *    Retry with POST /api/v1/receipts/:id/place.
 *
 * 2. Never leave a track on the playlist for money that never moved. An x402
 *    payment is verified before the handler runs but settled after it returns,
 *    so a settlement failure has to undo the placement as well as the sale.
 */
import {
  SpotifyError,
  addTrackAt,
  getConnection,
  getPlaylist as getSpotifyPlaylist,
  removeTrack,
  spotifyConfigured,
} from '@/lib/spotify'
import {
  placementIndex,
  setPlacement,
  setSpotifyFollowers,
  type Placement,
  type Playlist,
  type Receipt,
} from '@/lib/store'

function skipped(reason: string): Placement {
  return { status: 'skipped', position: null, snapshotId: null, placedAt: null, error: null, reason }
}

function describe(err: unknown): string {
  if (err instanceof SpotifyError) {
    const status = err.status === null ? '' : ` (HTTP ${err.status})`
    return err.detail ? `${err.message}${status}: ${err.detail}` : `${err.message}${status}`
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Put a paid track on the playlist. Always resolves — the placement outcome is
 * the return value and is recorded on the receipt either way, because a thrown
 * error here would roll back a sale that was paid for.
 */
export async function placeTrack(playlist: Playlist, receipt: Receipt): Promise<Placement> {
  const placement = await attempt(playlist, receipt)
  await setPlacement(playlist.id, receipt.id, placement)
  // Persisting is not enough. The in-memory backend happens to hold the same
  // receipt object it just wrote through, but Postgres only updates a row — so
  // a caller that serializes this receipt would report the placement it had
  // before the write, and tell a buyer their paid track was never placed.
  receipt.placement = placement
  return placement
}

async function attempt(playlist: Playlist, receipt: Receipt): Promise<Placement> {
  if (!spotifyConfigured()) {
    return skipped('Spotify is not configured on this server. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.')
  }
  if (!playlist.spotifyPlaylistId) {
    return skipped('No Spotify playlist is connected to this cycle. The curator connects one once, at /api/v1/curator/spotify/connect.')
  }
  const connection = await getConnection(playlist.id)
  if (!connection) {
    return skipped('The curator’s Spotify authorization is missing or expired. Reconnect at /api/v1/curator/spotify/connect.')
  }

  const desired = placementIndex(playlist, receipt.spot)
  let position = desired

  // Read the playlist before inserting. Spotify rejects a position past the
  // end of the list, and our index is computed from what we believe we placed
  // — a curator who reorders or deletes tracks by hand makes that belief
  // stale. Clamping keeps the write working; the ordering is then as close to
  // spot order as the curator's own edits allow. This call also refreshes the
  // follower count, the one audience number the Web API exposes.
  try {
    const remote = await getSpotifyPlaylist(connection, playlist.spotifyPlaylistId)
    await setSpotifyFollowers(playlist.id, remote.followers)
    position = Math.min(desired, remote.total)
  } catch {
    // Reading is an optimization, not a precondition. Try the insert anyway.
  }

  try {
    const result = await addTrackAt(connection, playlist.spotifyPlaylistId, receipt.trackUri, position)
    return {
      status: 'placed',
      position,
      snapshotId: result.snapshot_id,
      placedAt: new Date().toISOString(),
      error: null,
      reason: null,
    }
  } catch (err) {
    return {
      status: 'failed',
      position: null,
      snapshotId: null,
      placedAt: null,
      error: describe(err),
      reason: null,
    }
  }
}

/**
 * Take a track back off the playlist. Called when a verified payment fails to
 * settle, so the spot and the placement are released together.
 */
export async function unplaceTrack(playlist: Playlist, trackUri: string): Promise<boolean> {
  const connection = await getConnection(playlist.id)
  if (!connection || !playlist.spotifyPlaylistId) return false
  try {
    await removeTrack(connection, playlist.spotifyPlaylistId, trackUri)
    return true
  } catch {
    // Best effort. The sale is already being rolled back; a stuck track on the
    // playlist is the curator's to remove and not worth failing the response.
    return false
  }
}

/** Re-read the playlist's follower count from Spotify. */
export async function refreshFollowers(playlist: Playlist): Promise<number | null> {
  const connection = await getConnection(playlist.id)
  if (!connection || !playlist.spotifyPlaylistId) return null
  const remote = await getSpotifyPlaylist(connection, playlist.spotifyPlaylistId)
  const followers = remote.followers
  await setSpotifyFollowers(playlist.id, followers)
  return followers
}

/** Placement as served to agents. Shared by the buy response and the receipt. */
export function serializePlacement(placement: Placement, playlist: Playlist, base: string, receiptId: string) {
  return {
    status: placement.status,
    playlist_id: playlist.spotifyPlaylistId,
    playlist_url: playlist.spotifyPlaylistUrl,
    /** zero-based index in the Spotify playlist, which is not the spot number */
    position: placement.position,
    snapshot_id: placement.snapshotId,
    placed_at: placement.placedAt,
    error: placement.error,
    reason: placement.reason,
    retry_url: placement.status === 'placed' ? null : `${base}/api/v1/receipts/${receiptId}/place`,
    note:
      placement.status === 'placed'
        ? 'Added to the curator’s own Spotify playlist. Not a Spotify editorial playlist. The Spotify Web API reports no plays, saves, or royalties for a playlist, so none are shown.'
        : 'The spot is paid for and held. The track is not on the playlist yet — POST the retry URL to try the Spotify write again.',
  }
}
