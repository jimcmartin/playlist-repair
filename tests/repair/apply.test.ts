import { describe, expect, it } from 'vitest';
import {
  applyRepair,
  buildApplyPlan,
  changeProgress,
  createApplyState,
  type ApplyOutcome,
  type ApplyPlan,
  type ApplyState,
} from '../../src/repair/apply';
import type { Selection } from '../../src/repair/review';
import { scanPlaylist, type ScanResult } from '../../src/repair/scan';
import type { FixRow } from '../../src/repair/search';
import { ApiError, QuotaExceededError } from '../../src/spotify/client';
import { must } from '../helpers/must';
import { fakePlaylist, type Call, type FakePlaylistOptions } from '../helpers/playlist';

const t = (id: string) => `spotify:track:${id}`;
const dead = (id: string) => `spotify:track:dead${id}`;
const LOCAL = 'spotify:local:Artist:Album:Old+Song:200';

async function setup(uris: string[], options: FakePlaylistOptions = {}) {
  // Failures are held back until the scan is done.
  let armed = false;
  const playlist = fakePlaylist(uris, {
    ...options,
    fail: (call, n) => (armed ? (options.fail?.(call, n) ?? null) : null),
    loseReply: (call, n) => armed && (options.loseReply?.(call, n) ?? false),
  });
  const scan = await scanPlaylist(playlist.client, {
    id: 'p',
    name: 'Test',
    collaborative: false,
    snapshotId: 'v0',
    ownerId: 'me',
    ownerName: 'Me',
    total: uris.length,
    imageHosts: [],
  });
  playlist.calls.length = 0;
  armed = true;
  return { playlist, scan };
}

/** A row and a selected replacement for every listed position. */
function choose(scan: ScanResult, picks: Record<number, string | null>) {
  const rows: FixRow[] = [];
  const selection: Selection = {};
  for (const [key, candidateUri] of Object.entries(picks)) {
    const position = Number(key);
    const item = must(scan.entries[position]?.entry.item);
    rows.push({
      position,
      dead: {
        uri: item.uri ?? '',
        title: item.name ?? '',
        artists: [],
        album: '',
        durationMs: null,
        isrc: null,
        explicit: null,
        isLocal: scan.entries[position]?.entry.isLocal === true,
      },
      source: item,
      matches: [],
      tracks: {},
    });
    selection[position] = { candidateUri, selected: candidateUri !== null };
  }
  return { rows, selection };
}

const plan = (scan: ScanResult, picks: Record<number, string | null>, anyway: number[] = []) => {
  const { rows, selection } = choose(scan, picks);
  return buildApplyPlan(scan, rows, selection, new Set(anyway));
};

async function run(
  playlist: ReturnType<typeof fakePlaylist>,
  p: ApplyPlan,
  state: ApplyState = createApplyState(p),
): Promise<ApplyOutcome> {
  return applyRepair(playlist.client, p, state);
}

const done = (outcome: ApplyOutcome) => {
  if (outcome.kind !== 'done') throw new Error(`Expected done, got ${outcome.kind}`);
  return outcome.verification;
};

const writes = (calls: Call[]) =>
  calls.filter((c) => c.op === 'insert' || c.op === 'remove' || c.op === 'replace');

/** No removal comes before an insert. */
function insertsFirst(calls: Call[]) {
  const w = writes(calls).map((c) => c.op);
  const firstRemove = w.findIndex((op) => op !== 'insert');
  return firstRemove === -1 || !w.slice(firstRemove).includes('insert');
}

describe('buildApplyPlan', () => {
  it('inserts from the bottom of the playlist up, and batches neighbors', async () => {
    const { scan } = await setup([dead('1'), dead('2'), t('x'), dead('3'), dead('4'), dead('5')]);
    const p = plan(scan, { 0: t('r1'), 1: t('r2'), 3: t('r3'), 4: t('r4'), 5: t('r5') });
    expect(p.inserts).toEqual([
      { position: 3, uris: [t('r3'), t('r4'), t('r5')] },
      { position: 0, uris: [t('r1'), t('r2')] },
    ]);
    expect(p.removals).toEqual([
      { uris: [dead('1'), dead('2'), dead('3'), dead('4'), dead('5')], local: false },
    ]);
  });

  it('does not join replacements separated by a track that is not replaced', async () => {
    const { scan } = await setup([dead('1'), dead('2'), dead('3')]);
    const p = plan(scan, { 0: t('r1'), 2: t('r3') });
    expect(p.inserts.map((s) => s.position)).toEqual([2, 0]);
  });

  it('splits 100-URI limits, the later chunks first, all at the group start', async () => {
    const uris = Array.from({ length: 250 }, (_, i) => dead(String(i)));
    const { scan } = await setup(uris);
    const picks = Object.fromEntries(uris.map((_, i) => [i, t(`r${String(i)}`)]));
    const p = plan(scan, picks);
    expect(p.inserts.map((s) => [s.position, s.uris.length])).toEqual([
      [0, 50],
      [0, 100],
      [0, 100],
    ]);
    expect(p.inserts[1]?.uris[0]).toBe(t('r100'));
    expect(p.inserts[2]?.uris[0]).toBe(t('r0'));
    expect(p.removals.map((r) => r.uris.length)).toEqual([100, 100, 50]);
  });

  it('replaces every occurrence of a dead track, even if only one row was chosen', async () => {
    const { scan } = await setup([dead('1'), t('x'), dead('1')]);
    const p = plan(scan, { 0: t('r1'), 2: null });
    expect(p.changes.map((c) => [c.position, c.replacementUri])).toEqual([
      [0, t('r1')],
      [2, t('r1')],
    ]);
    expect(p.removals[0]?.uris).toEqual([dead('1')]);
  });

  it('only removes when the replacement is already in the playlist', async () => {
    const { scan } = await setup([t('r1'), dead('1')]);
    const p = plan(scan, { 1: t('r1') });
    expect(p.inserts).toEqual([]);
    expect(p.changes[0]).toMatchObject({ note: 'already-present', replacementUri: null });
    expect(p.removals[0]?.uris).toEqual([dead('1')]);
  });

  it('leaves a track with no choice alone, and removes it only on request', async () => {
    const { scan } = await setup([dead('1'), dead('2')]);
    const left = plan(scan, { 0: null, 1: null });
    expect(left.changes).toEqual([]);
    expect(left.removals).toEqual([]);
    const removed = plan(scan, { 0: null, 1: null }, [1]);
    expect(removed.changes).toHaveLength(1);
    expect(removed.changes[0]).toMatchObject({ position: 1, note: 'remove-anyway' });
    expect(removed.inserts).toEqual([]);
  });

  it('removes local files in their own batch', async () => {
    const { scan } = await setup([LOCAL, dead('1')]);
    const p = plan(scan, { 0: t('r0'), 1: t('r1') });
    expect(p.removals).toEqual([
      { uris: [dead('1')], local: false },
      { uris: [LOCAL], local: true },
    ]);
  });
});

describe('applyRepair', () => {
  it('replaces dead tracks in place, inserting before removing', async () => {
    const { playlist, scan } = await setup([t('a'), dead('1'), t('b'), dead('2')]);
    const p = plan(scan, { 1: t('r1'), 3: t('r2') });
    const v = done(await run(playlist, p));
    expect(playlist.uris()).toEqual([t('a'), t('r1'), t('b'), t('r2')]);
    expect(playlist.calls.map((c) => c.op)).toEqual([
      'snapshot',
      'insert',
      'insert',
      'remove',
      'items',
      // The playlist's version after the writes, read for the Done screen.
      'snapshot',
    ]);
    expect(v).toMatchObject({
      replaced: 2,
      orderOk: true,
      deadLeft: [],
      localLeft: [],
      missing: [],
    });
  });

  it('keeps order with batched neighbors and more than 100 tracks', async () => {
    const uris = [t('a'), ...Array.from({ length: 230 }, (_, i) => dead(String(i))), t('z')];
    const { playlist, scan } = await setup(uris);
    const picks = Object.fromEntries(
      Array.from({ length: 230 }, (_, i) => [i + 1, t(`r${String(i)}`)]),
    );
    const v = done(await run(playlist, plan(scan, picks)));
    expect(v.orderOk).toBe(true);
    expect(playlist.uris()).toEqual([
      t('a'),
      ...Array.from({ length: 230 }, (_, i) => t(`r${String(i)}`)),
      t('z'),
    ]);
    expect(insertsFirst(playlist.calls)).toBe(true);
  });

  it('writes nothing when the playlist changed since the scan', async () => {
    const { playlist, scan } = await setup([dead('1')]);
    playlist.appendElsewhere(t('theirs'));
    const outcome = await run(playlist, plan(scan, { 0: t('r1') }));
    expect(outcome).toEqual({ kind: 'stale', currentSnapshotId: 'v1' });
    expect(writes(playlist.calls)).toEqual([]);
  });

  it('leaves no-match tracks alone and removes the ones asked for', async () => {
    const { playlist, scan } = await setup([dead('1'), dead('2'), dead('3')]);
    const p = plan(scan, { 0: t('r1'), 1: null, 2: null }, [2]);
    const v = done(await run(playlist, p));
    expect(playlist.uris()).toEqual([t('r1'), dead('2')]);
    expect(v.removedOnly).toBe(1);
  });

  it('removes only when the replacement is already there', async () => {
    const { playlist, scan } = await setup([t('r1'), dead('1')]);
    done(await run(playlist, plan(scan, { 1: t('r1') })));
    expect(playlist.uris()).toEqual([t('r1')]);
    expect(writes(playlist.calls).map((c) => c.op)).toEqual(['remove']);
  });

  it('replaces both copies of a dead track', async () => {
    const { playlist, scan } = await setup([dead('1'), t('x'), dead('1')]);
    const v = done(await run(playlist, plan(scan, { 0: t('r1'), 2: t('r1') })));
    expect(playlist.uris()).toEqual([t('r1'), t('x'), t('r1')]);
    expect(v.orderOk).toBe(true);
  });

  it('reports a dead track Spotify did not fully remove', async () => {
    const { playlist, scan } = await setup([dead('1'), t('x'), dead('1')], {
      removeFirstOnly: true,
    });
    const v = done(await run(playlist, plan(scan, { 0: t('r1'), 2: t('r1') })));
    expect(v.deadLeft).toHaveLength(1);
    expect(v.orderOk).toBe(false);
  });

  describe('local files', () => {
    const OTHER = 'spotify:local:Artist:Album:Other:100';
    const ops = (calls: Call[]) => writes(calls).map((c) => c.op);

    it('removes every local file with one replace-all, after the inserts', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL, dead('1'), OTHER]);
      const v = done(await run(playlist, plan(scan, { 1: t('r1'), 2: t('r2'), 3: t('r3') })));
      expect(ops(playlist.calls)).toEqual(['insert', 'remove', 'replace']);
      expect(playlist.uris()).toEqual([t('a'), t('r1'), t('r2'), t('r3')]);
      expect(playlist.writes().at(-1)).toEqual({
        op: 'replace',
        uris: [t('a'), t('r1'), t('r2'), t('r3')],
      });
      expect(v.localLeft).toEqual([]);
      expect(v.orderOk).toBe(true);
    });

    it('never tries to remove a local file by URI when it will replace all', async () => {
      const { playlist, scan } = await setup([LOCAL]);
      await run(playlist, plan(scan, { 0: t('r0') }));
      expect(playlist.calls.some((c) => c.op === 'remove' && c.uris.includes(LOCAL))).toBe(false);
    });

    it('keeps tracks the user left alone, including greyed-out ones', async () => {
      const { playlist, scan } = await setup([dead('keep'), LOCAL, t('b')]);
      done(await run(playlist, plan(scan, { 1: t('r1') })));
      expect(playlist.uris()).toEqual([dead('keep'), t('r1'), t('b')]);
    });

    it('removes a local file that was only marked remove-anyway', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL]);
      const v = done(await run(playlist, plan(scan, { 1: null }, [1])));
      expect(playlist.uris()).toEqual([t('a')]);
      expect(v.localLeft).toEqual([]);
    });

    it('does not replace all while a local file stays', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL, OTHER]);
      const p = plan(scan, { 1: t('r1') });
      expect(p.replaceLocals).toBe(false);
      expect(p.replaceBlocker).toEqual({ kind: 'local-kept' });
      const v = done(await run(playlist, p));
      expect(v.localBlocker).toEqual({ kind: 'local-kept' });
      expect(ops(playlist.calls)).not.toContain('replace');
      expect(playlist.uris()).toContain(OTHER);
      expect(v.localLeft).toEqual([]);
    });

    it('does not replace all when the playlist has an entry with no track', async () => {
      const { scan } = await setup([t('a'), LOCAL]);
      const withGap = { ...scan, entries: [...scan.entries] };
      const first = must(withGap.entries[0]);
      withGap.entries[0] = { ...first, entry: { ...first.entry, item: null }, status: 'removed' };
      const p = plan(withGap, { 1: t('r1') });
      expect(p.replaceLocals).toBe(false);
      expect(p.replaceBlocker).toEqual({ kind: 'no-track' });
    });

    it('does not replace all when the result would be over 100 tracks', async () => {
      const many = Array.from({ length: 100 }, (_, i) => t(`m${String(i)}`));
      const { playlist, scan } = await setup([...many, LOCAL], { refuseLocal: true });
      const v = done(await run(playlist, plan(scan, { 100: t('r1') })));
      expect(ops(playlist.calls)).not.toContain('replace');
      expect(playlist.uris()).toHaveLength(102);
      expect(v.localLeft).toHaveLength(1);
      expect(v.localBlocker).toEqual({ kind: 'too-long', count: 101 });
    });

    it('replaces all at exactly 100 tracks', async () => {
      const many = Array.from({ length: 99 }, (_, i) => t(`m${String(i)}`));
      const { playlist, scan } = await setup([...many, LOCAL]);
      const v = done(await run(playlist, plan(scan, { 99: t('r1') })));
      expect(ops(playlist.calls)).toContain('replace');
      expect(playlist.uris()).toHaveLength(100);
      expect(v.localLeft).toEqual([]);
    });

    it('does not depend on the snapshot ids in write replies', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL], { wrongReplyIds: true });
      const v = done(await run(playlist, plan(scan, { 1: t('r1') })));
      expect(playlist.uris()).toEqual([t('a'), t('r1')]);
      expect(v.localLeft).toEqual([]);
      // The version Done hands to the next scan is the playlist's own.
      expect(v.snapshotId).toMatch(/^v\d+$/);
    });

    it('does not write when the playlist changed after the inserts', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL], { refuseLocal: true });
      const p = plan(scan, { 1: t('r1') });
      let edited = false;
      const state = createApplyState(p);
      const outcome = await applyRepair(playlist.client, p, state, {
        onProgress: () => {
          // After the insert, before the replace.
          if (!edited && state.inserts.every((x) => x === 'done')) {
            edited = true;
            playlist.appendElsewhere(t('theirs'));
          }
        },
      });
      const v = done(outcome);
      expect(ops(playlist.calls)).not.toContain('replace');
      expect(playlist.uris()).toContain(LOCAL);
      expect(v.localLeft).toHaveLength(1);
      expect(v.localBlocker).toEqual({ kind: 'edited' });
    });

    it('falls back to removing by URI when Spotify refuses the replace', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL], {
        refuseReplace: true,
        refuseLocal: true,
      });
      const v = done(await run(playlist, plan(scan, { 1: t('r1') })));
      expect(playlist.uris()).toEqual([t('a'), t('r1'), LOCAL]);
      expect(v.localLeft.map((l) => l.title)).toEqual([`Name of ${LOCAL}`]);
      expect(v.orderOk).toBe(true);
      expect(v.localBlocker).toEqual({ kind: 'refused', status: 400 });
    });

    it('falls back one file at a time, so one refusal hides no other', async () => {
      const { playlist, scan } = await setup([t('a'), LOCAL, OTHER], {
        refuseReplace: true,
        fail: (call) =>
          call.op === 'remove' && call.uris.length > 1 ? new ApiError(400, 'bad batch') : null,
      });
      const v = done(await run(playlist, plan(scan, { 1: t('r1'), 2: t('r2') })));
      expect(playlist.uris()).toEqual([t('a'), t('r1'), t('r2')]);
      expect(v.localLeft).toEqual([]);
    });

    it('stops on a quota error from the replace and resumes it', async () => {
      let failing = true;
      const { playlist, scan } = await setup([t('a'), LOCAL], {
        fail: (call) =>
          failing && call.op === 'replace'
            ? new QuotaExceededError('/playlists/p/items', 'PUT')
            : null,
      });
      const p = plan(scan, { 1: t('r1') });
      const state = createApplyState(p);
      const first = await run(playlist, p, state);
      expect(first).toMatchObject({ kind: 'stopped', phase: 'remove' });
      expect(playlist.uris()).toEqual([t('a'), t('r1'), LOCAL]);
      failing = false;
      const v = done(await run(playlist, p, state));
      expect(playlist.uris()).toEqual([t('a'), t('r1')]);
      expect(v.localLeft).toEqual([]);
    });
  });

  describe('failing and resuming', () => {
    const start = [t('a'), dead('1'), dead('2'), t('b'), dead('3'), LOCAL];
    const picks = { 1: t('r1'), 2: t('r2'), 4: t('r3'), 5: t('r4') };
    const finalUris = [t('a'), t('r1'), t('r2'), t('b'), t('r3'), t('r4')];

    it.each([1, 2, 3, 4, 5, 6])('resumes after call %i fails once', async (failing) => {
      let seen = 0;
      const { playlist, scan } = await setup(start, {
        fail: () => (++seen === failing ? new ApiError(500, 'boom') : null),
      });
      const p = plan(scan, picks);
      const state = createApplyState(p);
      const first = await run(playlist, p, state);
      expect(insertsFirst(playlist.calls)).toBe(true);
      // A refused local-file removal is retried file by file, so that failure needs no resume.
      const second = first.kind === 'done' ? first : await run(playlist, p, state);
      expect(done(second).orderOk).toBe(true);
      expect(playlist.uris()).toEqual(finalUris);
      expect(insertsFirst(playlist.calls)).toBe(true);
    });

    it('does not start removing while an insert has failed', async () => {
      const { playlist, scan } = await setup(start, {
        fail: (call) => (call.op === 'insert' ? new ApiError(500, 'boom') : null),
      });
      const outcome = await run(playlist, plan(scan, picks));
      expect(outcome).toMatchObject({ kind: 'stopped', phase: 'insert' });
      expect(playlist.calls.some((c) => c.op === 'remove')).toBe(false);
    });

    it.each(['insert', 'remove'] as const)(
      'does not repeat a %s whose reply was lost',
      async (op) => {
        let lost = false;
        const { playlist, scan } = await setup(start, {
          loseReply: (call) => {
            if (call.op !== op || lost) return false;
            lost = true;
            return true;
          },
        });
        const p = plan(scan, picks);
        const state = createApplyState(p);
        expect((await run(playlist, p, state)).kind).toBe('stopped');
        expect(done(await run(playlist, p, state)).orderOk).toBe(true);
        expect(playlist.uris()).toEqual(finalUris);
      },
    );

    it('resumes a failed verify without writing again', async () => {
      let items = 0;
      const { playlist, scan } = await setup(start, {
        // The first read is the replace-all's, the second is the verify's.
        fail: (call) => (call.op === 'items' && ++items === 2 ? new ApiError(503, 'later') : null),
      });
      const p = plan(scan, picks);
      const state = createApplyState(p);
      expect(await run(playlist, p, state)).toMatchObject({ kind: 'stopped', phase: 'verify' });
      const before = writes(playlist.calls).length;
      done(await run(playlist, p, state));
      expect(writes(playlist.calls)).toHaveLength(before);
    });

    it('stops on a quota error and keeps what was done', async () => {
      const { playlist, scan } = await setup(start, {
        fail: (call) =>
          call.op === 'remove' ? new QuotaExceededError('/playlists/p/items', 'DELETE') : null,
      });
      const p = plan(scan, picks);
      const state = createApplyState(p);
      const outcome = await run(playlist, p, state);
      expect(outcome).toMatchObject({ kind: 'stopped', phase: 'remove' });
      expect((outcome as { error: unknown }).error).toBeInstanceOf(QuotaExceededError);
      expect(state.inserts.every((s) => s === 'done')).toBe(true);
      expect(playlist.uris()).toContain(t('r1'));
    });

    it('does not check the version again on resume, since its own writes changed it', async () => {
      let seen = 0;
      const { playlist, scan } = await setup(start.slice(0, 5), {
        fail: () => (++seen === 3 ? new ApiError(500, 'boom') : null),
      });
      const p = plan(scan, { 1: t('r1'), 2: t('r2'), 4: t('r3') });
      const state = createApplyState(p);
      await run(playlist, p, state);
      await run(playlist, p, state);
      // One check before the first write, and one after the last, for the Done screen.
      const ops = playlist.calls.map((c) => c.op);
      expect(ops.filter((op) => op === 'snapshot')).toHaveLength(2);
      expect(ops.indexOf('snapshot', 1)).toBe(ops.length - 1);
    });
  });
});

describe('changeProgress', () => {
  it('follows each change through adding and removing', async () => {
    const { playlist, scan } = await setup([dead('1'), t('x'), dead('2')], {
      fail: (call) => (call.op === 'remove' ? new ApiError(500, 'boom') : null),
    });
    const p = plan(scan, { 0: t('r1'), 2: t('r2') });
    const state = createApplyState(p);
    expect(changeProgress(p, state)).toEqual(['waiting', 'waiting']);
    await run(playlist, p, state);
    // Both are added; the removal failed.
    expect(changeProgress(p, state)).toEqual(['failed', 'failed']);
  });

  it('reports a finished run as done', async () => {
    const { playlist, scan } = await setup([dead('1')]);
    const p = plan(scan, { 0: t('r1') });
    const state = createApplyState(p);
    await run(playlist, p, state);
    expect(changeProgress(p, state)).toEqual(['done']);
  });
});
