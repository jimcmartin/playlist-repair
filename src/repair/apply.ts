import { WRITE_BATCH_SIZE } from '../config';
import type { SpotifyClient } from '../spotify/client';
import { getPlaylistItems, getSnapshotId, insertItems, removeItems } from '../spotify/endpoints';
import type { PlaylistEntry } from '../spotify/types';
import type { Selection } from './review';
import { isStopError, type ScanResult } from './scan';
import type { FixRow } from './search';

/** Why a track is in the plan. */
export type ChangeNote = 'replace' | 'already-present' | 'remove-anyway';

/** What happens at one playlist position. */
export interface PlannedChange {
  /** Zero-based position in the playlist as scanned. */
  position: number;
  deadUri: string;
  isLocal: boolean;
  title: string;
  artists: string[];
  /** The URI to insert, or null when the dead track is only removed. */
  replacementUri: string | null;
  note: ChangeNote;
}

export interface InsertStep {
  /** Where the URIs go, counted in the playlist as it is when this step runs. */
  position: number;
  uris: string[];
}

export interface RemovalStep {
  uris: string[];
  /** Local files are removed apart from the rest, because Spotify may refuse them. */
  local: boolean;
}

export interface ApplyPlan {
  playlistId: string;
  /** The version the scan read. */
  snapshotId: string | null;
  /** The playlist's URIs as scanned. Null for an entry with no item. */
  originalUris: (string | null)[];
  changes: PlannedChange[];
  /** In the order they run: bottom of the playlist first. */
  inserts: InsertStep[];
  removals: RemovalStep[];
  /** For each change, the index in `inserts` that adds its replacement, or -1 if it has none. */
  insertOf: number[];
  /** For each change, the index in `removals` that removes its dead track. */
  removalOf: number[];
}

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += WRITE_BATCH_SIZE) {
    chunks.push(items.slice(i, i + WRITE_BATCH_SIZE));
  }
  return chunks;
}

/**
 * Turns the user's decisions into the writes to send. Removing a URI removes every
 * occurrence of it, so a dead track that appears several times is always handled
 * everywhere: each occurrence gets the replacement chosen for it.
 */
export function buildApplyPlan(
  scan: ScanResult,
  rows: FixRow[],
  selection: Selection,
  removeAnyway: ReadonlySet<number> = new Set(),
): ApplyPlan {
  const originalUris = scan.entries.map(({ entry }) => entry.item?.uri ?? null);
  const present = new Set(originalUris.filter((uri) => uri !== null));

  // What was decided for each dead URI, from its first row that has a decision.
  const intents = new Map<string, string | null>();
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const choice = selection[row.position];
    const uri = row.dead.uri;
    if (uri === '' || intents.has(uri)) continue;
    if (choice?.selected === true && choice.candidateUri !== null) {
      intents.set(uri, choice.candidateUri);
    } else if (removeAnyway.has(row.position)) {
      intents.set(uri, null);
    }
  }

  const changes: PlannedChange[] = [];
  for (const { position, entry, status } of scan.entries) {
    const item = entry.item;
    const deadUri = item?.uri ?? null;
    if (item === null || deadUri === null || !intents.has(deadUri)) continue;
    if (status !== 'broken' && status !== 'local') continue;
    const wanted = intents.get(deadUri) ?? null;
    const replacementUri = wanted !== null && !present.has(wanted) ? wanted : null;
    changes.push({
      position,
      deadUri,
      isLocal: entry.isLocal,
      title: item.name ?? deadUri,
      artists: item.artists.map((artist) => artist.name),
      replacementUri,
      note:
        wanted === null ? 'remove-anyway' : replacementUri === null ? 'already-present' : 'replace',
    });
  }

  // Runs of neighboring replacements share a call. Working from the bottom up keeps
  // the positions above each insert unchanged, so every position is still the scanned one.
  const replaced = changes.filter((change) => change.replacementUri !== null);
  const groups: PlannedChange[][] = [];
  for (const change of replaced) {
    const last = groups[groups.length - 1];
    if (last && (last[last.length - 1]?.position ?? -2) + 1 === change.position) last.push(change);
    else groups.push([change]);
  }
  const inserts: InsertStep[] = [];
  const insertAt = new Map<PlannedChange, number>();
  for (const group of groups.reverse()) {
    const start = group[0]?.position ?? 0;
    const uris = group.flatMap((change) => change.replacementUri ?? []);
    const parts = chunk(uris).reverse();
    const base = inserts.length;
    group.forEach((change, k) => {
      // Later chunks go in first, so chunk j of n is step n - 1 - j.
      insertAt.set(change, base + parts.length - 1 - Math.floor(k / WRITE_BATCH_SIZE));
    });
    // All at the start, so the earlier ones end up above the later ones.
    for (const part of parts) inserts.push({ position: start, uris: part });
  }

  const removal = (local: boolean): RemovalStep[] => {
    const uris = [
      ...new Set(changes.filter((change) => change.isLocal === local).map((c) => c.deadUri)),
    ];
    return chunk(uris).map((part) => ({ uris: part, local }));
  };

  const removals = [...removal(false), ...removal(true)];
  return {
    playlistId: scan.playlistId,
    snapshotId: scan.snapshotId,
    originalUris,
    changes,
    inserts,
    removals,
    insertOf: changes.map((change) => insertAt.get(change) ?? -1),
    removalOf: changes.map((change) =>
      removals.findIndex((step) => step.uris.includes(change.deadUri)),
    ),
  };
}

// --- Running the plan ---------------------------------------------------------

export type StepStatus = 'pending' | 'done' | 'failed';

/** Progress kept in memory, so Resume carries on instead of starting over. */
export interface ApplyState {
  /** True once the version was checked. It is never checked again, since the writes change it. */
  checked: boolean;
  /** The newest version Spotify has told us about. */
  snapshotId: string | null;
  inserts: StepStatus[];
  removals: StepStatus[];
  /** Local files Spotify would not remove. */
  rejectedLocal: string[];
}

export function createApplyState(plan: ApplyPlan): ApplyState {
  return {
    checked: false,
    snapshotId: plan.snapshotId,
    inserts: plan.inserts.map(() => 'pending'),
    removals: plan.removals.map(() => 'pending'),
    rejectedLocal: [],
  };
}

export interface TrackRef {
  title: string;
  artists: string[];
}

export interface Verification {
  /** The playlist as it is now. */
  entries: PlaylistEntry[];
  snapshotId: string | null;
  /** Replacements found in the playlist. */
  replaced: number;
  /** Tracks that were only removed. */
  removedOnly: number;
  /** Replacements that are not in the playlist. */
  missing: TrackRef[];
  /** Dead tracks that are still in the playlist, apart from local files. */
  deadLeft: TrackRef[];
  /** Local files Spotify did not remove, which the user must delete by hand. */
  localLeft: TrackRef[];
  /** The playlist is exactly the scanned one with the planned changes. */
  orderOk: boolean;
}

export type ApplyOutcome =
  /** The playlist changed since the scan. Nothing was written. */
  | { kind: 'stale'; currentSnapshotId: string }
  | { kind: 'stopped'; phase: 'check' | 'insert' | 'remove' | 'verify'; error: unknown }
  | { kind: 'done'; verification: Verification };

export interface ApplyHooks {
  /** Called whenever the state changes, for progress display. */
  onProgress?: () => void;
}

/** True when an insert already happened: its URIs sit at its position. */
function insertLanded(items: PlaylistEntry[], step: InsertStep): boolean {
  return step.uris.every((uri, i) => items[step.position + i]?.item?.uri === uri);
}

/**
 * The playlist as it should be after the plan: each replacement where its dead track was,
 * and every dead track gone. A local file Spotify would not remove stays, after the
 * replacements that were inserted in the same run of neighbors.
 */
export function expectedUris(
  plan: ApplyPlan,
  actual: ReadonlySet<string | null>,
): (string | null)[] {
  const byPosition = new Map(plan.changes.map((change) => [change.position, change]));
  const keptLocal = (change: PlannedChange) => change.isLocal && actual.has(change.deadUri);
  const expected: (string | null)[] = [];
  let position = 0;
  while (position < plan.originalUris.length) {
    const change = byPosition.get(position);
    if (change === undefined) {
      expected.push(plan.originalUris[position] ?? null);
      position += 1;
    } else if (change.replacementUri === null) {
      if (keptLocal(change)) expected.push(change.deadUri);
      position += 1;
    } else {
      // Neighbors with replacements went in together, so their kept files follow them all.
      const run: PlannedChange[] = [];
      for (let next = byPosition.get(position); next?.replacementUri != null;) {
        run.push(next);
        next = byPosition.get(next.position + 1);
      }
      for (const member of run) expected.push(member.replacementUri);
      for (const member of run) if (keptLocal(member)) expected.push(member.deadUri);
      position += run.length;
    }
  }
  return expected;
}

function verify(
  plan: ApplyPlan,
  entries: PlaylistEntry[],
  snapshotId: string | null,
): Verification {
  const actualList = entries.map((entry) => entry.item?.uri ?? null);
  const actual = new Set(actualList);
  const ref = (change: PlannedChange): TrackRef => ({
    title: change.title,
    artists: change.artists,
  });
  const seen = new Set<string>();
  const distinct = (changes: PlannedChange[]) =>
    changes.filter((change) => !seen.has(change.deadUri) && seen.add(change.deadUri));

  const expected = expectedUris(plan, actual);
  return {
    entries,
    snapshotId,
    replaced: plan.changes.filter((c) => c.replacementUri !== null && actual.has(c.replacementUri))
      .length,
    removedOnly: plan.changes.filter((c) => c.replacementUri === null).length,
    missing: plan.changes
      .filter((c) => c.replacementUri !== null && !actual.has(c.replacementUri))
      .map(ref),
    deadLeft: distinct(plan.changes.filter((c) => !c.isLocal && actual.has(c.deadUri))).map(ref),
    localLeft: distinct(plan.changes.filter((c) => c.isLocal && actual.has(c.deadUri))).map(ref),
    orderOk:
      expected.length === actualList.length && expected.every((uri, i) => uri === actualList[i]),
  };
}

/**
 * Runs the plan: check the version, insert, remove, verify. Every insert finishes
 * before the first removal, so a failure leaves extra tracks and never missing ones.
 * It stops at the first error and keeps `state`; calling it again resumes from there.
 */
export async function applyRepair(
  client: SpotifyClient,
  plan: ApplyPlan,
  state: ApplyState,
  hooks: ApplyHooks = {},
): Promise<ApplyOutcome> {
  const changed = () => hooks.onProgress?.();

  if (!state.checked) {
    try {
      const current = await getSnapshotId(client, plan.playlistId);
      if (plan.snapshotId !== null && current !== plan.snapshotId) {
        return { kind: 'stale', currentSnapshotId: current };
      }
    } catch (error) {
      return { kind: 'stopped', phase: 'check', error };
    }
    state.checked = true;
  }

  // A failed insert may still have gone through, if only the reply was lost. Look first.
  if (state.inserts.includes('failed')) {
    try {
      const items = await getPlaylistItems(client, plan.playlistId);
      plan.inserts.forEach((step, i) => {
        if (state.inserts[i] === 'failed' && insertLanded(items, step)) state.inserts[i] = 'done';
      });
      changed();
    } catch (error) {
      return { kind: 'stopped', phase: 'insert', error };
    }
  }

  for (const [i, step] of plan.inserts.entries()) {
    if (state.inserts[i] === 'done') continue;
    try {
      const snapshot = await insertItems(client, plan.playlistId, step.uris, step.position);
      state.snapshotId = snapshot ?? state.snapshotId;
      state.inserts[i] = 'done';
      changed();
    } catch (error) {
      state.inserts[i] = 'failed';
      changed();
      return { kind: 'stopped', phase: 'insert', error };
    }
  }

  // Past this point every insert is done.
  for (const [i, step] of plan.removals.entries()) {
    if (state.removals[i] === 'done') continue;
    try {
      const snapshot = await removeItems(client, plan.playlistId, step.uris, state.snapshotId);
      state.snapshotId = snapshot ?? state.snapshotId;
    } catch (error) {
      if (isStopError(error) || !step.local) {
        state.removals[i] = 'failed';
        changed();
        return { kind: 'stopped', phase: 'remove', error };
      }
      // Spotify may refuse a local file. Try them one by one, so one bad file hides no other.
      for (const uri of step.uris) {
        try {
          state.snapshotId =
            (await removeItems(client, plan.playlistId, [uri], state.snapshotId)) ??
            state.snapshotId;
        } catch (single) {
          if (isStopError(single)) {
            state.removals[i] = 'failed';
            changed();
            return { kind: 'stopped', phase: 'remove', error: single };
          }
          if (!state.rejectedLocal.includes(uri)) state.rejectedLocal.push(uri);
        }
      }
    }
    state.removals[i] = 'done';
    changed();
  }

  try {
    const entries = await getPlaylistItems(client, plan.playlistId);
    const snapshotId = state.snapshotId ?? (await getSnapshotId(client, plan.playlistId));
    return { kind: 'done', verification: verify(plan, entries, snapshotId) };
  } catch (error) {
    return { kind: 'stopped', phase: 'verify', error };
  }
}

export type ChangeProgress = 'waiting' | 'added' | 'done' | 'failed';

/** Where each change stands, for the progress list. `done` means the dead track is gone too. */
export function changeProgress(plan: ApplyPlan, state: ApplyState): ChangeProgress[] {
  return plan.changes.map((_, i) => {
    const insert = state.inserts[plan.insertOf[i] ?? -1];
    const removal = state.removals[plan.removalOf[i] ?? -1];
    if (insert === 'failed' || removal === 'failed') return 'failed';
    if (removal === 'done') return 'done';
    return insert === 'done' ? 'added' : 'waiting';
  });
}
