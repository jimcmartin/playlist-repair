import { describe, expect, it } from 'vitest';
import type { Match, Tier } from '../../src/engine';
import type { FixRow } from '../../src/repair/search';
import {
  chooseCandidate,
  chosenMatch,
  groupRows,
  groupState,
  initialSelection,
  selectedCount,
  selectGroup,
  setRowSelected,
} from '../../src/repair/review';
import { must } from '../helpers/must';
import { candidate, dead } from '../helpers/engine';

function match(uri: string, tier: Tier, selected = tier === 'exact' || tier === 'high'): Match {
  return {
    candidate: candidate({ uri }),
    score: 1,
    parts: { title: 1, artists: 1, duration: 1, album: 1 },
    tier,
    selected,
    capped: [],
    differences: {
      durationDiffMs: 0,
      sameAlbum: true,
      explicitDiffers: false,
      markersOnlyOnDead: [],
      markersOnlyOnCandidate: [],
    },
  };
}

function row(position: number, matches: Match[], isLocal = false): FixRow {
  return {
    position,
    dead: dead({ isLocal }),
    source: {} as FixRow['source'],
    matches,
    tracks: {},
  };
}

const at = (n: number): FixRow => must(rows[n]);

const rows = [
  row(0, [match('a', 'exact'), match('a2', 'review')]),
  row(1, [match('b', 'high')]),
  row(2, [match('c', 'review'), match('c2', 'review')]),
  row(3, []),
  row(4, [match('d', 'none')]),
  row(5, [match('e', 'high', false)], true),
];

describe('groupRows', () => {
  it('groups by the best match and keeps playlist order', () => {
    const groups = groupRows(rows);
    expect(groups.exact.map((r) => r.position)).toEqual([0]);
    expect(groups.high.map((r) => r.position)).toEqual([1, 5]);
    expect(groups.review.map((r) => r.position)).toEqual([2]);
    expect(groups.none.map((r) => r.position)).toEqual([3, 4]);
  });
});

describe('initialSelection', () => {
  const selection = initialSelection(rows);

  it('selects Exact and High matches, and nothing else', () => {
    expect(selection[0]).toEqual({ candidateUri: 'a', selected: true });
    expect(selection[1]).toEqual({ candidateUri: 'b', selected: true });
    expect(selection[2]).toEqual({ candidateUri: 'c', selected: false });
  });

  it('never selects a local file, even in High', () => {
    expect(selection[5]).toEqual({ candidateUri: 'e', selected: false });
  });

  it('has no candidate for a row with no match', () => {
    expect(selection[3]).toEqual({ candidateUri: null, selected: false });
  });
});

describe('selecting', () => {
  it('toggles one row', () => {
    const next = setRowSelected(initialSelection(rows), 2, true);
    expect(next[2]?.selected).toBe(true);
    expect(setRowSelected(next, 2, false)[2]?.selected).toBe(false);
  });

  it('cannot select a row with no candidate', () => {
    expect(setRowSelected(initialSelection(rows), 3, true)[3]?.selected).toBe(false);
  });

  it('does not change the selection it was given', () => {
    const before = initialSelection(rows);
    setRowSelected(before, 2, true);
    expect(before[2]?.selected).toBe(false);
  });

  it('selects and clears a whole group, skipping rows with no candidate', () => {
    const groups = groupRows(rows);
    const all = selectGroup(initialSelection(rows), groups.none, true);
    expect(all[3]?.selected).toBe(false);
    const high = selectGroup(initialSelection(rows), groups.high, true);
    expect(high[5]?.selected).toBe(true);
    expect(selectGroup(high, groups.high, false)[1]?.selected).toBe(false);
  });

  it('reports a group as all, some or none selected', () => {
    const groups = groupRows(rows);
    const selection = initialSelection(rows);
    expect(groupState(selection, groups.exact)).toBe('all');
    expect(groupState(selection, groups.high)).toBe('some');
    expect(groupState(selection, groups.review)).toBe('none');
    expect(groupState(selection, groups.none)).toBe('none');
  });

  it('counts the selected rows', () => {
    expect(selectedCount(initialSelection(rows))).toBe(2);
  });
});

describe('chooseCandidate', () => {
  it('switches the replacement and selects the row, since the user chose it', () => {
    const next = chooseCandidate(initialSelection(rows), at(2), 'c2');
    expect(next[2]).toEqual({ candidateUri: 'c2', selected: true });
    expect(chosenMatch(at(2), must(next[2]))?.candidate.uri).toBe('c2');
  });

  it('ignores a URI the row has no match for', () => {
    const before = initialSelection(rows);
    expect(chooseCandidate(before, at(2), 'zzz')).toEqual(before);
  });

  it('lets a local file be picked, and selected', () => {
    const next = chooseCandidate(initialSelection(rows), at(5), 'e');
    expect(next[5]?.selected).toBe(true);
  });
});

describe('chosenMatch', () => {
  it('is null for a row with no candidate', () => {
    expect(chosenMatch(at(3), must(initialSelection(rows)[3]))).toBeNull();
  });
});
