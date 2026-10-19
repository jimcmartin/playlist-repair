import { describe, expect, it } from 'vitest';
import { MATCH_WEIGHTS, MISSING_PART, REMASTER_SCORE_PENALTY } from '../../src/config';
import { combineParts, durationScore, scoreParts } from '../../src/engine';
import { candidate, dead } from '../helpers/engine';

describe('weights', () => {
  it('sum to 1', () => {
    const sum = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe('durationScore', () => {
  it('is 1 within 2 seconds, either direction', () => {
    expect(durationScore(0)).toBe(1);
    expect(durationScore(2_000)).toBe(1);
    expect(durationScore(-2_000)).toBe(1);
  });

  it('is 0 at 15 seconds and beyond', () => {
    expect(durationScore(15_000)).toBe(0);
    expect(durationScore(60_000)).toBe(0);
  });

  it('falls linearly between', () => {
    expect(durationScore(8_500)).toBeCloseTo(0.5);
  });
});

describe('scoreParts', () => {
  it('scores a perfect candidate 1 on every part', () => {
    expect(scoreParts(dead(), candidate())).toEqual({
      title: 1,
      artists: 1,
      duration: 1,
      album: 1,
    });
  });

  it('compares base titles, not version tags', () => {
    const parts = scoreParts(
      dead({ title: 'Song (Live)' }),
      candidate({ title: 'Song - Remastered' }),
    );
    expect(parts.title).toBe(1);
  });

  it('scores a typo in the title below 1 but above 0.9', () => {
    const parts = scoreParts(dead({ title: 'Blue Monday' }), candidate({ title: 'Blue Mondey' }));
    expect(parts.title).toBeGreaterThan(0.9);
    expect(parts.title).toBeLessThan(1);
  });

  describe('artists', () => {
    it('rewards the primary artist, then overlap of the full sets', () => {
      const same = scoreParts(dead({ artists: ['A', 'B'] }), candidate({ artists: ['A', 'B'] }));
      const extra = scoreParts(dead({ artists: ['A', 'B'] }), candidate({ artists: ['A'] }));
      const swapped = scoreParts(dead({ artists: ['A', 'B'] }), candidate({ artists: ['B', 'A'] }));
      const other = scoreParts(dead({ artists: ['A'] }), candidate({ artists: ['Z'] }));
      expect(same.artists).toBe(1);
      expect(extra.artists).toBeLessThan(1);
      expect(extra.artists).toBeGreaterThan(swapped.artists ?? 1);
      expect(swapped.artists).toBeGreaterThan(other.artists ?? 1);
      expect(other.artists).toBe(0);
    });

    it('counts a feat. credit in the title as an artist on that side', () => {
      const a = scoreParts(
        dead({ title: 'Song (feat. B)', artists: ['A'] }),
        candidate({ title: 'Song', artists: ['A', 'B'] }),
      );
      const b = scoreParts(
        dead({ title: 'Song', artists: ['A', 'B'] }),
        candidate({ title: 'Song (feat. B)', artists: ['A'] }),
      );
      expect(a.artists).toBe(1);
      expect(b.artists).toBe(1);
      expect(a.title).toBe(1);
    });

    it('is null when the dead track has no artist', () => {
      expect(scoreParts(dead({ artists: [] }), candidate()).artists).toBeNull();
    });
  });

  describe('duration', () => {
    it('uses the difference in milliseconds', () => {
      expect(scoreParts(dead(), candidate({ durationMs: 201_500 })).duration).toBe(1);
      expect(scoreParts(dead(), candidate({ durationMs: 220_000 })).duration).toBe(0);
    });

    it('is null when the dead track has no duration', () => {
      expect(scoreParts(dead({ durationMs: null }), candidate()).duration).toBeNull();
    });

    it('forgives a local file one second of rounding', () => {
      const local = dead({ isLocal: true, durationMs: 200_000 });
      expect(scoreParts(local, candidate({ durationMs: 202_900 })).duration).toBe(1);
      expect(
        scoreParts(dead({ durationMs: 200_000 }), candidate({ durationMs: 202_900 })).duration,
      ).toBeLessThan(1);
    });
  });

  describe('album', () => {
    it('ignores edition words', () => {
      const parts = scoreParts(
        dead({ album: 'Album' }),
        candidate({ album: 'Album (Deluxe Edition)' }),
      );
      expect(parts.album).toBe(1);
    });

    it('is low for a different album', () => {
      const parts = scoreParts(dead({ album: 'Greatest Hits' }), candidate({ album: 'Now 54' }));
      expect(parts.album).toBeLessThan(0.3);
    });

    it('is null when the dead track has no album', () => {
      expect(scoreParts(dead({ album: '' }), candidate()).album).toBeNull();
    });
  });
});

describe('combineParts', () => {
  it('is the weighted sum when every part is present', () => {
    const score = combineParts({ title: 1, artists: 0.5, duration: 0, album: 1 });
    expect(score).toBeCloseTo(0.4 + 0.125 + 0 + 0.15);
  });

  it('counts a missing part for less, scored as unknown', () => {
    const full = combineParts({ title: 1, artists: 1, duration: 1, album: 1 });
    const missing = combineParts({ title: 1, artists: 1, duration: null, album: null });
    const w = MATCH_WEIGHTS;
    const f = MISSING_PART.weightFactor;
    const expected =
      (w.title + w.artists + MISSING_PART.value * f * (w.duration + w.album)) /
      (w.title + w.artists + f * (w.duration + w.album));
    expect(full).toBe(1);
    expect(missing).toBeCloseTo(expected);
    expect(missing).toBeLessThan(1);
  });

  it('takes the remaster penalty off when asked', () => {
    const parts = { title: 1, artists: 1, duration: 1, album: 1 };
    expect(combineParts(parts, { remasterDiffers: true })).toBeCloseTo(1 - REMASTER_SCORE_PENALTY);
  });

  it('never goes below 0', () => {
    const parts = { title: 0, artists: 0, duration: 0, album: 0 };
    expect(combineParts(parts, { remasterDiffers: true })).toBe(0);
  });
});
