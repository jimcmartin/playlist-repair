import { describe, expect, it } from 'vitest';
import {
  classifyEntry,
  estimateScanRequests,
  scanAll,
  scanPlaylist,
  visiblePlaylists,
  type EntryStatus,
} from '../../src/repair/scan';
import { AuthError } from '../../src/spotify/auth';
import { createClient } from '../../src/spotify/client';
import { parseItemsPage, type PlaylistSummary } from '../../src/spotify/types';
import { authEnv, fakeSleep, json, loggedInSession, routedFetch } from '../helpers/fakes';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';

function classify(rawEntry: unknown): EntryStatus {
  const entry = parseItemsPage({ items: [rawEntry] })?.entries[0];
  if (!entry) throw new Error('bad test entry');
  return classifyEntry(entry);
}

const track = (extra: Record<string, unknown>) => ({ item: { type: 'track', ...extra } });

describe('classifyEntry', () => {
  it('treats a playable track as ok', () => {
    expect(classify(track({ is_playable: true }))).toBe('ok');
  });

  it('treats an unplayable track with reason market as broken', () => {
    expect(classify(track({ is_playable: false, restrictions: { reason: 'market' } }))).toBe(
      'broken',
    );
  });

  it('treats an unplayable track with no reason as broken', () => {
    expect(classify(track({ is_playable: false }))).toBe('broken');
    expect(classify(track({ is_playable: false, restrictions: {} }))).toBe('broken');
  });

  it('shows an explicit restriction without calling it broken', () => {
    expect(classify(track({ is_playable: false, restrictions: { reason: 'explicit' } }))).toBe(
      'explicit',
    );
  });

  it('shows a product restriction without calling it broken', () => {
    expect(classify(track({ is_playable: false, restrictions: { reason: 'product' } }))).toBe(
      'product',
    );
  });

  it('shows a reason the plan does not list as its own case', () => {
    expect(classify(track({ is_playable: false, restrictions: { reason: 'something-new' } }))).toBe(
      'other-restriction',
    );
  });

  it('calls an entry with a null item removed', () => {
    expect(classify({ item: null })).toBe('removed');
    expect(classify({ track: null })).toBe('removed');
  });

  it('skips local files, even ones that look unplayable', () => {
    expect(classify({ is_local: true, item: { type: 'track', is_playable: false } })).toBe('local');
  });

  it('does not repair episodes', () => {
    expect(classify({ item: { type: 'episode', is_playable: false } })).toBe('episode');
  });

  it('does not guess when is_playable is missing', () => {
    expect(classify(track({}))).toBe('unknown');
    expect(classify(track({ restrictions: { reason: 'market' } }))).toBe('unknown');
  });
});

const summary = (id: string, extra: Partial<PlaylistSummary> = {}): PlaylistSummary => ({
  id,
  name: id,
  ownerId: 'jim',
  ownerName: 'Jim',
  collaborative: false,
  snapshotId: `snap-${id}`,
  total: null,
  imageHosts: [],
  ...extra,
});

describe('visiblePlaylists', () => {
  it('keeps owned and collaborative playlists and counts the rest', () => {
    const all = [
      summary('mine'),
      summary('shared', { ownerId: 'sam', collaborative: true }),
      summary('followed', { ownerId: 'sam' }),
    ];

    const { playlists, hidden } = visiblePlaylists(all, 'jim');

    expect(playlists.map((p) => p.id)).toEqual(['mine', 'shared']);
    expect(hidden).toBe(1);
  });
});

function clientFor(items: Record<string, unknown[] | Response>) {
  const routed = routedFetch((call) => {
    // The token endpoint: refreshing is refused, as when the login has been revoked.
    if (call.url.startsWith('https://accounts.spotify.com/')) {
      return json({ error: 'invalid_grant' }, 400);
    }
    const id = new URL(call.url).pathname.split('/')[3] ?? '';
    const reply = items[id];
    if (reply instanceof Response) return reply;
    return json({ items: reply ?? [], total: reply?.length ?? 0, next: null });
  });
  return createClient({
    env: authEnv(routed.fetch, loggedInSession()),
    clientId: CLIENT_ID,
    sleep: fakeSleep().sleep,
  });
}

const broken = track({ is_playable: false, restrictions: { reason: 'market' } });
const fine = track({ is_playable: true });

describe('scanPlaylist', () => {
  it('numbers positions from zero and counts every status', async () => {
    const client = clientFor({ p: [fine, broken, { item: null }, broken, { is_local: true }] });

    const result = await scanPlaylist(client, summary('p'));

    expect(result.snapshotId).toBe('snap-p');
    expect(result.entries.map((e) => [e.position, e.status])).toEqual([
      [0, 'ok'],
      [1, 'broken'],
      [2, 'removed'],
      [3, 'broken'],
      [4, 'local'],
    ]);
    expect(result.counts).toMatchObject({ ok: 1, broken: 2, removed: 1, local: 1 });
  });
});

describe('scanAll', () => {
  it('scans every playlist and skips ones already done', async () => {
    const client = clientFor({ a: [broken], b: [fine], c: [broken, broken] });
    const results = new Map<string, number>();

    const stopped = await scanAll(client, [summary('a'), summary('b'), summary('c')], {
      skip: new Set(['b']),
      onResult: (p, r) => results.set(p.id, r.counts.broken),
      onError: () => {
        throw new Error('unexpected');
      },
    });

    expect(stopped).toBeNull();
    expect(Object.fromEntries(results)).toEqual({ a: 1, c: 2 });
  });

  it('carries on after one playlist fails', async () => {
    const client = clientFor({ a: json({}, 404), b: [broken] });
    const results: string[] = [];
    const errors: string[] = [];

    const stopped = await scanAll(client, [summary('a'), summary('b')], {
      onResult: (p) => results.push(p.id),
      onError: (p) => errors.push(p.id),
    });

    expect(stopped).toBeNull();
    expect(results).toEqual(['b']);
    expect(errors).toEqual(['a']);
  });

  it('stops on a quota error and keeps the results already delivered', async () => {
    const quota = new Response(JSON.stringify({ error: { reason: 'QUOTA_EXCEEDED' } }), {
      status: 429,
    });
    const client = clientFor({ a: [broken], b: quota, c: [broken], d: [broken], e: [broken] });
    const results: string[] = [];

    const stopped = await scanAll(
      client,
      ['a', 'b', 'c', 'd', 'e'].map((id) => summary(id)),
      { onResult: (p) => results.push(p.id), onError: () => undefined },
    );

    expect(stopped).toMatchObject({ name: 'QuotaExceededError' });
    expect(results).toContain('a');
    expect(results).not.toContain('b');
    // The run did not go through the whole list.
    expect(results.length).toBeLessThan(4);
  });

  it('stops when the session ends', async () => {
    const client = clientFor({ a: json({}, 401), b: [broken] });

    const stopped = await scanAll(client, [summary('a'), summary('b')], {
      onResult: () => undefined,
      onError: () => undefined,
    });

    expect(stopped).toBeInstanceOf(AuthError);
  });
});

describe('estimateScanRequests', () => {
  it('counts one request per 50 tracks, and at least one per playlist', () => {
    const playlists = [
      summary('empty', { total: 0 }),
      summary('one', { total: 1 }),
      summary('fifty', { total: 50 }),
      summary('fifty-one', { total: 51 }),
      summary('big', { total: 1000 }),
    ];

    expect(estimateScanRequests(playlists)).toEqual({ requests: 1 + 1 + 1 + 2 + 20, exact: true });
  });

  it('skips playlists that already have a result', () => {
    const playlists = [summary('a', { total: 120 }), summary('b', { total: 10 })];

    expect(estimateScanRequests(playlists, new Set(['a']))).toEqual({ requests: 1, exact: true });
  });

  it('assumes one request for a playlist with no track count, and says it is a minimum', () => {
    const playlists = [summary('a', { total: null }), summary('b', { total: 60 })];

    expect(estimateScanRequests(playlists)).toEqual({ requests: 3, exact: false });
  });
});
