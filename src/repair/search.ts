import { SEARCH_CONCURRENCY } from '../config';
import {
  coreArtistName,
  normalizeText,
  rankCandidates,
  splitTitle,
  type AlbumType,
  type Candidate,
  type DeadTrack,
  type Match,
} from '../engine';
import type { SpotifyClient } from '../spotify/client';
import { searchTracks } from '../spotify/endpoints';
import type { PlaylistEntry, PlaylistItem } from '../spotify/types';
import { isStopError, type ScanResult } from './scan';

/** Reads a broken track or local file as the engine's plain data. Null when the entry has no item. */
export function deadTrackFromEntry(entry: PlaylistEntry): DeadTrack | null {
  const { item } = entry;
  if (item === null) return null;
  return {
    uri: item.uri ?? '',
    title: item.name ?? '',
    artists: item.artists.map((artist) => artist.name),
    album: item.albumName ?? '',
    durationMs: item.durationMs,
    isrc: item.isrc,
    explicit: item.explicit,
    isLocal: entry.isLocal,
  };
}

function albumType(value: string | null): AlbumType | null {
  return value === 'album' || value === 'single' || value === 'compilation' ? value : null;
}

/**
 * Reads a search result as an engine candidate. A result with no `is_playable`
 * counts as not playable, so the engine never scores it. Null when it has no URI or duration.
 */
export function candidateFromItem(item: PlaylistItem): Candidate | null {
  if (item.uri === null || item.durationMs === null) return null;
  return {
    uri: item.uri,
    title: item.name ?? '',
    artists: item.artists.map((artist) => artist.name),
    album: item.albumName ?? '',
    albumType: albumType(item.albumType),
    durationMs: item.durationMs,
    isrc: item.isrc,
    explicit: item.explicit === true,
    isPlayable: item.isPlayable === true,
  };
}

/**
 * The searches for one track, in the order the plan gives: the ISRC (never for a
 * local file, which has none), then title and artist as filters, then plain text.
 */
export function searchQueries(dead: DeadTrack): string[] {
  const base = splitTitle(dead.title).base;
  if (base === '') return [];
  const artist = normalizeText(dead.artists[0] ?? '');
  // The same recording is often credited to a band on one release and to its leader on another.
  const filterArtist = coreArtistName(dead.artists[0] ?? '');
  const queries: string[] = [];
  const isrc = dead.isrc?.replace(/[^a-z0-9]/gi, '').toUpperCase() ?? '';
  if (!dead.isLocal && isrc !== '') queries.push(`isrc:${isrc}`);
  queries.push(
    filterArtist === '' ? `track:"${base}"` : `track:"${base}" artist:"${filterArtist}"`,
  );
  queries.push(artist === '' ? base : `${base} ${artist}`);
  return queries;
}

/** What a finished search for one track found. */
export interface TrackSearch {
  /** Playable candidates, best first. */
  matches: Match[];
  /** The full search result for each candidate URI, for links and the fixture export. */
  tracks: Record<string, PlaylistItem>;
}

export interface SearchCache {
  /** Search results by query text, shared by every track for the session. */
  queries: Map<string, Promise<PlaylistItem[]>>;
  /** Finished searches by track key. */
  tracks: Map<string, TrackSearch>;
}

export function createSearchCache(): SearchCache {
  return { queries: new Map(), tracks: new Map() };
}

/**
 * A streaming track is searched once however often it appears. A local file has
 * no ID, so it is keyed by artist, title and duration, and one file in several
 * playlists is searched once.
 */
export function trackKey(dead: DeadTrack): string {
  if (!dead.isLocal) return dead.uri;
  const seconds = Math.round((dead.durationMs ?? 0) / 1000);
  return `local|${normalizeText(dead.artists[0] ?? '')}|${splitTitle(dead.title).base}|${String(seconds)}`;
}

export interface FoundCandidates extends TrackSearch {
  /** Requests sent for this track. 0 when everything came from the cache. */
  requests: number;
}

async function cachedSearch(
  client: SpotifyClient,
  cache: SearchCache,
  query: string,
  onSend: () => void,
): Promise<PlaylistItem[]> {
  const existing = cache.queries.get(query);
  if (existing) return existing;
  const pending = searchTracks(client, query);
  cache.queries.set(query, pending);
  onSend();
  try {
    return await pending;
  } catch (error) {
    // A failed search is not remembered, so trying again sends it again.
    cache.queries.delete(query);
    throw error;
  }
}

/**
 * Runs the searches for one track and ranks what they find. It stops as soon as
 * a candidate is Exact. A local file runs the plain-text search only when the
 * first search found nothing at Review or better.
 */
export async function findCandidates(
  client: SpotifyClient,
  dead: DeadTrack,
  cache: SearchCache,
  onSend: () => void = () => undefined,
): Promise<FoundCandidates> {
  const key = trackKey(dead);
  const cached = cache.tracks.get(key);
  if (cached) return { ...cached, requests: 0 };

  let requests = 0;
  const found = new Map<string, PlaylistItem>();
  let matches: Match[] = [];
  const queries = searchQueries(dead);
  for (const [index, query] of queries.entries()) {
    const items = await cachedSearch(client, cache, query, () => {
      requests += 1;
      onSend();
    });
    for (const item of items) if (item.uri !== null) found.set(item.uri, item);
    const candidates = [...found.values()].flatMap((item) => candidateFromItem(item) ?? []);
    matches = rankCandidates(dead, candidates);
    const best = matches[0]?.tier;
    if (best === 'exact') break;
    if (dead.isLocal && index === 0 && (best === 'high' || best === 'review')) break;
  }

  const result: TrackSearch = { matches, tracks: Object.fromEntries(found) };
  cache.tracks.set(key, result);
  return { ...result, requests };
}

export interface FindOptions {
  includeLocal: boolean;
  cache: SearchCache;
}

/** The entries a "Find fixes" run searches for: broken tracks, and local files if asked. */
function wanted(scan: ScanResult, includeLocal: boolean) {
  return scan.entries.flatMap(({ position, entry, status }) => {
    if (status !== 'broken' && !(includeLocal && status === 'local')) return [];
    const dead = deadTrackFromEntry(entry);
    return dead === null || entry.item === null ? [] : [{ position, dead, source: entry.item }];
  });
}

export interface FixEstimate {
  /** The most requests the run can send. Searches already cached are not counted. */
  requests: number;
  /** Tracks that still need searching. */
  tracks: number;
}

export function estimateFindRequests(
  scan: ScanResult,
  options: { includeLocal: boolean },
  cache: SearchCache,
): FixEstimate {
  const seen = new Set<string>();
  const queries = new Set<string>();
  let requests = 0;
  let tracks = 0;
  for (const { dead } of wanted(scan, options.includeLocal)) {
    const key = trackKey(dead);
    if (seen.has(key) || cache.tracks.has(key)) continue;
    seen.add(key);
    tracks += 1;
    for (const query of searchQueries(dead)) {
      if (cache.queries.has(query) || queries.has(query)) continue;
      queries.add(query);
      requests += 1;
    }
  }
  return { requests, tracks };
}

/** One track to review: what is dead, and what could replace it. */
export interface FixRow extends TrackSearch {
  /** Zero-based position in the playlist. */
  position: number;
  dead: DeadTrack;
  /** The dead track as Spotify sent it, for links. */
  source: PlaylistItem;
}

export interface FixRun {
  playlistId: string;
  snapshotId: string | null;
  /** In playlist order. After a stop, only the tracks finished before it. */
  rows: FixRow[];
  /** Requests sent during this run. Tracks answered from the cache cost none. */
  requests: number;
  /** Tracks whose search failed for a reason that does not affect the others, such as a timeout. */
  failed: FailedTrack[];
  /** The error that ended the run early (quota, rate limit, login), or null. */
  stopped: unknown;
}

export interface FailedTrack {
  position: number;
  title: string;
  error: unknown;
}

export interface FindFixesOptions extends FindOptions {
  /** Called after each track with how many are done, how many there are, and requests sent so far. */
  onProgress?: (done: number, total: number, requests: number) => void;
}

/**
 * Searches for replacements a couple of tracks at a time. An error that means no
 * request will work (quota, rate limit, ended login) ends the run. Any other error,
 * such as a timeout, fails that one track and the run carries on. Either way the
 * rows finished so far are returned, and running it again skips them through the cache.
 */
export async function findFixes(
  client: SpotifyClient,
  scan: ScanResult,
  options: FindFixesOptions,
): Promise<FixRun> {
  const todo = wanted(scan, options.includeLocal);
  const rows: FixRow[] = [];
  let requests = 0;
  let next = 0;
  const failed: FailedTrack[] = [];
  let stopped: unknown = null;

  async function worker(): Promise<void> {
    while (stopped === null) {
      const job = todo[next++];
      if (job === undefined) return;
      try {
        const found = await findCandidates(client, job.dead, options.cache, () => {
          requests += 1;
        });
        rows.push({
          position: job.position,
          dead: job.dead,
          source: job.source,
          matches: found.matches,
          tracks: found.tracks,
        });
        options.onProgress?.(rows.length, todo.length, requests);
      } catch (error) {
        if (isStopError(error)) stopped ??= error;
        else failed.push({ position: job.position, title: job.dead.title, error });
      }
    }
  }

  await Promise.all(Array.from({ length: SEARCH_CONCURRENCY }, worker));
  rows.sort((a, b) => a.position - b.position);
  failed.sort((a, b) => a.position - b.position);
  return {
    playlistId: scan.playlistId,
    snapshotId: scan.snapshotId,
    rows,
    requests,
    failed,
    stopped,
  };
}
