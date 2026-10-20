import { estimateFindRequests, type FixRun, type SearchCache } from '../repair/search';
import { selectedCount, type Selection } from '../repair/review';
import type { ScanResult } from '../repair/scan';
import { describeProblem } from './format';
import { Icon } from './icons';
import { Modal } from './Modal';
import { ReviewList } from './ReviewList';

export interface FindProgress {
  done: number;
  total: number;
  requests: number;
}

interface Props {
  playlistName: string;
  scan: ScanResult;
  cache: SearchCache;
  /** The last search for this playlist, if there was one. */
  run: FixRun | undefined;
  selection: Selection;
  removeAnyway: ReadonlySet<number>;
  includeLocal: boolean;
  /** Set while the search runs. */
  progress: FindProgress | null;
  /** Showing the request estimate and waiting for a yes. */
  confirming: boolean;
  /** Why the last search ended early or skipped tracks. */
  notice: string | null;
  /** A plain message, such as that nothing new needed searching. */
  info?: string | null;
  onIncludeLocal: (include: boolean) => void;
  onAsk: () => void;
  onCancelAsk: () => void;
  onStart: () => void;
  onSelection: (selection: Selection) => void;
  onRemoveAnyway: (positions: ReadonlySet<number>) => void;
  onApply: () => void;
  onClose: () => void;
}

function artistLine(names: string[]): string {
  return names.length === 0 ? 'Unknown artist' : names.join(', ');
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The window for one scanned playlist: its problem tracks, Find fixes, the fixes found, and Apply. */
export function PlaylistDialog({
  playlistName,
  scan,
  cache,
  run,
  selection,
  removeAnyway,
  includeLocal,
  progress,
  confirming,
  notice,
  info = null,
  onIncludeLocal,
  onAsk,
  onCancelAsk,
  onStart,
  onSelection,
  onRemoveAnyway,
  onApply,
  onClose,
}: Props) {
  const { broken, local } = scan.counts;
  const estimate = estimateFindRequests(scan, { includeLocal }, cache);
  const searching = progress !== null;
  const chosen = selectedCount(selection) + removeAnyway.size;
  const searched = new Set(run?.rows.map((row) => row.position));
  const unsearched = scan.entries.filter(
    ({ position, status }) =>
      (status === 'broken' || status === 'local') && !searched.has(position),
  ).length;
  const presentUris = new Set(scan.entries.flatMap(({ entry }) => entry.item?.uri ?? []));

  return (
    <Modal
      title={playlistName}
      subtitle={`${plural(broken, 'broken track', 'broken tracks')} · ${plural(local, 'local file', 'local files')}`}
      onClose={onClose}
      footer={
        <>
          {local > 0 && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={includeLocal}
                disabled={searching}
                onChange={(e) => {
                  onIncludeLocal(e.target.checked);
                }}
              />{' '}
              Include local files ({local})
            </label>
          )}
          <span className="spacer" />
          {searching && (
            <span role="status" className="muted">
              Searching… {progress.done} of {plural(progress.total, 'track', 'tracks')} ·{' '}
              {plural(progress.requests, 'request', 'requests')}
            </span>
          )}
          <button
            type="button"
            className="secondary"
            disabled={searching || (broken === 0 && !includeLocal)}
            onClick={onAsk}
          >
            Find fixes
          </button>
          <button type="button" disabled={chosen === 0 || searching} onClick={onApply}>
            {chosen === 0 ? 'Apply fixes' : `Apply ${plural(chosen, 'fix', 'fixes')}`}
          </button>
        </>
      }
    >
      {notice !== null && (
        <p role="alert" className="error">
          {notice}
        </p>
      )}
      {info !== null && (
        <p role="status" className="notice">
          {info}
        </p>
      )}
      {run ? (
        <>
          <p className="muted">
            {plural(run.rows.length, 'track', 'tracks')} searched using{' '}
            {plural(run.requests, 'request', 'requests')}. Switch on Replace for each fix to apply;
            nothing in your playlist changes until you apply. Replacements get today&apos;s date as
            their date added.
          </p>
          {unsearched > 0 && (
            <p className="muted">
              {plural(unsearched, 'track was', 'tracks were')} not searched.
              {local > 0 &&
                !includeLocal &&
                ' Tick Include local files, then choose Find fixes, to search local files.'}
            </p>
          )}
          <ReviewList
            playlistName={playlistName}
            run={run}
            selection={selection}
            removeAnyway={removeAnyway}
            presentUris={presentUris}
            onSelection={onSelection}
            onRemoveAnyway={onRemoveAnyway}
          />
        </>
      ) : (
        <ProblemTracks scan={scan} />
      )}
      {confirming && !searching && (
        <Modal title="Search for fixes?" small onClose={onCancelAsk}>
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
            <button type="button" className="secondary" onClick={onCancelAsk}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Every broken track and local file in the scan, with what is wrong with it. */
function ProblemTracks({ scan }: { scan: ScanResult }) {
  const problems = scan.entries.filter(({ status }) => status === 'broken' || status === 'local');
  const { explicit, product } = scan.counts;
  const other = scan.counts['other-restriction'];
  return (
    <>
      <ul className="problem-list" aria-label="Tracks with a problem">
        {problems.map(({ position, entry, status }) => {
          const item = entry.item;
          const kind = status === 'local' ? 'local' : 'broken';
          return (
            <li key={position}>
              <Icon name={kind === 'local' ? 'file' : 'alert'} />
              <div className="problem-main">
                <strong>{item?.name ?? 'Untitled'}</strong>
                <span className="muted">
                  {artistLine(item?.artists.map((artist) => artist.name) ?? [])}
                  {item?.albumName ? ` · ${item.albumName}` : ''}
                </span>
              </div>
              <span className={`tag tag-${kind}`}>
                {describeProblem(kind, item?.restrictionReason ?? null)}
              </span>
            </li>
          );
        })}
      </ul>
      {explicit + product + other > 0 && (
        <p className="muted">
          Also in this playlist but not repaired: {explicit} hidden by your explicit-content
          setting, {product} not available on your plan, {other} with another restriction.
        </p>
      )}
    </>
  );
}
