import { PAGE_SIZE, SEARCH_RESULT_LIMIT, WRITE_BATCH_SIZE } from '../config';
import { BadResponseError, type SpotifyClient } from './client';
import {
  parseItemsPage,
  parsePlaylistPage,
  parseSearchPage,
  parseProfile,
  parseSnapshotId,
  type PlaylistEntry,
  type PlaylistItem,
  type PlaylistSummary,
  type Profile,
} from './types';

/** GET /me: who is logged in. */
export async function getProfile(client: SpotifyClient): Promise<Profile> {
  const profile = parseProfile(await client.get('/me'));
  if (profile === null) throw new BadResponseError('GET /me returned no user id');
  return profile;
}

export interface PlaylistList {
  playlists: PlaylistSummary[];
  /** Entries Spotify returned that could not be read. */
  dropped: number;
}

/** GET /me/playlists, every page. Pages by offset and never follows a `next` URL. */
export async function listPlaylists(client: SpotifyClient): Promise<PlaylistList> {
  const playlists: PlaylistSummary[] = [];
  let dropped = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = parsePlaylistPage(await client.get('/me/playlists', { limit: PAGE_SIZE, offset }));
    if (page === null) throw new BadResponseError('GET /me/playlists returned no items list');
    // A playlist can come back on two pages if the list changes between requests.
    for (const playlist of page.playlists) {
      if (!playlists.some((known) => known.id === playlist.id)) playlists.push(playlist);
    }
    dropped += page.dropped;
    if (!page.hasNext) return { playlists, dropped };
  }
}

export interface ItemsOptions {
  /** Sent only when set. The app sends none by default. */
  market?: string;
  onPage?: (entriesSoFar: number, total: number | null) => void;
}

/** GET /playlists/{id}/items, every page, with no `fields` filter so the raw entry is complete. */
export async function getPlaylistItems(
  client: SpotifyClient,
  playlistId: string,
  options: ItemsOptions = {},
): Promise<PlaylistEntry[]> {
  const path = `/playlists/${encodeURIComponent(playlistId)}/items`;
  const entries: PlaylistEntry[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = parseItemsPage(
      await client.get(path, { limit: PAGE_SIZE, offset, market: options.market }),
    );
    if (page === null) throw new BadResponseError('GET /playlists/{id}/items returned no items');
    entries.push(...page.entries);
    options.onPage?.(entries.length, page.total);
    if (!page.hasNext) return entries;
  }
}

/** GET /search?type=track. One request, at most 10 results, and no `market`. */
export async function searchTracks(client: SpotifyClient, query: string): Promise<PlaylistItem[]> {
  const tracks = parseSearchPage(
    await client.get('/search', { q: query, type: 'track', limit: SEARCH_RESULT_LIMIT }),
  );
  if (tracks === null) throw new BadResponseError('GET /search returned no tracks list');
  return tracks;
}

const itemsPath = (playlistId: string) => `/playlists/${encodeURIComponent(playlistId)}/items`;

/** GET /playlists/{id}?fields=snapshot_id: the playlist's current version. */
export async function getSnapshotId(client: SpotifyClient, playlistId: string): Promise<string> {
  const snapshot = parseSnapshotId(
    await client.get(`/playlists/${encodeURIComponent(playlistId)}`, { fields: 'snapshot_id' }),
  );
  if (snapshot === null) throw new BadResponseError('GET /playlists/{id} returned no snapshot_id');
  return snapshot;
}

/**
 * POST /playlists/{id}/items: inserts the URIs, in order, at a zero-based position.
 * Returns the playlist's new snapshot_id, or null if Spotify sent none (the insert still happened).
 */
export async function insertItems(
  client: SpotifyClient,
  playlistId: string,
  uris: string[],
  position: number,
): Promise<string | null> {
  if (uris.length === 0 || uris.length > WRITE_BATCH_SIZE) {
    throw new RangeError(`An insert takes 1 to ${String(WRITE_BATCH_SIZE)} URIs`);
  }
  return parseSnapshotId(await client.send('POST', itemsPath(playlistId), { uris, position }));
}

/**
 * DELETE /playlists/{id}/items: removes every occurrence of each URI. The endpoint takes
 * URIs only; there is no way to remove by position. Returns the new snapshot_id, or null.
 */
export async function removeItems(
  client: SpotifyClient,
  playlistId: string,
  uris: string[],
  snapshotId: string | null,
): Promise<string | null> {
  if (uris.length === 0 || uris.length > WRITE_BATCH_SIZE) {
    throw new RangeError(`A removal takes 1 to ${String(WRITE_BATCH_SIZE)} URIs`);
  }
  const body: Record<string, unknown> = { items: uris.map((uri) => ({ uri })) };
  if (snapshotId !== null) body.snapshot_id = snapshotId;
  return parseSnapshotId(await client.send('DELETE', itemsPath(playlistId), body));
}
