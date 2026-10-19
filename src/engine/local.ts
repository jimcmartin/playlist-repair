import type { DeadTrack } from './types';

export interface LocalUriFields {
  artist: string;
  album: string;
  title: string;
  /** Null when the URI carries no duration, or 0. */
  durationMs: number | null;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
}

/** Reads `spotify:local:{artist}:{album}:{title}:{seconds}`. Null for any other URI. */
export function parseLocalUri(uri: string): LocalUriFields | null {
  const parts = uri.split(':');
  if (parts.length !== 6 || parts[0] !== 'spotify' || parts[1] !== 'local') return null;
  const seconds = Number(parts[5]);
  return {
    artist: decode(parts[2] ?? ''),
    album: decode(parts[3] ?? ''),
    title: decode(parts[4] ?? ''),
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
  };
}

/** For a local file, fills the fields its tags left empty from its URI. */
export function withLocalUriFallback(track: DeadTrack): DeadTrack {
  if (!track.isLocal) return track;
  const fromUri = parseLocalUri(track.uri);
  if (!fromUri) return track;
  const artists = track.artists.filter((name) => name.trim() !== '');
  return {
    ...track,
    title: track.title.trim() === '' ? fromUri.title : track.title,
    artists: artists.length > 0 ? artists : fromUri.artist === '' ? [] : [fromUri.artist],
    album: track.album.trim() === '' ? fromUri.album : track.album,
    durationMs:
      track.durationMs !== null && track.durationMs > 0 ? track.durationMs : fromUri.durationMs,
  };
}
