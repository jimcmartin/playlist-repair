import { describe, expect, it } from 'vitest';
import { matchCandidate, rankCandidates } from '../../src/engine';
import { candidate, dead } from '../helpers/engine';

describe('Exact', () => {
  it('needs the same ISRC, duration within 2 seconds and the same explicit flag', () => {
    const match = matchCandidate(dead(), candidate({ durationMs: 202_000 }));
    expect(match.tier).toBe('exact');
    expect(match.selected).toBe(true);
  });

  it('ignores ISRC case and hyphens', () => {
    const match = matchCandidate(
      dead({ isrc: 'US-AAA-11-00001' }),
      candidate({ isrc: 'usaaa1100001' }),
    );
    expect(match.tier).toBe('exact');
  });

  it('drops to High when the duration is 2.5 seconds off', () => {
    expect(matchCandidate(dead(), candidate({ durationMs: 202_500 })).tier).toBe('high');
  });

  it('needs an ISRC on both sides', () => {
    expect(matchCandidate(dead({ isrc: null }), candidate()).tier).not.toBe('exact');
    expect(matchCandidate(dead(), candidate({ isrc: null })).tier).not.toBe('exact');
  });

  it('is not given when the ISRC differs', () => {
    expect(matchCandidate(dead(), candidate({ isrc: 'USAAA1100002' })).tier).toBe('high');
  });

  it('is held at Review when the version markers differ, even with the same ISRC', () => {
    const match = matchCandidate(dead(), candidate({ title: 'Song (Live)' }));
    expect(match.tier).toBe('review');
    expect(match.capped).toEqual(['version']);
    expect(match.selected).toBe(false);
  });
});

describe('High', () => {
  const noIsrc = { isrc: null } as const;

  it('needs a score of 0.90 or more', () => {
    const match = matchCandidate(dead(noIsrc), candidate({ ...noIsrc }));
    expect(match.score).toBe(1);
    expect(match.tier).toBe('high');
    expect(match.selected).toBe(true);
  });

  it('needs the duration within 3 seconds', () => {
    expect(matchCandidate(dead(noIsrc), candidate({ ...noIsrc, durationMs: 203_000 })).tier).toBe(
      'high',
    );
    const far = matchCandidate(dead(noIsrc), candidate({ ...noIsrc, durationMs: 203_500 }));
    expect(far.score).toBeGreaterThanOrEqual(0.9);
    expect(far.tier).toBe('review');
  });

  it('is not reached by a score just under 0.90', () => {
    const match = matchCandidate(
      dead(noIsrc),
      candidate({ ...noIsrc, album: 'Something Else Entirely', durationMs: 203_000 }),
    );
    expect(match.score).toBeLessThan(0.9);
    expect(match.tier).toBe('review');
  });

  it('allows a remaster on one side and takes a little off the score', () => {
    const match = matchCandidate(
      dead({ ...noIsrc, title: 'Song - 2011 Remaster' }),
      candidate({ ...noIsrc }),
    );
    expect(match.tier).toBe('high');
    expect(match.score).toBeLessThan(1);
    expect(match.capped).toEqual([]);
  });
});

describe('Review and None', () => {
  it('is Review from 0.70 and None below', () => {
    const base = dead({ isrc: null });
    const review = matchCandidate(
      base,
      candidate({ isrc: null, title: 'Songs', durationMs: 205_000 }),
    );
    expect(review.score).toBeGreaterThanOrEqual(0.7);
    expect(review.score).toBeLessThan(0.9);
    expect(review.tier).toBe('review');
    expect(review.selected).toBe(false);

    const none = matchCandidate(
      base,
      candidate({ isrc: null, title: 'Other Thing', artists: ['Z'], album: 'Q' }),
    );
    expect(none.score).toBeLessThan(0.7);
    expect(none.tier).toBe('none');
    expect(none.selected).toBe(false);
  });

  it('does not lift a low score to Review because of a cap', () => {
    const match = matchCandidate(
      dead({ isrc: null }),
      candidate({
        isrc: null,
        title: 'Unrelated Words (Live)',
        artists: ['Z'],
        album: 'Q',
        durationMs: 90_000,
      }),
    );
    expect(match.tier).toBe('none');
  });
});

describe('caps', () => {
  it.each([
    ['live', 'Song (Live)'],
    ['acoustic', 'Song - Acoustic'],
    ['remix', 'Song (Remix)'],
    ['instrumental', 'Song (Instrumental)'],
    ['karaoke', 'Song (Karaoke)'],
    ['demo', 'Song (Demo)'],
    ['edit', 'Song (Radio Edit)'],
    ['extended', 'Song (Extended)'],
    ['mono', 'Song (Mono)'],
  ])('holds a %s mismatch at Review', (_marker, title) => {
    const match = matchCandidate(dead({ isrc: null }), candidate({ isrc: null, title }));
    expect(match.score).toBeGreaterThanOrEqual(0.9);
    expect(match.tier).toBe('review');
    expect(match.capped).toEqual(['version']);
  });

  it('holds a mismatch the other way round too', () => {
    const match = matchCandidate(
      dead({ title: 'Song (Live)', isrc: null }),
      candidate({ isrc: null }),
    );
    expect(match.tier).toBe('review');
  });

  it('does not cap when both sides carry the same marker', () => {
    const match = matchCandidate(
      dead({ title: 'Song (Live)', isrc: null }),
      candidate({ title: 'Song - Live', isrc: null }),
    );
    expect(match.tier).toBe('high');
  });

  it('holds a different explicit flag at Review', () => {
    const match = matchCandidate(dead({ explicit: true }), candidate({ explicit: false }));
    expect(match.tier).toBe('review');
    expect(match.capped).toEqual(['explicit']);
  });

  it('lists both reasons when both apply', () => {
    const match = matchCandidate(
      dead({ explicit: true }),
      candidate({ explicit: false, title: 'Song (Live)' }),
    );
    expect(match.capped).toEqual(['version', 'explicit']);
  });

  it('reports what differs', () => {
    const match = matchCandidate(
      dead({ title: 'Song - 2011 Remaster', explicit: true, album: 'A', durationMs: 200_000 }),
      candidate({ title: 'Song (Live)', explicit: false, album: 'B', durationMs: 198_000 }),
    );
    expect(match.differences).toEqual({
      durationDiffMs: -2_000,
      sameAlbum: false,
      explicitDiffers: true,
      markersOnlyOnDead: ['remaster'],
      markersOnlyOnCandidate: ['live'],
    });
  });
});

describe('rankCandidates', () => {
  it('never scores a candidate that is not playable', () => {
    const ranked = rankCandidates(dead(), [
      candidate({ uri: 'spotify:track:a', isPlayable: false }),
      candidate({ uri: 'spotify:track:b' }),
    ]);
    expect(ranked.map((m) => m.candidate.uri)).toEqual(['spotify:track:b']);
  });

  it('returns nothing for no candidates', () => {
    expect(rankCandidates(dead(), [])).toEqual([]);
  });

  it('orders by tier, then by score', () => {
    const ranked = rankCandidates(dead(), [
      candidate({ uri: 'spotify:track:review', title: 'Song (Live)' }),
      candidate({
        uri: 'spotify:track:none',
        title: 'Nothing',
        artists: ['Z'],
        album: 'Q',
        isrc: null,
      }),
      candidate({ uri: 'spotify:track:high', isrc: 'USAAA1100002', album: 'Other Album' }),
      candidate({ uri: 'spotify:track:exact' }),
    ]);
    expect(ranked.map((m) => m.tier)).toEqual(['exact', 'high', 'review', 'none']);
    expect(ranked.map((m) => m.candidate.uri)).toEqual([
      'spotify:track:exact',
      'spotify:track:high',
      'spotify:track:review',
      'spotify:track:none',
    ]);
  });

  describe('ties between candidates that share an ISRC', () => {
    const base = dead({ album: 'Toys in the Attic' });

    it('prefers the same album name', () => {
      const ranked = rankCandidates(base, [
        candidate({ uri: 'spotify:track:other', album: 'Other Album', albumType: 'album' }),
        candidate({ uri: 'spotify:track:same', album: 'Toys in the Attic (Remastered)' }),
      ]);
      expect(ranked[0]?.candidate.uri).toBe('spotify:track:same');
    });

    it('then an album over a compilation', () => {
      const ranked = rankCandidates(base, [
        candidate({ uri: 'spotify:track:comp', album: 'Hits A', albumType: 'compilation' }),
        candidate({ uri: 'spotify:track:album', album: 'Hits B', albumType: 'album' }),
      ]);
      expect(ranked[0]?.candidate.uri).toBe('spotify:track:album');
    });

    it('then the closest duration', () => {
      const ranked = rankCandidates(base, [
        candidate({ uri: 'spotify:track:far', album: 'Hits A', durationMs: 201_800 }),
        candidate({ uri: 'spotify:track:near', album: 'Hits B', durationMs: 200_300 }),
      ]);
      expect(ranked[0]?.candidate.uri).toBe('spotify:track:near');
    });

    it('applies even when the score would order them differently', () => {
      const ranked = rankCandidates(base, [
        candidate({ uri: 'spotify:track:comp', album: 'Greatest Hits', albumType: 'compilation' }),
        candidate({
          uri: 'spotify:track:same',
          title: 'Sxxg',
          album: 'Toys in the Attic',
          albumType: 'album',
        }),
      ]);
      expect(ranked[0]?.candidate.uri).toBe('spotify:track:same');
    });

    it('keeps input order when nothing separates them', () => {
      const ranked = rankCandidates(base, [
        candidate({ uri: 'spotify:track:first' }),
        candidate({ uri: 'spotify:track:second' }),
      ]);
      expect(ranked.map((m) => m.candidate.uri)).toEqual([
        'spotify:track:first',
        'spotify:track:second',
      ]);
    });

    it('does not reorder candidates with different ISRCs by these rules', () => {
      const ranked = rankCandidates(base, [
        candidate({
          uri: 'spotify:track:lower',
          isrc: 'USAAA1100002',
          album: 'Other Album',
          albumType: 'compilation',
        }),
        candidate({
          uri: 'spotify:track:higher',
          isrc: 'USAAA1100003',
          album: 'Toys in the Attic',
        }),
      ]);
      expect(ranked[0]?.candidate.uri).toBe('spotify:track:higher');
    });
  });
});
