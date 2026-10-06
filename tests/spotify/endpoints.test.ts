import { describe, expect, it } from 'vitest';
import { createClient } from '../../src/spotify/client';
import { getPlaylistItems, getProfile, listPlaylists } from '../../src/spotify/endpoints';
import { parseItemsPage, parsePlaylistPage } from '../../src/spotify/types';
import { API, authEnv, fakeSleep, json, loggedInSession, routedFetch } from '../helpers/fakes';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';

function clientFor(handler: (url: URL) => Response) {
  const routed = routedFetch((call) => handler(new URL(call.url)));
  const client = createClient({
    env: authEnv(routed.fetch, loggedInSession()),
    clientId: CLIENT_ID,
    sleep: fakeSleep().sleep,
  });
  return { client, calls: routed.calls };
}

const playlist = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Playlist ${id}`,
  collaborative: false,
  snapshot_id: `snap-${id}`,
  owner: { id: 'jim', display_name: 'Jim M' },
  items: { total: 3 },
  images: [{ url: 'https://mosaic.scdn.co/640/abc' }],
  ...extra,
});

const entry = (n: number) => ({
  added_at: '2026-01-01T00:00:00Z',
  is_local: false,
  item: {
    type: 'track',
    id: `t${String(n)}`,
    uri: `spotify:track:t${String(n)}`,
    is_playable: true,
  },
});

/** A server holding `total` entries that answers by `offset` and `limit`. */
function pagedItems(total: number) {
  return (url: URL) => {
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
      entry(offset + i),
    );
    return json({
      items,
      total,
      next: offset + limit < total ? 'https://elsewhere.test/next' : null,
    });
  };
}

describe('getProfile', () => {
  it('reads the profile through the client', async () => {
    const { client } = clientFor(() => json({ id: 'jim', display_name: 'Jim M' }));
    expect(await getProfile(client)).toEqual({ id: 'jim', displayName: 'Jim M' });
  });

  it('rejects a reply with no user id', async () => {
    const { client } = clientFor(() => json({}));
    await expect(getProfile(client)).rejects.toThrow('no user id');
  });
});

describe('listPlaylists', () => {
  it('pages by offset until there is no next page', async () => {
    const { client, calls } = clientFor((url) => {
      const offset = Number(url.searchParams.get('offset'));
      return json({ items: [playlist(`p${String(offset)}`)], next: offset < 100 ? 'x' : null });
    });

    const { playlists } = await listPlaylists(client);

    expect(playlists.map((p) => p.id)).toEqual(['p0', 'p50', 'p100']);
    expect(calls.map((c) => c.url)).toEqual([
      `${API}/me/playlists?limit=50&offset=0`,
      `${API}/me/playlists?limit=50&offset=50`,
      `${API}/me/playlists?limit=50&offset=100`,
    ]);
  });

  it('handles an empty list', async () => {
    const { client } = clientFor(() => json({ items: [], next: null }));
    expect(await listPlaylists(client)).toEqual({ playlists: [], dropped: 0 });
  });

  it('never requests a host taken from a next URL', async () => {
    const { client, calls } = clientFor((url) =>
      json({
        items: [],
        next: url.searchParams.get('offset') === '0' ? 'https://evil.test/' : null,
      }),
    );

    await listPlaylists(client);

    expect(calls.every((c) => c.url.startsWith(API))).toBe(true);
  });

  it('rejects a page with no items list', async () => {
    const { client } = clientFor(() => json({ oops: true }));
    await expect(listPlaylists(client)).rejects.toThrow('no items list');
  });
});

describe('parsePlaylistPage', () => {
  it('drops entries it cannot read and counts them', () => {
    const page = parsePlaylistPage({
      items: [playlist('a'), null, { id: 'no-owner' }, playlist('b')],
      next: null,
    });

    expect(page?.playlists.map((p) => p.id)).toEqual(['a', 'b']);
    expect(page?.dropped).toBe(2);
  });

  it('reads the owner, track count and image hosts', () => {
    const page = parsePlaylistPage({
      items: [playlist('a', { collaborative: true, owner: { id: 'sam' } })],
    });

    expect(page?.playlists[0]).toMatchObject({
      ownerId: 'sam',
      ownerName: 'sam',
      collaborative: true,
      total: 3,
      snapshotId: 'snap-a',
      imageHosts: ['mosaic.scdn.co'],
    });
  });

  it('falls back to the older `tracks` count, and to null when there is none', () => {
    const page = parsePlaylistPage({
      items: [
        playlist('a', { items: undefined, tracks: { total: 7 } }),
        playlist('b', { items: undefined }),
      ],
    });

    expect(page?.playlists.map((p) => p.total)).toEqual([7, null]);
  });
});

describe('getPlaylistItems', () => {
  it.each([0, 1, 50, 51, 120])(
    'collects every entry of a playlist with %i tracks',
    async (total) => {
      const { client, calls } = clientFor(pagedItems(total));

      const entries = await getPlaylistItems(client, 'abc');

      expect(entries).toHaveLength(total);
      // An exact multiple of 50 needs no extra request.
      expect(calls).toHaveLength(Math.max(1, Math.ceil(total / 50)));
    },
  );

  it('uses /items, sends no market by default, and sends one when asked', async () => {
    const { client, calls } = clientFor(pagedItems(1));

    await getPlaylistItems(client, 'abc');
    await getPlaylistItems(client, 'abc', { market: 'GB' });

    expect(calls[0]?.url).toBe(`${API}/playlists/abc/items?limit=50&offset=0`);
    expect(calls[1]?.url).toBe(`${API}/playlists/abc/items?limit=50&offset=0&market=GB`);
  });

  it('reports progress after each page', async () => {
    const { client } = clientFor(pagedItems(60));
    const seen: [number, number | null][] = [];

    await getPlaylistItems(client, 'abc', { onPage: (n, total) => seen.push([n, total]) });

    expect(seen).toEqual([
      [50, 60],
      [60, 60],
    ]);
  });
});

describe('parseItemsPage', () => {
  it('reads `item`, and falls back to the deprecated `track`', () => {
    const page = parseItemsPage({
      items: [
        { item: { type: 'track', uri: 'spotify:track:a' } },
        { track: { type: 'track', uri: 'spotify:track:b' } },
      ],
    });

    expect(page?.entries.map((e) => e.item?.uri)).toEqual(['spotify:track:a', 'spotify:track:b']);
  });

  it('keeps a null item and a malformed entry as entries with no item', () => {
    const page = parseItemsPage({ items: [{ item: null }, 'garbage', { added_at: 'x' }] });

    expect(page?.entries).toHaveLength(3);
    expect(page?.entries.every((e) => e.item === null)).toBe(true);
    expect(page?.entries[1]?.raw).toBe('garbage');
  });

  it('tells a missing is_playable from false, and reads the restriction reason', () => {
    const page = parseItemsPage({
      items: [
        { item: { type: 'track' } },
        { item: { type: 'track', is_playable: false, restrictions: { reason: 'market' } } },
        { item: { type: 'track', is_playable: false, restrictions: {} } },
      ],
    });

    expect(page?.entries.map((e) => [e.item?.isPlayable, e.item?.restrictionReason])).toEqual([
      [null, null],
      [false, 'market'],
      [false, null],
    ]);
  });

  it('reads the fields a later milestone needs, with safe defaults for missing ones', () => {
    const page = parseItemsPage({
      items: [
        {
          item: {
            type: 'track',
            id: 't',
            uri: 'spotify:track:t',
            name: 'Song',
            artists: [{ id: 'a', name: 'Band' }, { nope: 1 }],
            album: { name: 'Album', images: [{ url: 'https://i.scdn.co/image/x' }] },
            duration_ms: 1000,
            explicit: true,
            external_ids: { isrc: 'GBAAA0000001' },
          },
        },
      ],
    });

    expect(page?.entries[0]?.item).toMatchObject({
      artists: [{ id: 'a', name: 'Band' }],
      albumName: 'Album',
      durationMs: 1000,
      explicit: true,
      isrc: 'GBAAA0000001',
      imageHosts: ['i.scdn.co'],
    });
  });

  it('returns null when there is no items list', () => {
    expect(parseItemsPage({})).toBeNull();
    expect(parseItemsPage(null)).toBeNull();
  });

  it('marks local files from either flag', () => {
    const page = parseItemsPage({
      items: [
        { is_local: true, item: { type: 'track' } },
        { item: { type: 'track', is_local: true } },
      ],
    });
    expect(page?.entries.map((e) => e.isLocal)).toEqual([true, true]);
  });
});
