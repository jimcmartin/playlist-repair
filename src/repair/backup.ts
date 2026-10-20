import type { ScanResult } from './scan';

export interface BackupTrack {
  position: number;
  uri: string | null;
  title: string | null;
  artists: string[];
  album: string | null;
  addedAt: string | null;
  isLocal: boolean;
}

/** A playlist as it was scanned. It holds no login, token or client ID. */
export interface Backup {
  app: 'Playlist Repair';
  format: 1;
  savedAt: string;
  playlist: { id: string; name: string; snapshotId: string | null };
  tracks: BackupTrack[];
}

export function buildBackup(playlistName: string, scan: ScanResult, now: Date): Backup {
  return {
    app: 'Playlist Repair',
    format: 1,
    savedAt: now.toISOString(),
    playlist: { id: scan.playlistId, name: playlistName, snapshotId: scan.snapshotId },
    tracks: scan.entries.map(({ position, entry }) => ({
      position,
      uri: entry.item?.uri ?? null,
      title: entry.item?.name ?? null,
      artists: entry.item?.artists.map((artist) => artist.name) ?? [],
      album: entry.item?.albumName ?? null,
      addedAt: entry.addedAt,
      isLocal: entry.isLocal,
    })),
  };
}

/** A name safe on every file system, such as `playlist-repair-Road-Trip-2026-10-19.json`. */
export function backupFileName(playlistName: string, now: Date): string {
  const safe = playlistName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `playlist-repair-${safe === '' ? 'playlist' : safe}-${now.toISOString().slice(0, 10)}.json`;
}
