import type { Candidate, DeadTrack } from '../../src/engine';

export function dead(overrides: Partial<DeadTrack> = {}): DeadTrack {
  return {
    uri: 'spotify:track:dead',
    title: 'Song',
    artists: ['Artist'],
    album: 'Album',
    durationMs: 200_000,
    isrc: 'USAAA1100001',
    explicit: false,
    isLocal: false,
    ...overrides,
  };
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    uri: 'spotify:track:candidate',
    title: 'Song',
    artists: ['Artist'],
    album: 'Album',
    albumType: 'album',
    durationMs: 200_000,
    isrc: 'USAAA1100001',
    explicit: false,
    isPlayable: true,
    ...overrides,
  };
}

/** A local file as the repair flow would build it: whole seconds, no ISRC, default flag. */
export function localFile(overrides: Partial<DeadTrack> = {}): DeadTrack {
  return dead({
    uri: 'spotify:local:Artist:Album:Song:200',
    durationMs: 200_000,
    isrc: null,
    explicit: false,
    isLocal: true,
    ...overrides,
  });
}
