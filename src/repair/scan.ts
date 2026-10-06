import { PAGE_SIZE, SCAN_ALL_CONCURRENCY } from '../config';
import { QuotaExceededError, RateLimitedError, type SpotifyClient } from '../spotify/client';
import { AuthError } from '../spotify/auth';
import { getPlaylistItems } from '../spotify/endpoints';
import type { PlaylistEntry, PlaylistSummary } from '../spotify/types';

/** How one playlist entry is treated. Only `broken` is repaired. */
export type EntryStatus =
  | 'ok'
  | 'broken'
  /** Hidden by the user's explicit-content setting. */
  | 'explicit'
  /** Not available on the user's plan. */
  | 'product'
  /** A restriction reason the plan does not list. Shown, never repaired. */
  | 'other-restriction'
  /** Spotify returned no item: removed, with nothing left to match. */
  | 'removed'
  | 'local'
  | 'episode'
  /** `is_playable` was missing, so the entry cannot be called either way. */
  | 'unknown';

export type StatusCounts = Record<EntryStatus, number>;

/** Applies the rules in the plan's "Detecting broken tracks". */
export function classifyEntry(entry: PlaylistEntry): EntryStatus {
  if (entry.isLocal) return 'local';
  const { item } = entry;
  if (item === null) return 'removed';
  if (item.type !== 'track') return 'episode';
  if (item.isPlayable === null) return 'unknown';
  if (item.isPlayable) return 'ok';
  switch (item.restrictionReason) {
    case null:
    case 'market':
      return 'broken';
    case 'explicit':
      return 'explicit';
    case 'product':
      return 'product';
    default:
      return 'other-restriction';
  }
}

export function emptyCounts(): StatusCounts {
  return {
    ok: 0,
    broken: 0,
    explicit: 0,
    product: 0,
    'other-restriction': 0,
    removed: 0,
    local: 0,
    episode: 0,
    unknown: 0,
  };
}

export interface ScannedEntry {
  /** Zero-based position in the playlist. */
  position: number;
  entry: PlaylistEntry;
  status: EntryStatus;
}

export interface ScanResult {
  playlistId: string;
  /** The version the scan read, which Apply checks again before writing. */
  snapshotId: string | null;
  entries: ScannedEntry[];
  counts: StatusCounts;
}

export interface ScanOptions {
  /** Sent only by the development panel. */
  market?: string;
  onPage?: (entriesSoFar: number, total: number | null) => void;
}

export async function scanPlaylist(
  client: SpotifyClient,
  playlist: PlaylistSummary,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const raw = await getPlaylistItems(client, playlist.id, options);
  const counts = emptyCounts();
  const entries = raw.map((entry, position): ScannedEntry => {
    const status = classifyEntry(entry);
    counts[status] += 1;
    return { position, entry, status };
  });
  return { playlistId: playlist.id, snapshotId: playlist.snapshotId, entries, counts };
}

export interface VisiblePlaylists {
  playlists: PlaylistSummary[];
  /** Playlists left out because the user neither owns nor collaborates on them. */
  hidden: number;
}

/** Spotify only returns the contents of playlists the user owns or collaborates on. */
export function visiblePlaylists(all: PlaylistSummary[], profileId: string): VisiblePlaylists {
  const playlists = all.filter((p) => p.ownerId === profileId || p.collaborative);
  return { playlists, hidden: all.length - playlists.length };
}

/** Errors that mean no further request will work, so a bulk scan stops. */
export function isStopError(error: unknown): boolean {
  return (
    error instanceof QuotaExceededError ||
    error instanceof RateLimitedError ||
    (error instanceof AuthError &&
      (error.code === 'session-expired' || error.code === 'not-logged-in'))
  );
}

export interface ScanAllOptions {
  /** Playlist IDs that already have a result. */
  skip?: ReadonlySet<string>;
  onResult: (playlist: PlaylistSummary, result: ScanResult) => void;
  /** A failure of one playlist. The run carries on unless it is a stop error. */
  onError: (playlist: PlaylistSummary, error: unknown) => void;
  onStart?: (playlist: PlaylistSummary) => void;
}

/**
 * Scans playlists a few at a time. Results already delivered are kept when the
 * run stops. Returns the stop error if one ended the run early, else null.
 */
export async function scanAll(
  client: SpotifyClient,
  playlists: PlaylistSummary[],
  options: ScanAllOptions,
): Promise<unknown> {
  const todo = playlists.filter((p) => !options.skip?.has(p.id));
  let next = 0;
  let stopped: unknown = null;

  async function worker(): Promise<void> {
    while (stopped === null) {
      const playlist = todo[next++];
      if (playlist === undefined) return;
      options.onStart?.(playlist);
      try {
        options.onResult(playlist, await scanPlaylist(client, playlist));
      } catch (error) {
        options.onError(playlist, error);
        if (isStopError(error)) stopped ??= error;
      }
    }
  }

  await Promise.all(Array.from({ length: SCAN_ALL_CONCURRENCY }, worker));
  return stopped;
}

export interface ScanEstimate {
  requests: number;
  /** False when a playlist had no track count, so `requests` is a minimum. */
  exact: boolean;
}

/** How many requests scanning these playlists takes: one per page of 50, and at least one each. */
export function estimateScanRequests(
  playlists: PlaylistSummary[],
  skip: ReadonlySet<string> = new Set(),
): ScanEstimate {
  let requests = 0;
  let exact = true;
  for (const playlist of playlists) {
    if (skip.has(playlist.id)) continue;
    if (playlist.total === null) exact = false;
    requests += Math.max(1, Math.ceil((playlist.total ?? 0) / PAGE_SIZE));
  }
  return { requests, exact };
}
