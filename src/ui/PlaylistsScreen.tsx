import { lazy, Suspense, useEffect, useState } from 'react';
import { buildApplyPlan, type Verification } from '../repair/apply';
import { rebaseRun } from '../repair/rebase';
import { initialSelection, type Selection } from '../repair/review';
import { createSearchCache, estimateFindRequests, findFixes, type FixRun } from '../repair/search';
import {
  buildScanResult,
  estimateScanRequests,
  scanAll,
  scanPlaylist,
  visiblePlaylists,
  isStopError,
  type ScanResult,
} from '../repair/scan';
import { AuthError } from '../spotify/auth';
import { listPlaylists } from '../spotify/endpoints';
import type { PlaylistSummary, Profile } from '../spotify/types';
import { browserEnv } from './boot';
import { ApplyScreen } from './ApplyScreen';
import { DoneScreen } from './DoneScreen';
import {
  describeScanError,
  describeSearchError,
  describeSearchFailures,
  describeStale,
} from './messages';
import { Icon } from './icons';
import { PlaylistDialog, type FindProgress } from './PlaylistDialog';
import { StatusBar } from './StatusBar';
import { createSessionClient } from './session';

// The development panel is left out of the production build.
const DevPanel = import.meta.env.DEV ? lazy(() => import('./DevPanel')) : null;

interface Props {
  profile: Profile;
  clientId: string;
  onLogout: () => void;
  /** The login ended and could not be renewed. */
  onSessionEnded: (message: string) => void;
}

const ALREADY_SEARCHED =
  'Every track here was already searched earlier in this session, so no requests were sent to Spotify. The fixes found are shown below.';

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; playlists: PlaylistSummary[]; hidden: number; dropped: number };

export function PlaylistsScreen({ profile, clientId, onLogout, onSessionEnded }: Props) {
  const [{ client, stats, subscribe }] = useState(() =>
    createSessionClient(browserEnv(), clientId),
  );
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [results, setResults] = useState<Record<string, ScanResult>>({});
  const [scanning, setScanning] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [searchCache] = useState(createSearchCache);
  const [fixRuns, setFixRuns] = useState<Record<string, FixRun>>({});
  const [finding, setFinding] = useState<(FindProgress & { id: string }) | null>(null);
  const [confirmingFind, setConfirmingFind] = useState<string | null>(null);
  const [includeLocal, setIncludeLocal] = useState<Record<string, boolean>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  // A plain message in the window, such as that nothing new needed searching.
  const [reviewInfo, setReviewInfo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // What the user decided on Review, kept while they look at Apply and when they come back.
  const [decisions, setDecisions] = useState<
    Record<string, { selection: Selection; removeAnyway: ReadonlySet<number> }>
  >({});
  const [applying, setApplying] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ id: string; verification: Verification } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPlaylists(client).then(
      ({ playlists, dropped }) => {
        if (cancelled) return;
        const visible = visiblePlaylists(playlists, profile.id);
        setLoaded({ state: 'ready', ...visible, dropped });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof AuthError) onSessionEnded(describeScanError(error));
        else setLoaded({ state: 'failed', message: describeScanError(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, profile.id, onSessionEnded, reloadKey]);

  function setBusy(id: string, busy: boolean) {
    setScanning((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function recordResult(playlist: PlaylistSummary, result: ScanResult) {
    setResults((current) => ({ ...current, [playlist.id]: result }));
    // A rescan can change positions, so an earlier search no longer lines up with the playlist.
    setFixRuns((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== playlist.id)),
    );
    setDecisions((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== playlist.id)),
    );
    setRowErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== playlist.id)),
    );
  }

  function recordFailure(playlist: PlaylistSummary, error: unknown) {
    if (error instanceof AuthError) {
      onSessionEnded(describeScanError(error));
      return;
    }
    if (isStopError(error)) setNotice(describeScanError(error));
    else
      setRowErrors((current) => ({
        ...current,
        [playlist.id]: describeScanError(error, playlist.name),
      }));
  }

  async function scanOne(playlist: PlaylistSummary) {
    setNotice(null);
    setBusy(playlist.id, true);
    try {
      const result = await scanPlaylist(client, playlist);
      recordResult(playlist, result);
      if (result.counts.broken + result.counts.local > 0) openDialog(playlist.id);
    } catch (error) {
      recordFailure(playlist, error);
    } finally {
      setBusy(playlist.id, false);
    }
  }

  async function scanEverything(playlists: PlaylistSummary[]) {
    setConfirmingAll(false);
    setNotice(null);
    const finished = new Set(Object.keys(results));
    await scanAll(client, playlists, {
      skip: finished,
      onStart: (playlist) => {
        setBusy(playlist.id, true);
      },
      onResult: (playlist, result) => {
        recordResult(playlist, result);
        setBusy(playlist.id, false);
      },
      onError: (playlist, error) => {
        recordFailure(playlist, error);
        setBusy(playlist.id, false);
      },
    });
  }

  async function findOne(playlist: PlaylistSummary, info: string | null = null) {
    const scan = results[playlist.id];
    if (!scan) return;
    setReviewInfo(info);
    setConfirmingFind(null);
    setNotice(null);
    setRowErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== playlist.id)),
    );
    setFinding({ id: playlist.id, done: 0, total: 0, requests: 0 });
    const run = await findFixes(client, scan, {
      includeLocal: includeLocal[playlist.id] === true,
      cache: searchCache,
      onProgress: (done, total, requests) => {
        setFinding({ id: playlist.id, done, total, requests });
      },
    });
    setFinding(null);
    setFixRuns((current) => ({ ...current, [playlist.id]: run }));
    if (run.stopped instanceof AuthError) {
      onSessionEnded(describeSearchError(run.stopped, run.rows.length, playlist.name));
      return;
    }
    // Fresh results start with Exact and High selected. Choices made on an older search are dropped.
    setDecisions((current) => ({
      ...current,
      [playlist.id]: { selection: initialSelection(run.rows), removeAnyway: new Set() },
    }));
    setReviewNotice(
      run.stopped !== null
        ? describeSearchError(run.stopped, run.rows.length, playlist.name)
        : run.failed.length > 0
          ? describeSearchFailures(run.failed.length, run.rows.length, playlist.name)
          : null,
    );
  }

  function openDialog(id: string) {
    setReviewNotice(null);
    setReviewInfo(null);
    setReviewing(id);
  }

  const busy = scanning.size > 0 || finding !== null;
  const statusBar = (
    <StatusBar
      userName={profile.displayName}
      playlists={loaded.state === 'ready' ? loaded.playlists.length : null}
      stats={stats}
      subscribe={subscribe}
    />
  );

  /** The playlist changed after the scan: scan again and carry the user's choices over. */
  async function handleStale(playlist: PlaylistSummary, currentSnapshotId: string) {
    const run = fixRuns[playlist.id];
    const decision = decisions[playlist.id];
    setApplying(null);
    try {
      const scan = await scanPlaylist(client, { ...playlist, snapshotId: currentSnapshotId });
      if (!run || !decision) {
        recordResult(playlist, scan);
        return;
      }
      const rebased = rebaseRun(run, decision.selection, scan);
      setResults((current) => ({ ...current, [playlist.id]: scan }));
      setFixRuns((current) => ({ ...current, [playlist.id]: rebased.run }));
      setDecisions((current) => ({
        ...current,
        [playlist.id]: { selection: rebased.selection, removeAnyway: new Set() },
      }));
      setReviewNotice(describeStale(playlist.name, rebased.dropped, rebased.unsearched));
    } catch (error) {
      if (error instanceof AuthError) onSessionEnded(describeScanError(error));
      else {
        setReviewing(null);
        setRowErrors((current) => ({
          ...current,
          [playlist.id]: `"${playlist.name}" changed in Spotify after the scan, so nothing was applied, and the rescan failed. ${describeScanError(error, playlist.name)}`,
        }));
      }
    }
  }

  function handleDone(playlist: PlaylistSummary, verification: Verification) {
    const scan = buildScanResult(playlist.id, verification.snapshotId, verification.entries);
    setResults((current) => ({ ...current, [playlist.id]: scan }));
    // Positions changed, so the old search no longer lines up with the playlist.
    const without = <T,>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => id !== playlist.id));
    setFixRuns(without);
    setDecisions(without);
    setApplying(null);
    setReviewing(null);
    setFinished({ id: playlist.id, verification });
  }

  const finishedPlaylist =
    finished !== null && loaded.state === 'ready'
      ? loaded.playlists.find((p) => p.id === finished.id)
      : undefined;
  if (finished && finishedPlaylist) {
    return (
      <>
        <DoneScreen
          playlistId={finishedPlaylist.id}
          playlistName={finishedPlaylist.name}
          verification={finished.verification}
          onClose={() => {
            setFinished(null);
          }}
        />
        {statusBar}
      </>
    );
  }

  const applyingRun = applying === null ? undefined : fixRuns[applying];
  const applyingScan = applying === null ? undefined : results[applying];
  const applyingDecision = applying === null ? undefined : decisions[applying];
  const applyingPlaylist =
    loaded.state === 'ready' ? loaded.playlists.find((p) => p.id === applying) : undefined;
  if (applyingRun && applyingScan && applyingDecision && applyingPlaylist) {
    return (
      <>
        <ApplyScreen
          client={client}
          playlistName={applyingPlaylist.name}
          scan={applyingScan}
          plan={buildApplyPlan(
            applyingScan,
            applyingRun.rows,
            applyingDecision.selection,
            applyingDecision.removeAnyway,
          )}
          onStale={(snapshot) => void handleStale(applyingPlaylist, snapshot)}
          onDone={(verification) => {
            handleDone(applyingPlaylist, verification);
          }}
          onBack={() => {
            setApplying(null);
          }}
          onSessionEnded={onSessionEnded}
        />
        {statusBar}
      </>
    );
  }

  const dialogPlaylist =
    reviewing !== null && loaded.state === 'ready'
      ? loaded.playlists.find((p) => p.id === reviewing)
      : undefined;
  const dialogScan = reviewing === null ? undefined : results[reviewing];
  const dialogDecision = reviewing === null ? undefined : decisions[reviewing];

  const shown =
    loaded.state === 'ready'
      ? loaded.playlists.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
      : [];

  return (
    <>
      <div className="page-head">
        <h2>Your playlists</h2>
        <button type="button" className="secondary small" onClick={onLogout}>
          Log out
        </button>
      </div>
      <p className="muted">
        Scanning only reads your playlists. Nothing in your account is changed until you apply
        fixes.
      </p>
      {notice !== null && (
        <p role="alert" className="error">
          {notice}
        </p>
      )}
      {loaded.state === 'loading' && <p role="status">Loading your playlists…</p>}
      {loaded.state === 'failed' && (
        <>
          <p role="alert" className="error">
            {loaded.message}
          </p>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                setLoaded({ state: 'loading' });
                setReloadKey((key) => key + 1);
              }}
            >
              Try again
            </button>
          </div>
        </>
      )}
      {loaded.state === 'ready' && (
        <>
          <div className="toolbar">
            <label className="search">
              <span className="visually-hidden">Search playlists</span>
              <Icon name="search" />
              <input
                type="search"
                placeholder="Search playlists"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
            </label>
            {!confirmingAll && (
              <button
                type="button"
                className="secondary"
                disabled={busy || loaded.playlists.length === 0}
                onClick={() => {
                  setConfirmingAll(true);
                }}
              >
                {Object.keys(results).length > 0 ? 'Scan the rest' : 'Scan all'}
              </button>
            )}
          </div>
          {confirmingAll && (
            <ScanAllConfirm
              playlists={loaded.playlists}
              scanned={new Set(Object.keys(results))}
              onStart={() => void scanEverything(loaded.playlists)}
              onCancel={() => {
                setConfirmingAll(false);
              }}
            />
          )}
          {loaded.playlists.length === 0 && (
            <p>You do not own any playlists, so there is nothing to scan.</p>
          )}
          {loaded.playlists.length > 0 && shown.length === 0 && (
            <p role="status">No playlists match “{query.trim()}”.</p>
          )}
          <ul className="playlists">
            {shown.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                result={results[playlist.id]}
                error={rowErrors[playlist.id]}
                scanning={scanning.has(playlist.id)}
                onScan={() => void scanOne(playlist)}
                onReview={() => {
                  openDialog(playlist.id);
                }}
                disabled={busy}
              />
            ))}
          </ul>
          {loaded.hidden > 0 && (
            <p className="fine-print">
              {loaded.hidden} playlist{loaded.hidden === 1 ? '' : 's'} owned by someone else (ones
              you follow or collaborate on) {loaded.hidden === 1 ? 'is' : 'are'} not listed.
              Playlist Repair only repairs playlists you own.
            </p>
          )}
          {loaded.dropped > 0 && (
            <p className="fine-print">
              {loaded.dropped} entr{loaded.dropped === 1 ? 'y' : 'ies'} in Spotify&apos;s playlist
              list could not be read and {loaded.dropped === 1 ? 'was' : 'were'} left out.
            </p>
          )}
          {DevPanel !== null && (
            <Suspense fallback={null}>
              <DevPanel
                client={client}
                stats={stats}
                playlists={loaded.playlists}
                results={results}
              />
            </Suspense>
          )}
        </>
      )}
      {dialogPlaylist && dialogScan && (
        <PlaylistDialog
          playlistName={dialogPlaylist.name}
          scan={dialogScan}
          cache={searchCache}
          run={fixRuns[dialogPlaylist.id]}
          selection={dialogDecision?.selection ?? {}}
          removeAnyway={dialogDecision?.removeAnyway ?? new Set()}
          includeLocal={includeLocal[dialogPlaylist.id] === true}
          progress={finding?.id === dialogPlaylist.id ? finding : null}
          confirming={confirmingFind === dialogPlaylist.id}
          notice={reviewNotice ?? rowErrors[dialogPlaylist.id] ?? null}
          info={reviewInfo}
          onIncludeLocal={(include) => {
            setIncludeLocal((current) => ({ ...current, [dialogPlaylist.id]: include }));
          }}
          onAsk={() => {
            const wanted = estimateFindRequests(
              dialogScan,
              { includeLocal: includeLocal[dialogPlaylist.id] === true },
              searchCache,
            );
            // Everything was searched before, so there is nothing to confirm: show the results.
            if (wanted.tracks === 0) {
              void findOne(dialogPlaylist, ALREADY_SEARCHED);
            } else setConfirmingFind(dialogPlaylist.id);
          }}
          onCancelAsk={() => {
            setConfirmingFind(null);
          }}
          onStart={() => void findOne(dialogPlaylist)}
          onSelection={(selection) => {
            setDecisions((current) => ({
              ...current,
              [dialogPlaylist.id]: {
                selection,
                removeAnyway: current[dialogPlaylist.id]?.removeAnyway ?? new Set(),
              },
            }));
          }}
          onRemoveAnyway={(removeAnyway) => {
            setDecisions((current) => ({
              ...current,
              [dialogPlaylist.id]: {
                selection: current[dialogPlaylist.id]?.selection ?? {},
                removeAnyway,
              },
            }));
          }}
          onApply={() => {
            setApplying(dialogPlaylist.id);
          }}
          onClose={() => {
            setReviewing(null);
            setConfirmingFind(null);
          }}
        />
      )}
      {statusBar}
    </>
  );
}

interface RowProps {
  playlist: PlaylistSummary;
  result: ScanResult | undefined;
  error: string | undefined;
  scanning: boolean;
  onScan: () => void;
  onReview: () => void;
  /** Something else is running, so the row's buttons wait. */
  disabled: boolean;
}

/** One line per playlist: name, track count, what the scan found, and its buttons. */
function PlaylistRow({ playlist, result, error, scanning, onScan, onReview, disabled }: RowProps) {
  const problems = result ? result.counts.broken + result.counts.local : 0;
  return (
    <li className="playlist-row">
      <div className="playlist-line">
        <span className="playlist-name">
          <Icon name="music" />
          <strong>{playlist.name}</strong>
        </span>
        <span className="muted playlist-count">
          {playlist.total === null ? '–' : plural(playlist.total, 'track', 'tracks')}
        </span>
        <span className="playlist-status">
          {scanning && <span role="status">Scanning…</span>}
          {result && !scanning && <ScanChip result={result} />}
        </span>
        <span className="playlist-actions">
          {problems > 0 && !scanning && (
            <button type="button" className="small" disabled={disabled} onClick={onReview}>
              Review
            </button>
          )}
          <button
            type="button"
            className="secondary small"
            disabled={scanning || disabled}
            onClick={onScan}
          >
            {result ? 'Rescan' : 'Scan'}
          </button>
        </span>
      </div>
      {result && result.counts.unknown > 0 && (
        <span className="warning">
          {plural(result.counts.unknown, 'track', 'tracks')} came back without playability
          information, so {result.counts.unknown === 1 ? 'it was' : 'they were'} not counted either
          way.
        </span>
      )}
      {error !== undefined && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </li>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function ScanChip({ result }: { result: ScanResult }) {
  const { broken, local } = result.counts;
  if (broken + local === 0) {
    return (
      <span className="tag tag-ok">
        <Icon name="check" size={13} /> No problems
      </span>
    );
  }
  return (
    <>
      {broken > 0 && <span className="tag tag-broken">{plural(broken, 'broken', 'broken')}</span>}
      {local > 0 && (
        <span className="tag tag-local">{plural(local, 'local file', 'local files')}</span>
      )}
    </>
  );
}

interface ConfirmProps {
  playlists: PlaylistSummary[];
  scanned: ReadonlySet<string>;
  onStart: () => void;
  onCancel: () => void;
}

function ScanAllConfirm({ playlists, scanned, onStart, onCancel }: ConfirmProps) {
  const todo = playlists.filter((p) => !scanned.has(p.id));
  const { requests, exact } = estimateScanRequests(playlists, scanned);
  return (
    <div className="notice" role="group" aria-label="Confirm scan">
      <p>
        Scanning {plural(todo.length, 'playlist', 'playlists')} takes {exact ? 'about' : 'at least'}{' '}
        <strong>{plural(requests, 'request', 'requests')}</strong> to Spotify. Spotify limits how
        many requests this app can make and does not say how many. If it stops the scan, the counts
        so far are kept and you can continue later. Nothing in your account is changed.
      </p>
      <div className="actions">
        <button type="button" disabled={todo.length === 0} onClick={onStart}>
          Scan {plural(todo.length, 'playlist', 'playlists')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
