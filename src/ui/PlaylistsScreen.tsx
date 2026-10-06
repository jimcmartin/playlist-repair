import { lazy, Suspense, useEffect, useState } from 'react';
import {
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
import { describeScanError } from './messages';
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

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; playlists: PlaylistSummary[]; hidden: number; dropped: number };

export function PlaylistsScreen({ profile, clientId, onLogout, onSessionEnded }: Props) {
  const [{ client, stats }] = useState(() => createSessionClient(browserEnv(), clientId));
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [results, setResults] = useState<Record<string, ScanResult>>({});
  const [scanning, setScanning] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmingAll, setConfirmingAll] = useState(false);

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
      recordResult(playlist, await scanPlaylist(client, playlist));
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

  const busy = scanning.size > 0;

  return (
    <>
      <h2>Your playlists</h2>
      <p>
        Connected as <strong>{profile.displayName}</strong>. Scanning only reads your playlists.
        Nothing in your account is changed.
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
          {confirmingAll ? (
            <ScanAllConfirm
              playlists={loaded.playlists}
              scanned={new Set(Object.keys(results))}
              onStart={() => void scanEverything(loaded.playlists)}
              onCancel={() => {
                setConfirmingAll(false);
              }}
            />
          ) : (
            <div className="actions">
              <button
                type="button"
                disabled={busy || loaded.playlists.length === 0}
                onClick={() => {
                  setConfirmingAll(true);
                }}
              >
                {Object.keys(results).length > 0 ? 'Scan the rest' : 'Scan all'}
              </button>
            </div>
          )}
          {loaded.playlists.length === 0 && (
            <p>You do not own or collaborate on any playlists, so there is nothing to scan.</p>
          )}
          <ul className="playlists">
            {loaded.playlists.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                profileId={profile.id}
                result={results[playlist.id]}
                error={rowErrors[playlist.id]}
                scanning={scanning.has(playlist.id)}
                onScan={() => void scanOne(playlist)}
              />
            ))}
          </ul>
          {loaded.hidden > 0 && (
            <p className="fine-print">
              {loaded.hidden} playlist{loaded.hidden === 1 ? '' : 's'} you follow but do not own or
              collaborate on {loaded.hidden === 1 ? 'is' : 'are'} not listed. Spotify does not share
              the contents of those, so they cannot be scanned or repaired.
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
      <div className="actions">
        <button type="button" className="secondary" onClick={onLogout}>
          Log out
        </button>
      </div>
    </>
  );
}

interface RowProps {
  playlist: PlaylistSummary;
  profileId: string;
  result: ScanResult | undefined;
  error: string | undefined;
  scanning: boolean;
  onScan: () => void;
}

function PlaylistRow({ playlist, profileId, result, error, scanning, onScan }: RowProps) {
  const owner =
    playlist.ownerId === profileId ? null : `Collaborative, owned by ${playlist.ownerName}`;
  return (
    <li className="playlist-row">
      <div className="playlist-main">
        <strong>{playlist.name}</strong>
        <span className="muted">
          {[owner, playlist.total === null ? null : `${String(playlist.total)} tracks`]
            .filter((part) => part !== null)
            .join(' · ')}
        </span>
        {scanning && <span role="status">Scanning…</span>}
        {result && !scanning && <ScanSummary result={result} />}
        {error !== undefined && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
      </div>
      <button type="button" className="secondary" disabled={scanning} onClick={onScan}>
        {result ? 'Rescan' : 'Scan'}
      </button>
    </li>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function ScanSummary({ result }: { result: ScanResult }) {
  const { counts } = result;
  const others = [
    counts.explicit > 0 && `${String(counts.explicit)} hidden by your explicit-content setting`,
    counts.product > 0 && `${String(counts.product)} not available on your plan`,
    counts['other-restriction'] > 0 &&
      `${String(counts['other-restriction'])} with another restriction`,
    counts.removed > 0 && `${String(counts.removed)} removed from Spotify`,
    counts.episode > 0 && `${plural(counts.episode, 'episode', 'episodes')} skipped`,
  ].filter((part) => part !== false);

  return (
    <>
      <span className="broken-count">
        <strong>{plural(counts.broken, 'broken track', 'broken tracks')}</strong>
        <span className="muted">
          {' '}
          · {plural(counts.ok, 'good track', 'good tracks')} ·{' '}
          {plural(counts.local, 'local file', 'local files')}
        </span>
      </span>
      {others.length > 0 && (
        <span className="muted">Also shown, not repaired: {others.join(', ')}.</span>
      )}
      {counts.unknown > 0 && (
        <span className="warning">
          {plural(counts.unknown, 'track', 'tracks')} came back without playability information, so{' '}
          {counts.unknown === 1 ? 'it was' : 'they were'} not counted either way.
        </span>
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
