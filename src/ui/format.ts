import type { Match } from '../engine';

export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

/** A link to a page on Spotify, or null when there is no ID to link to. */
export function spotifyUrl(kind: 'track' | 'album' | 'artist', id: string | null): string | null {
  return id === null || id === ''
    ? null
    : `https://open.spotify.com/${kind}/${encodeURIComponent(id)}`;
}

/** Short labels for what differs between the dead track and a replacement. */
export function describeDifferences(match: Match): string[] {
  const { differences } = match;
  const labels: string[] = [];
  if (!differences.sameAlbum) labels.push('Different album');
  const diff = differences.durationDiffMs;
  if (diff !== null && Math.abs(diff) > 1_000) {
    const seconds = String(Math.round(Math.abs(diff) / 1000));
    labels.push(`Duration ${seconds}s ${diff > 0 ? 'longer' : 'shorter'}`);
  }
  if (differences.explicitDiffers) {
    labels.push(match.candidate.explicit ? 'Replacement is explicit' : 'Replacement is clean');
  }
  if (differences.markersOnlyOnCandidate.length > 0) {
    labels.push(`Replacement is ${differences.markersOnlyOnCandidate.join(', ')}`);
  }
  if (differences.markersOnlyOnDead.length > 0) {
    labels.push(`Original is ${differences.markersOnlyOnDead.join(', ')}`);
  }
  return labels;
}
