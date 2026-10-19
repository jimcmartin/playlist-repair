import { describe, expect, it } from 'vitest';
import { normalizeAlbum, normalizeText, similarity, splitTitle } from '../../src/engine';

describe('normalizeText', () => {
  it('lowercases, strips diacritics and punctuation, and collapses spaces', () => {
    expect(normalizeText('  Beyoncé -  Déjà   Vu!! ')).toBe('beyonce deja vu');
  });

  it('turns & into and', () => {
    expect(normalizeText('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(normalizeText('Simon and Garfunkel')).toBe('simon and garfunkel');
  });

  it('drops apostrophes without splitting the word', () => {
    expect(normalizeText("Don’t Stop Believin'")).toBe('dont stop believin');
  });

  it('keeps letters and digits from other scripts', () => {
    expect(normalizeText('君の名は。')).toBe('君の名は');
  });
});

describe('splitTitle', () => {
  it('returns a plain title untouched', () => {
    expect(splitTitle('Yesterday')).toEqual({
      base: 'yesterday',
      tags: [],
      markers: [],
      featured: [],
    });
  });

  it('reads tags from parentheses, brackets and the part after a dash', () => {
    expect(splitTitle('Song (Live) [Mono] - Radio Edit').tags).toEqual([
      'live',
      'mono',
      'radio edit',
    ]);
    expect(splitTitle('Song (Live) [Mono] - Radio Edit').base).toBe('song');
  });

  it('does not split a hyphen without spaces around it', () => {
    expect(splitTitle('Check-In').base).toBe('check in');
    expect(splitTitle('Check-In').tags).toEqual([]);
  });

  it('recognizes each version marker', () => {
    const cases: [string, string][] = [
      ['Song - Live at Wembley', 'live'],
      ['Song (Acoustic)', 'acoustic'],
      ['Song (Club Remix)', 'remix'],
      ['Song (Instrumental)', 'instrumental'],
      ['Song (Karaoke Version)', 'karaoke'],
      ['Song (Demo)', 'demo'],
      ['Song - Radio Edit', 'edit'],
      ['Song (Mono)', 'mono'],
      ['Song (Stereo)', 'stereo'],
      ['Song (Extended Mix)', 'extended'],
      ['Song (Re-Recorded)', 're-recorded'],
      ['Song - 2011 Remaster', 'remaster'],
      ['Song (Remastered 2009)', 'remaster'],
    ];
    for (const [title, marker] of cases) {
      expect(splitTitle(title).markers, title).toContain(marker);
    }
  });

  it('does not read a marker out of the base title', () => {
    expect(splitTitle('Live and Let Die').markers).toEqual([]);
    expect(splitTitle('Demolition Man').markers).toEqual([]);
  });

  it('ignores tags that are not markers', () => {
    const parsed = splitTitle('Song (From the Motion Picture)');
    expect(parsed.markers).toEqual([]);
    expect(parsed.base).toBe('song');
  });

  it('lists markers once, in a stable order', () => {
    expect(splitTitle('Song (Live) - Live Remaster').markers).toEqual(['live', 'remaster']);
  });

  it('moves feat. credits out of the title', () => {
    for (const title of [
      'Song (feat. Ann Lee)',
      'Song [ft. Ann Lee]',
      'Song - feat. Ann Lee',
      'Song feat. Ann Lee',
      'Song (featuring Ann Lee)',
      'Song (with Ann Lee)',
    ]) {
      const parsed = splitTitle(title);
      expect(parsed.base, title).toBe('song');
      expect(parsed.featured, title).toEqual(['ann lee']);
      expect(parsed.tags, title).toEqual([]);
    }
  });

  it('splits several featured artists', () => {
    expect(splitTitle('Song (feat. Ann Lee, Bo & Cy)').featured).toEqual(['ann lee', 'bo', 'cy']);
  });

  it('keeps a feat. credit and a version tag apart', () => {
    const parsed = splitTitle('Song (feat. Ann Lee) - Live');
    expect(parsed.featured).toEqual(['ann lee']);
    expect(parsed.markers).toEqual(['live']);
  });
});

describe('similarity', () => {
  it('is 1 for equal strings and 0 for unrelated ones', () => {
    expect(similarity('blue monday', 'blue monday')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });

  it('is 0 when either side is empty', () => {
    expect(similarity('', 'abc')).toBe(0);
    expect(similarity('', '')).toBe(0);
  });

  it('is high for a one-letter typo and low for a different title', () => {
    expect(similarity('blue monday', 'blue mondey')).toBeGreaterThan(0.9);
    expect(similarity('step on it', 'start it up')).toBeLessThan(0.5);
  });
});

describe('normalizeAlbum', () => {
  it('ignores edition words', () => {
    expect(normalizeAlbum('Toys in the Attic (Remastered)')).toBe('toys in the attic');
    expect(normalizeAlbum('Toys in the Attic - Deluxe Edition')).toBe('toys in the attic');
    expect(normalizeAlbum('Toys in the Attic (25th Anniversary Expanded Edition)')).toBe(
      'toys in the attic',
    );
  });

  it('keeps an album whose whole name is edition words', () => {
    expect(normalizeAlbum('Deluxe')).toBe('deluxe');
  });
});
