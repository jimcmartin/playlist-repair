import type { VersionMarker } from './types';

export { similarity } from './similarity';

/** Lowercase, no diacritics or punctuation, `&` as `and`, single spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface ParsedTitle {
  /** The normalized title without tags or credits. */
  base: string;
  /** The normalized text of each tag: brackets first, then the parts after ` - `. */
  tags: string[];
  markers: VersionMarker[];
  /** Normalized names from `feat.` credits. */
  featured: string[];
}

const MARKER_ORDER: VersionMarker[] = [
  'live',
  'acoustic',
  'remix',
  'instrumental',
  'karaoke',
  'demo',
  'edit',
  'mono',
  'stereo',
  'extended',
  're-recorded',
  'remaster',
];

const MARKER_WORDS: Record<string, VersionMarker> = {
  live: 'live',
  acoustic: 'acoustic',
  remix: 'remix',
  remixed: 'remix',
  instrumental: 'instrumental',
  karaoke: 'karaoke',
  demo: 'demo',
  edit: 'edit',
  edited: 'edit',
  mono: 'mono',
  stereo: 'stereo',
  extended: 'extended',
  rerecorded: 're-recorded',
  remaster: 'remaster',
  remastered: 'remaster',
  remasters: 'remaster',
};

const BRACKETS = /[([]([^()[\]]*)[)\]]/g;
const FEAT_TAG = /^(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i;
const FEAT_TRAILING = /^(.*?)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i;

function splitNames(credit: string): string[] {
  return credit
    .split(/\s*(?:,|&|;|\band\b)\s*/i)
    .map(normalizeText)
    .filter((name) => name !== '');
}

function markersIn(tag: string): VersionMarker[] {
  const text = tag.replace(/\bre recorded\b/g, 'rerecorded');
  const found = new Set<VersionMarker>();
  for (const word of text.split(' ')) {
    const marker = MARKER_WORDS[word];
    if (marker) found.add(marker);
  }
  return MARKER_ORDER.filter((marker) => found.has(marker));
}

/** Splits a title into base title, version tags, version markers and `feat.` credits. */
export function splitTitle(title: string): ParsedTitle {
  const rawTags: string[] = [];
  const withoutBrackets = title.replace(BRACKETS, (_, inner: string) => {
    rawTags.push(inner);
    return ' ';
  });
  const [rawBase = '', ...dashed] = withoutBrackets.split(/\s+-\s+/);
  rawTags.push(...dashed);

  let baseText = rawBase;
  const featured: string[] = [];
  const trailing = FEAT_TRAILING.exec(baseText);
  if (trailing) {
    baseText = trailing[1] ?? '';
    featured.push(...splitNames(trailing[2] ?? ''));
  }

  const tags: string[] = [];
  for (const raw of rawTags) {
    const credit = FEAT_TAG.exec(raw.trim());
    if (credit) {
      featured.push(...splitNames(credit[1] ?? ''));
      continue;
    }
    const tag = normalizeText(raw);
    if (tag !== '') tags.push(tag);
  }

  const found = new Set(tags.flatMap(markersIn));
  return {
    base: normalizeText(baseText),
    tags,
    markers: MARKER_ORDER.filter((marker) => found.has(marker)),
    featured,
  };
}

const EDITION_WORDS = new Set([
  'deluxe',
  'edition',
  'expanded',
  'remaster',
  'remastered',
  'anniversary',
  'version',
  'bonus',
  'track',
  'tracks',
  'special',
  'collectors',
  'super',
  'legacy',
  'reissue',
  'digital',
  'standard',
]);

/** An album name without edition words, and without the years and ordinals that go with them. */
export function normalizeAlbum(album: string): string {
  const normalized = normalizeText(album);
  const words = normalized.split(' ');
  if (!words.some((word) => EDITION_WORDS.has(word))) return normalized;
  const kept = words.filter(
    (word) =>
      !EDITION_WORDS.has(word) &&
      !/^\d+(?:st|nd|rd|th)$/.test(word) &&
      !/^(?:19|20)\d\d$/.test(word),
  );
  return kept.length > 0 ? kept.join(' ') : normalized;
}

/**
 * The first artist's name without a trailing band: "robben ford and the blue
 * line" gives "robben ford". Used to search, since Spotify files the same
 * recordings under both credits. Returns the whole name if nothing is left before "and".
 */
export function coreArtistName(artist: string): string {
  const name = normalizeText(artist);
  const head = name.split(' and ')[0] ?? '';
  return head === '' ? name : head;
}
