export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface Profile {
  id: string;
  displayName: string;
}

/** Reads the fields the app uses from a GET /me response, or null if they are missing. */
export function parseProfile(json: unknown): Profile | null {
  if (!isRecord(json) || typeof json.id !== 'string') return null;
  // display_name is null for accounts that never set one.
  const name = typeof json.display_name === 'string' ? json.display_name.trim() : '';
  return { id: json.id, displayName: name === '' ? json.id : name };
}

// --- Playlists ---------------------------------------------------------------

export interface PlaylistSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  collaborative: boolean;
  snapshotId: string | null;
  /** Null when Spotify gave no track count. */
  total: number | null;
  /** Host names of the cover images, for the Content Security Policy question. */
  imageHosts: string[];
}

export interface PlaylistPage {
  playlists: PlaylistSummary[];
  /** Entries that could not be read and were left out. */
  dropped: number;
  hasNext: boolean;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function imageHosts(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const hosts: string[] = [];
  for (const image of images as unknown[]) {
    const url = isRecord(image) ? readString(image.url) : null;
    if (url === null) continue;
    try {
      hosts.push(new URL(url).host);
    } catch {
      // Not a URL: nothing to report.
    }
  }
  return hosts;
}

function parsePlaylistSummary(json: unknown): PlaylistSummary | null {
  if (!isRecord(json) || typeof json.id !== 'string') return null;
  const owner = isRecord(json.owner) ? json.owner : null;
  const ownerId = owner ? readString(owner.id) : null;
  if (ownerId === null) return null;

  // The track count sits under `items` now and under `tracks` in older replies.
  const counts = [json.items, json.tracks].find(
    (value) => isRecord(value) && typeof value.total === 'number',
  );
  const total = isRecord(counts) && typeof counts.total === 'number' ? counts.total : null;

  const ownerName = owner ? readString(owner.display_name) : null;
  return {
    id: json.id,
    name: readString(json.name) ?? '(untitled)',
    ownerId,
    ownerName: ownerName === null || ownerName.trim() === '' ? ownerId : ownerName,
    collaborative: json.collaborative === true,
    snapshotId: readString(json.snapshot_id),
    total,
    imageHosts: imageHosts(json.images),
  };
}

/** Reads a GET /me/playlists page, or returns null if it has no `items` array. */
export function parsePlaylistPage(json: unknown): PlaylistPage | null {
  if (!isRecord(json) || !Array.isArray(json.items)) return null;
  const playlists: PlaylistSummary[] = [];
  let dropped = 0;
  for (const raw of json.items as unknown[]) {
    const playlist = parsePlaylistSummary(raw);
    if (playlist) playlists.push(playlist);
    else dropped += 1;
  }
  return { playlists, dropped, hasNext: typeof json.next === 'string' };
}

// --- Playlist items ----------------------------------------------------------

export interface TrackArtist {
  id: string | null;
  name: string;
}

/** What the app reads from a playlist entry's `item`. Only `type` is required. */
export interface PlaylistItem {
  /** `track`, `episode`, or whatever Spotify sent. */
  type: string;
  id: string | null;
  uri: string | null;
  name: string | null;
  artists: TrackArtist[];
  albumName: string | null;
  durationMs: number | null;
  explicit: boolean | null;
  isrc: string | null;
  /** Null when Spotify left the field out, which is different from false. */
  isPlayable: boolean | null;
  /** Null when there is no `restrictions` object or it has no reason. */
  restrictionReason: string | null;
  imageHosts: string[];
}

export interface PlaylistEntry {
  addedAt: string | null;
  isLocal: boolean;
  /** Null when Spotify returned an entry with no item, as for a removed track. */
  item: PlaylistItem | null;
  /** The entry exactly as Spotify sent it, for the development panel. */
  raw: unknown;
}

export interface ItemsPage {
  entries: PlaylistEntry[];
  total: number | null;
  hasNext: boolean;
}

function parseArtists(value: unknown): TrackArtist[] {
  if (!Array.isArray(value)) return [];
  const artists: TrackArtist[] = [];
  for (const artist of value as unknown[]) {
    if (isRecord(artist) && typeof artist.name === 'string') {
      artists.push({ id: readString(artist.id), name: artist.name });
    }
  }
  return artists;
}

function parseItem(json: unknown): PlaylistItem | null {
  if (!isRecord(json) || typeof json.type !== 'string') return null;
  const album = isRecord(json.album) ? json.album : null;
  const externalIds = isRecord(json.external_ids) ? json.external_ids : null;
  const restrictions = isRecord(json.restrictions) ? json.restrictions : null;
  return {
    type: json.type,
    id: readString(json.id),
    uri: readString(json.uri),
    name: readString(json.name),
    artists: parseArtists(json.artists),
    albumName: album ? readString(album.name) : null,
    durationMs: typeof json.duration_ms === 'number' ? json.duration_ms : null,
    explicit: typeof json.explicit === 'boolean' ? json.explicit : null,
    isrc: externalIds ? readString(externalIds.isrc) : null,
    isPlayable: typeof json.is_playable === 'boolean' ? json.is_playable : null,
    restrictionReason: restrictions ? readString(restrictions.reason) : null,
    imageHosts: album ? imageHosts(album.images) : [],
  };
}

/**
 * Reads one entry. `item` is the current field and `track` the deprecated one;
 * an entry with neither, or with a null, has no item. Returns null only when
 * the entry is not an object at all.
 */
function parseEntry(raw: unknown): PlaylistEntry | null {
  if (!isRecord(raw)) return null;
  const itemJson = raw.item ?? raw.track ?? null;
  return {
    addedAt: readString(raw.added_at),
    isLocal: raw.is_local === true || (isRecord(itemJson) && itemJson.is_local === true),
    item: parseItem(itemJson),
    raw,
  };
}

/** Reads a GET /playlists/{id}/items page, or returns null if it has no `items` array. */
export function parseItemsPage(json: unknown): ItemsPage | null {
  if (!isRecord(json) || !Array.isArray(json.items)) return null;
  const entries: PlaylistEntry[] = [];
  for (const raw of json.items as unknown[]) {
    // A malformed entry still takes up a position, so it becomes an entry with no item.
    entries.push(parseEntry(raw) ?? { addedAt: null, isLocal: false, item: null, raw });
  }
  return {
    entries,
    total: typeof json.total === 'number' ? json.total : null,
    hasNext: typeof json.next === 'string',
  };
}
