import { PAGE_SIZE, SEARCH_RESULT_LIMIT } from '../config';
import { BadResponseError, type SpotifyClient } from './client';
import {
  parseItemsPage,
  parsePlaylistPage,
  parseSearchPage,
  parseProfile,
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
