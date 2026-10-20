import { describe, expect, it } from 'vitest';
import {
  candidateFromItem,
  createSearchCache,
  deadTrackFromEntry,
  estimateFindRequests,
  findCandidates,
  findFixes,
  searchQueries,
} from '../../src/repair/search';
import { classifyEntry, type ScanResult } from '../../src/repair/scan';
import {
  ApiError,
  QuotaExceededError,
  RateLimitedError,
  type SpotifyClient,
} from '../../src/spotify/client';
import { must } from '../helpers/must';
import { parseItemsPage, type PlaylistEntry } from '../../src/spotify/types';

function entryOf(raw: Record<string, unknown>): PlaylistEntry {
  const entry = parseItemsPage({ items: [raw] })?.entries[0];
  if (!entry) throw new Error('bad test entry');
  return entry;
}

const rawTrack = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'track',
  id,
  uri: `spotify:track:${id}`,
  name: 'Space Oddity - 2009 Remaster',
  artists: [{ id: 'bowie', name: 'David Bowie' }],
  album: { id: `al-${id}`, name: 'David Bowie', album_type: 'album' },
  duration_ms: 315_000,
  explicit: false,
  external_ids: { isrc: 'GBAAA0900001' },
  is_playable: true,
  ...extra,
});

const deadEntry = (id = 'dead', extra: Record<string, unknown> = {}) =>
  entryOf({
    is_local: false,
    item: rawTrack(id, { is_playable: false, restrictions: { reason: 'market' }, ...extra }),
  });

/** A broken track with its own title and ISRC, so no two share a search. */
const distinct = (id: string, extra: Record<string, unknown> = {}) =>
  deadEntry(id, { name: `Song ${id}`, external_ids: { isrc: `USAAA000000${id}` }, ...extra });

const localEntry = (extra: Record<string, unknown> = {}) =>
  entryOf({
    is_local: true,
    item: {
      type: 'track',
      id: null,
      uri: 'spotify:local:David+Bowie:David+Bowie:Space+Oddity:315',
      name: 'Space Oddity',
      artists: [{ id: null, name: 'David Bowie' }],
      album: { name: 'David Bowie' },
      duration_ms: 315_000,
      explicit: false,
      ...extra,
    },
  });

/** A client that answers each query from a table, and records what was asked. */
function fakeClient(answers: Record<string, unknown[]> = {}, fail?: (q: string) => Error | null) {
  const queries: string[] = [];
  const client: SpotifyClient = {
    get: (path, params) => {
      expect(path).toBe('/search');
      const q = String(params?.q);
      queries.push(q);
      const error = fail?.(q);
      if (error) return Promise.reject(error);
      return Promise.resolve({ tracks: { items: answers[q] ?? [] } });
    },
    send: () => Promise.reject(new Error('Searching never writes')),
  };
  return { client, queries };
}

const deadOf = (entry: PlaylistEntry) => must(deadTrackFromEntry(entry));

describe('deadTrackFromEntry', () => {
  it('reads a broken track', () => {
    expect(deadTrackFromEntry(deadEntry())).toEqual({
      uri: 'spotify:track:dead',
      title: 'Space Oddity - 2009 Remaster',
      artists: ['David Bowie'],
      album: 'David Bowie',
      durationMs: 315_000,
      isrc: 'GBAAA0900001',
      explicit: false,
      isLocal: false,
    });
  });

  it('reads a local file with no ISRC', () => {
    const dead = deadTrackFromEntry(localEntry());
    expect(dead).toMatchObject({ isLocal: true, isrc: null, title: 'Space Oddity' });
    expect(dead?.uri).toBe('spotify:local:David+Bowie:David+Bowie:Space+Oddity:315');
  });

  it('is null for an entry with no item', () => {
    expect(deadTrackFromEntry(entryOf({ item: null }))).toBeNull();
  });
});

describe('candidateFromItem', () => {
  const item = (extra: Record<string, unknown> = {}) =>
    parseItemsPage({ items: [{ item: rawTrack('c', extra) }] })?.entries[0]?.item ?? null;

  it('maps a playable search result', () => {
    const found = item();
    expect(found && candidateFromItem(found)).toMatchObject({
      uri: 'spotify:track:c',
      albumType: 'album',
      isPlayable: true,
      isrc: 'GBAAA0900001',
    });
  });

  it('treats a missing is_playable as not playable', () => {
    const track = rawTrack('c');
    delete (track as Record<string, unknown>).is_playable;
    const found = parseItemsPage({ items: [{ item: track }] })?.entries[0]?.item;
    expect(found && candidateFromItem(found)?.isPlayable).toBe(false);
  });

  it('is null without a URI or duration', () => {
    const found = item({ uri: undefined });
    expect(found && candidateFromItem(found)).toBeNull();
  });
});

describe('searchQueries', () => {
  it('lists the three steps in order', () => {
    const dead = deadTrackFromEntry(deadEntry());
    expect(dead && searchQueries(dead)).toEqual([
      'isrc:GBAAA0900001',
      'track:"space oddity" artist:"david bowie"',
      'space oddity david bowie',
    ]);
  });

  it('skips the ISRC step when there is no ISRC', () => {
    const dead = deadTrackFromEntry(deadEntry('d', { external_ids: {} }));
    expect(dead && searchQueries(dead)).toHaveLength(2);
  });

  it('skips the ISRC step for a local file', () => {
    const dead = deadTrackFromEntry(localEntry());
    expect(dead && searchQueries(dead)).toEqual([
      'track:"space oddity" artist:"david bowie"',
      'space oddity david bowie',
    ]);
  });

  it('searches on the title alone when the artist is missing', () => {
    const dead = deadTrackFromEntry(localEntry({ artists: [] }));
    expect(dead && searchQueries(dead)).toEqual(['track:"space oddity"', 'space oddity']);
  });

  it('has nothing to search for without a title', () => {
    const dead = deadTrackFromEntry(localEntry({ name: null, uri: 'spotify:local::::0' }));
    expect(dead && searchQueries(dead)).toEqual([]);
  });
});

describe('searchQueries with a band name', () => {
  it('filters on the artist without the extra words, and keeps the full name for plain text', () => {
    const dead = deadOf(
      deadEntry('d', {
        name: 'The Brother (For Jimmie & Stevie)',
        artists: [{ id: 'rf', name: 'Robben Ford & The Blue Line' }],
        external_ids: {},
      }),
    );
    expect(searchQueries(dead)).toEqual([
      'track:"the brother" artist:"robben ford"',
      'the brother robben ford and the blue line',
    ]);
  });
});

describe('findCandidates', () => {
  const exactHit = rawTrack('new', {
    name: 'Space Oddity',
    external_ids: { isrc: 'GBAAA0900001' },
  });
  const sameWork = rawTrack('other', {
    name: 'Space Oddity',
    external_ids: { isrc: 'GBBBB1700002' },
  });

  it('stops at the first step that gives an Exact match', async () => {
    const { client, queries } = fakeClient({ 'isrc:GBAAA0900001': [exactHit] });
    const found = await findCandidates(client, deadOf(deadEntry()), createSearchCache());
    expect(queries).toEqual(['isrc:GBAAA0900001']);
    expect(found.requests).toBe(1);
    expect(found.matches[0]?.tier).toBe('exact');
  });

  it('carries on to the text searches when the ISRC finds nothing', async () => {
    const { client, queries } = fakeClient({
      'track:"space oddity" artist:"david bowie"': [sameWork],
    });
    const found = await findCandidates(client, deadOf(deadEntry()), createSearchCache());
    expect(queries).toHaveLength(3);
    expect(found.requests).toBe(3);
    expect(found.matches[0]?.tier).toBe('high');
  });

  it('merges results from several steps without duplicates', async () => {
    const { client } = fakeClient({
      'track:"space oddity" artist:"david bowie"': [sameWork],
      'space oddity david bowie': [sameWork, rawTrack('third', { name: 'Space Oddity (Live)' })],
    });
    const found = await findCandidates(client, deadOf(deadEntry()), createSearchCache());
    expect(found.matches.map((m) => m.candidate.uri).sort()).toEqual([
      'spotify:track:other',
      'spotify:track:third',
    ]);
  });

  it('scores only playable candidates', async () => {
    const { client } = fakeClient({
      'isrc:GBAAA0900001': [{ ...exactHit, is_playable: false }],
    });
    const found = await findCandidates(client, deadOf(deadEntry()), createSearchCache());
    expect(found.matches).toEqual([]);
  });

  it('keeps the full track for every candidate, for links', async () => {
    const { client } = fakeClient({ 'isrc:GBAAA0900001': [exactHit] });
    const found = await findCandidates(client, deadOf(deadEntry()), createSearchCache());
    expect(found.tracks['spotify:track:new']?.albumId).toBe('al-new');
  });

  it('answers a repeated query and a repeated track from the cache', async () => {
    const { client, queries } = fakeClient({ 'isrc:GBAAA0900001': [exactHit] });
    const cache = createSearchCache();
    const dead = deadOf(deadEntry());
    await findCandidates(client, dead, cache);
    const again = await findCandidates(client, dead, cache);
    expect(again.requests).toBe(0);
    expect(queries).toHaveLength(1);
  });

  it('shares a query between two different tracks', async () => {
    const { client, queries } = fakeClient({});
    const cache = createSearchCache();
    await findCandidates(client, deadOf(deadEntry('a', { external_ids: {} })), cache);
    const second = await findCandidates(
      client,
      deadOf(deadEntry('b', { external_ids: {} })),
      cache,
    );
    expect(queries).toHaveLength(2);
    expect(second.requests).toBe(0);
  });

  describe('local files', () => {
    const clearHit = rawTrack('hit', {
      name: 'Space Oddity',
      external_ids: { isrc: 'GBAAA0900001' },
    });

    it('never search by ISRC and never reach Exact', async () => {
      const { client, queries } = fakeClient({
        'track:"space oddity" artist:"david bowie"': [clearHit],
      });
      const found = await findCandidates(client, deadOf(localEntry()), createSearchCache());
      expect(queries.some((q) => q.startsWith('isrc:'))).toBe(false);
      expect(found.matches[0]?.tier).toBe('high');
      expect(found.matches[0]?.selected).toBe(false);
    });

    it('use the plain-text step only when the first found nothing usable', async () => {
      const usable = fakeClient({ 'track:"space oddity" artist:"david bowie"': [clearHit] });
      await findCandidates(usable.client, deadOf(localEntry()), createSearchCache());
      expect(usable.queries).toHaveLength(1);

      const nothing = fakeClient({});
      await findCandidates(nothing.client, deadOf(localEntry()), createSearchCache());
      expect(nothing.queries).toHaveLength(2);
    });

    it('search a file that appears in two playlists once', async () => {
      const { client, queries } = fakeClient({
        'track:"space oddity" artist:"david bowie"': [clearHit],
      });
      const cache = createSearchCache();
      await findCandidates(client, deadOf(localEntry()), cache);
      const other = localEntry({ uri: 'spotify:local:David+Bowie:David+Bowie:Space+Oddity:315' });
      const second = await findCandidates(client, deadOf(other), cache);
      expect(second.requests).toBe(0);
      expect(queries).toHaveLength(1);
    });

    it('rank a file with another duration separately, reusing the cached queries', async () => {
      const { client } = fakeClient({});
      const cache = createSearchCache();
      await findCandidates(client, deadOf(localEntry()), cache);
      const longer = localEntry({
        duration_ms: 400_000,
        uri: 'spotify:local:David+Bowie:David+Bowie:Space+Oddity:400',
      });
      const second = await findCandidates(client, deadOf(longer), cache);
      expect(second.requests).toBe(0); // the queries are the same, so they are cached
    });
  });

  it('sends nothing for a track with no title', async () => {
    const { client, queries } = fakeClient({});
    const dead = deadOf(localEntry({ name: null, uri: 'spotify:local::::0' }));
    const found = await findCandidates(client, dead, createSearchCache());
    expect(queries).toEqual([]);
    expect(found.matches).toEqual([]);
  });
});

function scanOf(entries: PlaylistEntry[]): ScanResult {
  const counts = { ok: 0 } as ScanResult['counts'];
  return {
    playlistId: 'p',
    snapshotId: 'snap',
    counts,
    entries: entries.map((entry, position) => ({ position, entry, status: classifyEntry(entry) })),
  };
}

describe('estimateFindRequests', () => {
  const playable = entryOf({ item: rawTrack('ok') });

  it('counts up to 3 per broken track and 2 per local file, and skips good tracks', () => {
    const scan = scanOf([
      playable,
      distinct('a'),
      distinct('b', { external_ids: {} }),
      localEntry({ name: 'Local Song', uri: 'spotify:local:A:B:Local+Song:315' }),
    ]);
    expect(estimateFindRequests(scan, { includeLocal: false }, createSearchCache())).toEqual({
      requests: 5,
      tracks: 2,
    });
    expect(estimateFindRequests(scan, { includeLocal: true }, createSearchCache())).toEqual({
      requests: 7,
      tracks: 3,
    });
  });

  it('counts a repeated broken track or local file once', () => {
    const scan = scanOf([
      distinct('a'),
      distinct('a'),
      localEntry({ name: 'Local Song', uri: 'spotify:local:A:B:Local+Song:315' }),
      localEntry({ name: 'Local Song', uri: 'spotify:local:A:B:Local+Song:315' }),
    ]);
    expect(estimateFindRequests(scan, { includeLocal: true }, createSearchCache())).toEqual({
      requests: 5,
      tracks: 2,
    });
  });

  it('leaves out tracks already searched', async () => {
    const scan = scanOf([distinct('a'), distinct('b')]);
    const cache = createSearchCache();
    const { client } = fakeClient({});
    await findCandidates(client, deadOf(distinct('a')), cache);
    expect(estimateFindRequests(scan, { includeLocal: false }, cache).tracks).toBe(1);
  });
});

describe('findFixes', () => {
  it('returns a row per broken track in playlist order, with its position', async () => {
    const { client } = fakeClient({});
    const scan = scanOf([entryOf({ item: rawTrack('ok') }), distinct('a'), distinct('b')]);
    const run = await findFixes(client, scan, { includeLocal: false, cache: createSearchCache() });
    expect(run.rows.map((r) => r.position)).toEqual([1, 2]);
    expect(run.stopped).toBeNull();
    expect(run.requests).toBe(6);
  });

  it('leaves local files out unless asked', async () => {
    const { client } = fakeClient({});
    const scan = scanOf([
      localEntry({ name: 'Local Song', uri: 'spotify:local:A:B:Local+Song:315' }),
      distinct('a'),
    ]);
    const without = await findFixes(client, scan, {
      includeLocal: false,
      cache: createSearchCache(),
    });
    expect(without.rows.map((r) => r.dead.isLocal)).toEqual([false]);
    const withLocal = await findFixes(client, scan, {
      includeLocal: true,
      cache: createSearchCache(),
    });
    expect(withLocal.rows.map((r) => r.dead.isLocal)).toEqual([true, false]);
  });

  it('counts only requests that were sent', async () => {
    const { client } = fakeClient({});
    const cache = createSearchCache();
    const scan = scanOf([distinct('a')]);
    await findFixes(client, scan, { includeLocal: false, cache });
    const again = await findFixes(client, scan, { includeLocal: false, cache });
    expect(again.requests).toBe(0);
    expect(again.rows).toHaveLength(1);
  });

  it('stops on a quota error, keeps the rows done, and resumes from the cache', async () => {
    let calls = 0;
    const { client } = fakeClient({}, () =>
      ++calls > 6 ? new QuotaExceededError('/search') : null,
    );
    const cache = createSearchCache();
    const scan = scanOf([distinct('a'), distinct('b'), distinct('c')]);
    const first = await findFixes(client, scan, { includeLocal: false, cache });
    expect(first.stopped).toBeInstanceOf(QuotaExceededError);
    expect(first.rows.length).toBeLessThan(3);
    expect(first.rows.length).toBeGreaterThan(0);

    const resumed = fakeClient({});
    const second = await findFixes(resumed.client, scan, { includeLocal: false, cache });
    expect(second.stopped).toBeNull();
    expect(second.rows).toHaveLength(3);
    expect(second.requests).toBeLessThan(9);
  });

  it('carries on past a failed search, keeps the other rows, and lists the failure', async () => {
    const { client } = fakeClient({}, (q) =>
      q.includes('song b') ? new ApiError(504, 'GET /search returned 504') : null,
    );
    const cache = createSearchCache();
    const scan = scanOf([distinct('a'), distinct('b'), distinct('c')]);
    const run = await findFixes(client, scan, { includeLocal: false, cache });
    expect(run.stopped).toBeNull();
    expect(run.rows.map((r) => r.position)).toEqual([0, 2]);
    expect(run.failed.map((f) => [f.position, f.title])).toEqual([[1, 'Song b']]);
    expect(run.failed[0]?.error).toBeInstanceOf(ApiError);
  });

  it('searches a failed track again on the next run, and only that one', async () => {
    let broken = true;
    const { client, queries } = fakeClient({}, (q) =>
      broken && q.includes('song b') ? new ApiError(504, 'timeout') : null,
    );
    const cache = createSearchCache();
    const scan = scanOf([distinct('a'), distinct('b')]);
    await findFixes(client, scan, { includeLocal: false, cache });
    broken = false;
    queries.length = 0;
    const again = await findFixes(client, scan, { includeLocal: false, cache });
    expect(again.failed).toEqual([]);
    expect(again.rows).toHaveLength(2);
    expect(queries.every((q) => q.includes('song b'))).toBe(true);
  });

  it('still stops on a rate limit or an ended login, not just quota', async () => {
    const { client } = fakeClient({}, () => new RateLimitedError('/search', 120_000));
    const run = await findFixes(client, scanOf([distinct('a'), distinct('b')]), {
      includeLocal: false,
      cache: createSearchCache(),
    });
    expect(run.stopped).toBeInstanceOf(RateLimitedError);
    expect(run.failed).toEqual([]);
  });

  it('reports progress', async () => {
    const { client } = fakeClient({});
    const seen: [number, number][] = [];
    await findFixes(client, scanOf([distinct('a'), distinct('b')]), {
      includeLocal: false,
      cache: createSearchCache(),
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.at(-1)).toEqual([2, 2]);
  });
});
