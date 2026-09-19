/**
 * Normalize what a buyer sends into a Spotify track URI.
 * Accepts spotify:track:<id>, an open.spotify.com/track/<id> URL, or a bare id.
 * We never fetch or scrape Spotify here — this is shape validation only.
 */
const ID = /^[A-Za-z0-9]{22}$/

export function normalizeTrackUri(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null

  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(value)
  if (uri) return `spotify:track:${uri[1]}`

  const url = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/.exec(value)
  if (url) return `spotify:track:${url[1]}`

  if (ID.test(value)) return `spotify:track:${value}`

  return null
}
