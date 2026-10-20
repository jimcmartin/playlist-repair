import type { Selection } from './review';
import type { ScanResult } from './scan';
import type { FixRow, FixRun } from './search';

export interface Rebased {
  run: FixRun;
  selection: Selection;
  /** Rows whose track is no longer in the playlist. */
  dropped: number;
  /** Broken tracks in the playlist now that no row covers, such as ones added since. */
  unsearched: number;
}

/**
 * After the playlist changed under the user, carries their decisions over to a fresh scan.
 * Rows are matched by track URI, in order, so a track listed twice keeps both choices.
 */
export function rebaseRun(run: FixRun, selection: Selection, scan: ScanResult): Rebased {
  const positionsByUri = new Map<string, number[]>();
  for (const { position, entry, status } of scan.entries) {
    const uri = entry.item?.uri;
    if (uri == null || (status !== 'broken' && status !== 'local')) continue;
    positionsByUri.set(uri, [...(positionsByUri.get(uri) ?? []), position]);
  }

  const rows: FixRow[] = [];
  const next: Selection = {};
  let dropped = 0;
  for (const row of [...run.rows].sort((a, b) => a.position - b.position)) {
    const position = positionsByUri.get(row.dead.uri)?.shift();
    if (position === undefined) {
      dropped += 1;
      continue;
    }
    rows.push({ ...row, position });
    const choice = selection[row.position];
    if (choice) next[position] = choice;
  }
  const covered = new Set(rows.map((row) => row.dead.uri));
  const unsearched = [...positionsByUri.entries()]
    .filter(([uri]) => !covered.has(uri))
    .reduce((sum, [, positions]) => sum + positions.length, 0);

  return {
    run: { ...run, snapshotId: scan.snapshotId, rows },
    selection: next,
    dropped,
    unsearched,
  };
}
