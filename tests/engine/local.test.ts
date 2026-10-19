import { describe, expect, it } from 'vitest';
import {
  matchCandidate,
  parseLocalUri,
  rankCandidates,
  withLocalUriFallback,
} from '../../src/engine';
import { candidate, localFile } from '../helpers/engine';

describe('parseLocalUri', () => {
  it('reads artist, album, title and seconds, decoding + and %20', () => {
    expect(parseLocalUri('spotify:local:New+Order:Power%2C+Corruption:Blue+Monday:449')).toEqual({
      artist: 'New Order',
      album: 'Power, Corruption',
      title: 'Blue Monday',
      durationMs: 449_000,
    });
  });

  it('treats empty fields and a zero duration as missing', () => {
    expect(parseLocalUri('spotify:local:::Song:0')).toEqual({
      artist: '',
      album: '',
      title: 'Song',
      durationMs: null,
    });
  });

  it('returns null for anything else', () => {
    expect(parseLocalUri('spotify:track:abc')).toBeNull();
    expect(parseLocalUri('spotify:local:too:few')).toBeNull();
  });
});

describe('withLocalUriFallback', () => {
  it('treats a duration of 0 as missing', () => {
    const filled = withLocalUriFallback(
      localFile({ uri: 'spotify:local:A:B:C:100', durationMs: 0 }),
    );
    expect(filled.durationMs).toBe(100_000);
  });

  it('fills only the fields that are missing', () => {
    const filled = withLocalUriFallback(
      localFile({
        uri: 'spotify:local:URI+Artist:URI+Album:URI+Title:100',
        title: 'Tag Title',
        artists: [],
        album: '',
        durationMs: null,
      }),
    );
    expect(filled.title).toBe('Tag Title');
    expect(filled.artists).toEqual(['URI Artist']);
    expect(filled.album).toBe('URI Album');
    expect(filled.durationMs).toBe(100_000);
  });

  it('leaves a track that is not local alone', () => {
    const track = { ...localFile(), isLocal: false, title: '' };
    expect(withLocalUriFallback(track)).toEqual(track);
  });
});

describe('local files', () => {
  it('never reach Exact, even with the candidate carrying an ISRC and every field matching', () => {
    const match = matchCandidate(localFile(), candidate());
    expect(match.score).toBe(1);
    expect(match.tier).toBe('high');
  });

  it('are never preselected, even in High', () => {
    const match = matchCandidate(localFile(), candidate());
    expect(match.tier).toBe('high');
    expect(match.selected).toBe(false);
  });

  it('ignore the explicit flag, since it is unknown rather than false', () => {
    const match = matchCandidate(localFile({ explicit: false }), candidate({ explicit: true }));
    expect(match.capped).toEqual([]);
    expect(match.differences.explicitDiffers).toBe(false);
    expect(match.tier).toBe('high');
  });

  it('still hold a version mismatch at Review', () => {
    const match = matchCandidate(
      localFile(),
      candidate({ title: 'Song (Live)', album: 'Another Album' }),
    );
    expect(match.tier).toBe('review');
    expect(match.capped).toEqual(['version']);
  });

  it('allow for whole-second durations', () => {
    expect(matchCandidate(localFile(), candidate({ durationMs: 203_900 })).tier).toBe('high');
    expect(matchCandidate(localFile(), candidate({ durationMs: 204_100 })).tier).toBe('review');
  });

  it('cannot reach High when the duration is missing', () => {
    const match = matchCandidate(
      localFile({ durationMs: null, uri: 'spotify:local:::Song:0' }),
      candidate(),
    );
    expect(match.parts.duration).toBeNull();
    expect(match.tier).toBe('review');
  });

  it('count a missing album for less, but still allow High when the rest is clean', () => {
    const match = matchCandidate(
      localFile({ album: '', uri: 'spotify:local:Artist::Song:200' }),
      candidate(),
    );
    expect(match.parts.album).toBeNull();
    expect(match.score).toBeGreaterThanOrEqual(0.9);
    expect(match.tier).toBe('high');
  });

  it('cannot reach High when the artist is missing', () => {
    const match = matchCandidate(
      localFile({ artists: [], uri: 'spotify:local::Album:Song:200' }),
      candidate(),
    );
    expect(match.tier).toBe('review');
  });

  it('match nothing when the title is missing from both tags and URI', () => {
    const ranked = rankCandidates(
      localFile({ title: '', artists: [], album: '', durationMs: null, uri: 'spotify:local::::0' }),
      [candidate(), candidate({ uri: 'spotify:track:other', title: '' })],
    );
    expect(ranked.map((m) => m.tier)).toEqual(['none', 'none']);
    expect(ranked.every((m) => !m.selected)).toBe(true);
  });

  it('recover a missing title from the URI', () => {
    const match = matchCandidate(localFile({ title: '' }), candidate());
    expect(match.tier).toBe('high');
  });
});

describe('a live album', () => {
  const tribute = (overrides = {}) =>
    localFile({
      title: 'Crazy Train',
      artists: ['Ozzy Osbourne'],
      album: 'Randy Rhoads - Tribute',
      durationMs: 322_000,
      uri: 'spotify:local:Ozzy+Osbourne:Randy+Rhoads+-+Tribute:Crazy+Train:322',
      ...overrides,
    });
  const live = (overrides = {}) =>
    candidate({
      uri: 'spotify:track:live',
      title: 'Crazy Train - Live 1981',
      artists: ['Ozzy Osbourne'],
      album: 'Tribute',
      durationMs: 320_357,
      ...overrides,
    });
  const studio = candidate({
    uri: 'spotify:track:studio',
    title: 'Crazy Train',
    artists: ['Ozzy Osbourne'],
    album: 'Blizzard of Ozz',
    durationMs: 293_000,
  });

  it('does not hold back a live track from the same album the file is tagged with', () => {
    const match = matchCandidate(tribute(), live());
    expect(match.capped).toEqual([]);
    expect(match.tier).toBe('high');
    expect(match.selected).toBe(false);
  });

  it('still reports the version difference', () => {
    expect(matchCandidate(tribute(), live()).differences.markersOnlyOnCandidate).toEqual(['live']);
  });

  it('ranks it above the studio version', () => {
    const ranked = rankCandidates(tribute(), [studio, live()]);
    expect(ranked.map((m) => m.candidate.uri)).toEqual([
      'spotify:track:live',
      'spotify:track:studio',
    ]);
  });

  it('still holds a live track from a different album at Review', () => {
    const match = matchCandidate(tribute(), live({ album: 'Live & Loud', durationMs: 322_000 }));
    expect(match.capped).toEqual(['version']);
    expect(match.tier).toBe('review');
  });

  it('still holds back a studio track when the file is tagged live', () => {
    const match = matchCandidate(tribute({ title: 'Crazy Train - Live' }), studio);
    expect(match.capped).toEqual(['version']);
  });
});
