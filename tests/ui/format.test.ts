import { describe, expect, it } from 'vitest';
import { describeDifferences, formatDuration, spotifyUrl } from '../../src/ui/format';
import type { Match } from '../../src/engine';
import { candidate } from '../helpers/engine';

function matchWith(
  differences: Partial<Match['differences']>,
  capped: Match['capped'] = [],
): Match {
  return {
    candidate: candidate(),
    score: 1,
    parts: { title: 1, artists: 1, duration: 1, album: 1 },
    tier: 'review',
    selected: false,
    capped,
    differences: {
      durationDiffMs: 0,
      sameAlbum: true,
      explicitDiffers: false,
      markersOnlyOnDead: [],
      markersOnlyOnCandidate: [],
      ...differences,
    },
  };
}

describe('formatDuration', () => {
  it('shows minutes and seconds', () => {
    expect(formatDuration(215_000)).toBe('3:35');
    expect(formatDuration(61_400)).toBe('1:01');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('shows a dash when unknown', () => {
    expect(formatDuration(null)).toBe('–');
  });
});

describe('spotifyUrl', () => {
  it('builds a link to a track, album or artist page', () => {
    expect(spotifyUrl('track', 'abc123')).toBe('https://open.spotify.com/track/abc123');
    expect(spotifyUrl('album', 'x')).toBe('https://open.spotify.com/album/x');
    expect(spotifyUrl('artist', 'y')).toBe('https://open.spotify.com/artist/y');
  });

  it('is null without an id', () => {
    expect(spotifyUrl('track', null)).toBeNull();
  });

  it('encodes the id', () => {
    expect(spotifyUrl('track', 'a/b')).toBe('https://open.spotify.com/track/a%2Fb');
  });
});

describe('describeDifferences', () => {
  it('is empty when nothing differs', () => {
    expect(describeDifferences(matchWith({}))).toEqual([]);
  });

  it('marks the album, and the duration when it is more than a second off', () => {
    expect(describeDifferences(matchWith({ sameAlbum: false, durationDiffMs: 3_400 }))).toEqual([
      'Different album',
      'Duration 3s longer',
    ]);
    expect(describeDifferences(matchWith({ durationDiffMs: -8_000 }))).toEqual([
      'Duration 8s shorter',
    ]);
    expect(describeDifferences(matchWith({ durationDiffMs: 900 }))).toEqual([]);
  });

  it('says which side is explicit', () => {
    const explicitCandidate = { ...matchWith({ explicitDiffers: true }) };
    explicitCandidate.candidate = candidate({ explicit: true });
    expect(describeDifferences(explicitCandidate)).toEqual(['Replacement is explicit']);
    const clean = matchWith({ explicitDiffers: true });
    expect(describeDifferences(clean)).toEqual(['Replacement is clean']);
  });

  it('names the version markers on each side', () => {
    expect(
      describeDifferences(
        matchWith({ markersOnlyOnCandidate: ['live', 'remaster'], markersOnlyOnDead: ['demo'] }),
      ),
    ).toEqual(['Replacement is live, remaster', 'Original is demo']);
  });

  it('gives no duration or explicit mark for an unknown duration', () => {
    expect(describeDifferences(matchWith({ durationDiffMs: null }))).toEqual([]);
  });
});
