import {
  MATCH_DURATION_TOLERANCE_MS,
  MATCH_MIN_ARTIST_SCORE,
  MATCH_SAME_ALBUM_SCORE,
  MATCH_SAME_WORK,
  MATCH_THRESHOLDS,
} from '../config';
import { withLocalUriFallback } from './local';
import { normalizeAlbum, splitTitle } from './normalize';
import { albumNameScore, combineParts, durationGapMs, scoreParts } from './score';
import type {
  AlbumType,
  CapReason,
  Candidate,
  DeadTrack,
  Differences,
  Match,
  Tier,
  VersionMarker,
} from './types';

function normalizeIsrc(isrc: string | null): string | null {
  const cleaned = (isrc ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return cleaned === '' ? null : cleaned;
}

function without(markers: VersionMarker[], other: VersionMarker[]): VersionMarker[] {
  return markers.filter((marker) => !other.includes(marker));
}

function sameAlbum(dead: DeadTrack, candidate: Candidate): boolean {
  const name = normalizeAlbum(dead.album);
  return name !== '' && name === normalizeAlbum(candidate.album);
}

/** Scores one candidate against a dead track and gives it a tier. */
export function matchCandidate(deadTrack: DeadTrack, candidate: Candidate): Match {
  const dead = withLocalUriFallback(deadTrack);
  const deadTitle = splitTitle(dead.title);
  const candidateTitle = splitTitle(candidate.title);

  const onlyOnDead = without(deadTitle.markers, candidateTitle.markers);
  const onlyOnCandidate = without(candidateTitle.markers, deadTitle.markers);
  const remasterDiffers = onlyOnDead.includes('remaster') || onlyOnCandidate.includes('remaster');
  // A local file's explicit flag is a default, not a fact, so it can neither match nor mismatch.
  const explicitKnown = !dead.isLocal && dead.explicit !== null;
  const explicitDiffers = explicitKnown && dead.explicit !== candidate.explicit;

  const parts = scoreParts(dead, candidate);
  // A local file's title tag often leaves out "Live" while its album tag says it all: a file
  // tagged "Randy Rhoads - Tribute" is a live track. Streaming tracks carry the marker in the title.
  const sameAlbumLoose =
    dead.isLocal &&
    albumNameScore(normalizeAlbum(dead.album), normalizeAlbum(candidate.album)) >=
      MATCH_SAME_ALBUM_SCORE;
  const versionMismatch = [
    ...onlyOnDead,
    ...onlyOnCandidate.filter((marker) => !(marker === 'live' && sameAlbumLoose)),
  ].some((marker) => marker !== 'remaster');
  const score = combineParts(parts, { remasterDiffers });
  const gap = durationGapMs(dead, candidate);

  const capped: CapReason[] = [];
  if (versionMismatch) capped.push('version');
  if (explicitDiffers) capped.push('explicit');

  const deadIsrc = dead.isLocal ? null : normalizeIsrc(dead.isrc);
  const exactBase =
    deadIsrc !== null &&
    deadIsrc === normalizeIsrc(candidate.isrc) &&
    gap !== null &&
    gap <= MATCH_DURATION_TOLERANCE_MS.exact &&
    explicitKnown &&
    !explicitDiffers;
  const highBase =
    score >= MATCH_THRESHOLDS.high &&
    gap !== null &&
    gap <= MATCH_DURATION_TOLERANCE_MS.high &&
    parts.artists !== null &&
    (!explicitKnown || !explicitDiffers);

  const sameWork =
    parts.title >= MATCH_SAME_WORK.title &&
    parts.artists !== null &&
    parts.artists >= MATCH_SAME_WORK.artists;

  let tier: Tier = 'none';
  if (deadTitle.base !== '') {
    if (exactBase) tier = 'exact';
    else if (highBase) tier = 'high';
    else if (parts.artists !== null && parts.artists < MATCH_MIN_ARTIST_SCORE) tier = 'none';
    else if (score >= MATCH_THRESHOLDS.review || sameWork) tier = 'review';
    if (capped.length > 0 && (tier === 'exact' || tier === 'high')) tier = 'review';
  }

  const differences: Differences = {
    durationDiffMs: dead.durationMs === null ? null : candidate.durationMs - dead.durationMs,
    sameAlbum: sameAlbum(dead, candidate),
    explicitDiffers,
    markersOnlyOnDead: onlyOnDead,
    markersOnlyOnCandidate: onlyOnCandidate,
  };

  return {
    candidate,
    score,
    parts,
    tier,
    selected: !dead.isLocal && (tier === 'exact' || tier === 'high'),
    capped,
    differences,
  };
}

const TIER_RANK: Record<Tier, number> = { exact: 0, high: 1, review: 2, none: 3 };

const ALBUM_TYPE_RANK: Record<AlbumType, number> = { album: 0, single: 1, compilation: 2 };

/** Tie-break for candidates sharing an ISRC: same album, then album over compilation, then duration. */
function compareSharedIsrc(a: Match, b: Match): number {
  if (a.differences.sameAlbum !== b.differences.sameAlbum) return a.differences.sameAlbum ? -1 : 1;
  const typeA = ALBUM_TYPE_RANK[a.candidate.albumType ?? 'single'];
  const typeB = ALBUM_TYPE_RANK[b.candidate.albumType ?? 'single'];
  if (typeA !== typeB) return typeA - typeB;
  const gapA = Math.abs(a.differences.durationDiffMs ?? Infinity);
  const gapB = Math.abs(b.differences.durationDiffMs ?? Infinity);
  if (gapA !== gapB) return gapA < gapB ? -1 : 1;
  return 0;
}

/**
 * Scores the playable candidates and returns them best first. Candidates that
 * are not playable are dropped. Candidates sharing an ISRC are the same
 * recording, so among them the tie-break rules decide before the score does.
 * Within a tier, a candidate held back by a cap (a live or remix copy, say) comes
 * after those that are not, whatever its score.
 */
export function rankCandidates(dead: DeadTrack, candidates: Candidate[]): Match[] {
  const matches = candidates
    .filter((candidate) => candidate.isPlayable)
    .map((candidate, index) => ({ match: matchCandidate(dead, candidate), index }));

  matches.sort(
    (a, b) =>
      TIER_RANK[a.match.tier] - TIER_RANK[b.match.tier] ||
      Number(a.match.capped.length > 0) - Number(b.match.capped.length > 0) ||
      b.match.score - a.match.score ||
      a.index - b.index,
  );

  const groups = new Map<string, number[]>();
  matches.forEach(({ match }, position) => {
    const isrc = normalizeIsrc(match.candidate.isrc);
    if (isrc === null) return;
    groups.set(isrc, [...(groups.get(isrc) ?? []), position]);
  });
  for (const positions of groups.values()) {
    if (positions.length < 2) continue;
    const members = positions.map((position) => matches[position]);
    members.sort((a, b) =>
      a && b
        ? TIER_RANK[a.match.tier] - TIER_RANK[b.match.tier] ||
          compareSharedIsrc(a.match, b.match) ||
          b.match.score - a.match.score ||
          a.index - b.index
        : 0,
    );
    positions.forEach((position, i) => {
      const member = members[i];
      if (member) matches[position] = member;
    });
  }

  return matches.map(({ match }) => match);
}
