import {
  ARTIST_PRIMARY_SHARE,
  DURATION_SCORE_MS,
  LOCAL_DURATION_ROUNDING_MS,
  MATCH_WEIGHTS,
  MISSING_PART,
  REMASTER_SCORE_PENALTY,
} from '../config';
import { normalizeAlbum, normalizeText, similarity, splitTitle } from './normalize';
import type { Candidate, DeadTrack, ScoreParts } from './types';

/** 1 up to the configured full-score gap, falling linearly to 0 at the zero-score gap. */
export function durationScore(diffMs: number): number {
  const gap = Math.abs(diffMs);
  if (gap <= DURATION_SCORE_MS.full) return 1;
  if (gap >= DURATION_SCORE_MS.zero) return 0;
  return (DURATION_SCORE_MS.zero - gap) / (DURATION_SCORE_MS.zero - DURATION_SCORE_MS.full);
}

/**
 * How far apart the durations are, or null when either is unknown. A local
 * file's duration is whole seconds, so rounding alone can account for part of the gap.
 */
export function durationGapMs(dead: DeadTrack, candidate: Candidate): number | null {
  if (dead.durationMs === null) return null;
  const gap = Math.abs(candidate.durationMs - dead.durationMs);
  return dead.isLocal ? Math.max(0, gap - LOCAL_DURATION_ROUNDING_MS) : gap;
}

/** The normalized artist names on a track, with any `feat.` credits from the title moved in. */
function artistSet(artists: string[], featured: string[]): string[] {
  const names = [...artists.map(normalizeText), ...featured].filter((name) => name !== '');
  return [...new Set(names)];
}

function artistsScore(dead: DeadTrack, candidate: Candidate): number | null {
  const deadNames = artistSet(dead.artists, splitTitle(dead.title).featured);
  const candidateNames = artistSet(candidate.artists, splitTitle(candidate.title).featured);
  const deadPrimary = normalizeText(dead.artists[0] ?? '');
  if (deadNames.length === 0 || deadPrimary === '') return null;
  const primary = similarity(deadPrimary, normalizeText(candidate.artists[0] ?? ''));
  const shared = deadNames.filter((name) => candidateNames.includes(name)).length;
  const union = new Set([...deadNames, ...candidateNames]).size;
  return ARTIST_PRIMARY_SHARE * primary + (1 - ARTIST_PRIMARY_SHARE) * (shared / union);
}

export function scoreParts(dead: DeadTrack, candidate: Candidate): ScoreParts {
  const gap = durationGapMs(dead, candidate);
  const deadAlbum = normalizeAlbum(dead.album);
  return {
    title: similarity(splitTitle(dead.title).base, splitTitle(candidate.title).base),
    artists: artistsScore(dead, candidate),
    duration: gap === null ? null : durationScore(gap),
    album: deadAlbum === '' ? null : similarity(deadAlbum, normalizeAlbum(candidate.album)),
  };
}

/**
 * The weighted score, 0 to 1. A missing part is scored as unknown and counts for
 * less, so a file with bad tags cannot reach a high score on the parts it does have.
 */
export function combineParts(
  parts: ScoreParts,
  options: { remasterDiffers?: boolean } = {},
): number {
  const entries = [
    [MATCH_WEIGHTS.title, parts.title],
    [MATCH_WEIGHTS.artists, parts.artists],
    [MATCH_WEIGHTS.duration, parts.duration],
    [MATCH_WEIGHTS.album, parts.album],
  ] as const;
  let total = 0;
  let weights = 0;
  for (const [weight, value] of entries) {
    const missing = value === null;
    const effective = missing ? weight * MISSING_PART.weightFactor : weight;
    total += effective * (missing ? MISSING_PART.value : value);
    weights += effective;
  }
  const score = total / weights - (options.remasterDiffers ? REMASTER_SCORE_PENALTY : 0);
  return Math.min(1, Math.max(0, score));
}
