import { describe, expect, it } from 'vitest';
import { backupFileName, buildBackup } from '../../src/repair/backup';
import { rebaseRun } from '../../src/repair/rebase';
import { buildScanResult } from '../../src/repair/scan';
import type { FixRow, FixRun } from '../../src/repair/search';
import { parseItemsPage } from '../../src/spotify/types';

const raw = (uri: string, extra: Record<string, unknown> = {}) => ({
  added_at: '2025-03-04T05:06:07Z',
  is_local: uri.startsWith('spotify:local:'),
  item: {
    type: 'track',
    uri,
    name: `Name ${uri}`,
    artists: [{ id: 'a', name: 'Artist' }],
    album: { id: 'al', name: 'Album' },
    is_playable: !uri.includes('dead'),
    ...extra,
  },
});

const scanOf = (uris: string[], snapshotId = 's1') =>
  buildScanResult(
    'p',
    snapshotId,
    parseItemsPage({ items: uris.map((u) => raw(u)) })?.entries ?? [],
  );

describe('buildBackup', () => {
  const now = new Date('2026-10-19T12:00:00Z');

  it('keeps position, URI, title, artists, album and date added for every entry', () => {
    const backup = buildBackup(
      'Road Trip',
      scanOf(['spotify:track:a', 'spotify:track:dead1']),
      now,
    );
    expect(backup.tracks).toEqual([
      {
        position: 0,
        uri: 'spotify:track:a',
        title: 'Name spotify:track:a',
        artists: ['Artist'],
        album: 'Album',
        addedAt: '2025-03-04T05:06:07Z',
        isLocal: false,
      },
      expect.objectContaining({ position: 1, uri: 'spotify:track:dead1' }),
    ]);
    expect(backup.playlist).toEqual({ id: 'p', name: 'Road Trip', snapshotId: 's1' });
    expect(backup.savedAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('holds nothing that looks like a login', () => {
    const text = JSON.stringify(buildBackup('x', scanOf(['spotify:track:a']), now));
    expect(text).not.toMatch(/token|secret|client|verifier|authorization/i);
  });

  it('names the file safely', () => {
    expect(backupFileName('Road Trip / 80s: "Best"', now)).toBe(
      'playlist-repair-Road-Trip-80s-Best-2026-10-19.json',
    );
    expect(backupFileName('🎵', now)).toBe('playlist-repair-playlist-2026-10-19.json');
  });
});

describe('rebaseRun', () => {
  const row = (position: number, uri: string): FixRow => ({
    position,
    dead: {
      uri,
      title: uri,
      artists: [],
      album: '',
      durationMs: null,
      isrc: null,
      explicit: null,
      isLocal: false,
    },
    source: parseItemsPage({ items: [raw(uri)] })?.entries[0]?.item as never,
    matches: [],
    tracks: {},
  });
  const run: FixRun = {
    playlistId: 'p',
    snapshotId: 's1',
    rows: [
      row(1, 'spotify:track:dead1'),
      row(3, 'spotify:track:dead2'),
      row(4, 'spotify:track:dead1'),
    ],
    requests: 0,
    failed: [],
    stopped: null,
  };
  const selection = {
    1: { candidateUri: 'u1', selected: true },
    3: { candidateUri: 'u2', selected: false },
    4: { candidateUri: 'u1', selected: true },
  };

  it('moves choices to the new positions, in order', () => {
    const scan = scanOf(
      ['spotify:track:new', 'spotify:track:dead1', 'spotify:track:dead2', 'spotify:track:dead1'],
      's2',
    );
    const rebased = rebaseRun(run, selection, scan);
    expect(rebased.run.rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(rebased.run.snapshotId).toBe('s2');
    expect(rebased.selection).toEqual({
      1: selection[1],
      2: selection[3],
      3: selection[4],
    });
    expect(rebased.dropped).toBe(0);
  });

  it('drops rows whose track is gone and counts new broken tracks', () => {
    const scan = scanOf(['spotify:track:dead1', 'spotify:track:dead9'], 's2');
    const rebased = rebaseRun(run, selection, scan);
    expect(rebased.run.rows.map((r) => r.dead.uri)).toEqual(['spotify:track:dead1']);
    expect(rebased.dropped).toBe(2);
    expect(rebased.unsearched).toBe(1);
  });
});
