import { estimateFindRequests, type FixRun, type SearchCache } from '../repair/search';
import type { ScanResult } from '../repair/scan';

export interface FindProgress {
  done: number;
  total: number;
  requests: number;
}

interface Props {
  scan: ScanResult;
  cache: SearchCache;
  includeLocal: boolean;
  onIncludeLocal: (include: boolean) => void;
  confirming: boolean;
  /** Another scan or search is running. */
  busy: boolean;
  /** Set while this playlist's search is running. */
  progress: FindProgress | null;
  run: FixRun | undefined;
  onAsk: () => void;
  onCancel: () => void;
  onStart: () => void;
  onReview: () => void;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** "Find fixes" for one scanned playlist: the local-files checkbox, the estimate, and the result. */
export function FindFixesPanel({
  scan,
  cache,
  includeLocal,
  onIncludeLocal,
  confirming,
  busy,
  progress,
  run,
  onAsk,
  onCancel,
  onStart,
  onReview,
}: Props) {
  const { broken, local } = scan.counts;
  if (broken === 0 && local === 0) return null;
  const estimate = estimateFindRequests(scan, { includeLocal }, cache);
  const nothing = broken === 0 && !includeLocal;

  return (
    <div className="find-fixes">
      {local > 0 && (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={includeLocal}
            disabled={progress !== null}
            onChange={(e) => {
              onIncludeLocal(e.target.checked);
            }}
          />{' '}
          Include local files ({String(local)})
        </label>
      )}
      {confirming && progress === null ? (
        <div className="notice" role="group" aria-label="Confirm search">
          <p>
            Finding fixes for {plural(estimate.tracks, 'track', 'tracks')} takes{' '}
            <strong>up to {plural(estimate.requests, 'request', 'requests')}</strong> to Spotify.
            Searches count against the same limit as scanning. If Spotify stops the search, what was
            found so far is kept and you can continue later. Nothing in your playlist is changed.
          </p>
          <div className="actions">
            <button type="button" onClick={onStart}>
              Search {plural(estimate.tracks, 'track', 'tracks')}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy || progress !== null || nothing}
            onClick={onAsk}
          >
            Find fixes
          </button>
          {run && progress === null && (
            <button type="button" className="secondary" onClick={onReview}>
              Review fixes
            </button>
          )}
        </div>
      )}
      {progress !== null && (
        <span role="status">
          Searching… {progress.done} of {plural(progress.total, 'track', 'tracks')} ·{' '}
          {plural(progress.requests, 'request', 'requests')} so far
        </span>
      )}
      {run && progress === null && (
        <span className="muted">
          Last search: {plural(run.rows.length, 'track', 'tracks')},{' '}
          {plural(run.requests, 'request', 'requests')} sent.
        </span>
      )}
    </div>
  );
}
