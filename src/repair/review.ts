import type { Tier } from '../engine';
import type { Match } from '../engine';
import type { FixRow } from './search';

/** The user's choice for one row. */
export interface RowChoice {
  /** The candidate that would replace the dead track, or null when there is none. */
  candidateUri: string | null;
  selected: boolean;
}

/** By the row's position in the playlist. */
export type Selection = Record<number, RowChoice>;

export type Groups = Record<Tier, FixRow[]>;

/** Rows grouped by the tier of their best match, in playlist order. Rows with no match are None. */
export function groupRows(rows: FixRow[]): Groups {
  const groups: Groups = { exact: [], high: [], review: [], none: [] };
  for (const row of rows) groups[row.matches[0]?.tier ?? 'none'].push(row);
  return groups;
}

/**
 * Exact and High matches start selected. The engine marks a local file's match as
 * not selected, and that is kept: local files are only ever selected by the user.
 */
export function initialSelection(rows: FixRow[]): Selection {
  const selection: Selection = {};
  for (const row of rows) {
    const best = row.matches[0];
    selection[row.position] = {
      candidateUri: best?.candidate.uri ?? null,
      selected: best?.selected ?? false,
    };
  }
  return selection;
}

export function chosenMatch(row: FixRow, choice: RowChoice): Match | null {
  return row.matches.find((m) => m.candidate.uri === choice.candidateUri) ?? null;
}

export function setRowSelected(
  selection: Selection,
  position: number,
  selected: boolean,
): Selection {
  const choice = selection[position];
  if (!choice?.candidateUri) return selection;
  return { ...selection, [position]: { ...choice, selected } };
}

/** Switches the replacement for a row, and selects it, since the user picked it. */
export function chooseCandidate(selection: Selection, row: FixRow, uri: string): Selection {
  if (!row.matches.some((m) => m.candidate.uri === uri)) return selection;
  return { ...selection, [row.position]: { candidateUri: uri, selected: true } };
}

/** Selects or clears every row in a group that has a candidate. */
export function selectGroup(selection: Selection, rows: FixRow[], selected: boolean): Selection {
  return rows.reduce((current, row) => setRowSelected(current, row.position, selected), selection);
}

/** How many of a group's rows can be selected at all, and how many are. */
export function groupState(selection: Selection, rows: FixRow[]): 'all' | 'some' | 'none' {
  const choosable = rows.filter((row) => selection[row.position]?.candidateUri);
  const selected = choosable.filter((row) => selection[row.position]?.selected).length;
  if (selected === 0) return 'none';
  return selected === choosable.length ? 'all' : 'some';
}

export function selectedCount(selection: Selection): number {
  return Object.values(selection).filter((choice) => choice.selected).length;
}
