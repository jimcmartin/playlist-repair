import { useReducer, useState } from 'react';
import {
  applyRepair,
  changeProgress,
  createApplyState,
  type ApplyPlan,
  type ChangeProgress,
  type Verification,
} from '../repair/apply';
import { backupFileName, buildBackup } from '../repair/backup';
import type { ScanResult } from '../repair/scan';
import { AuthError } from '../spotify/auth';
import type { SpotifyClient } from '../spotify/client';
import { describeApplyError } from './messages';

interface Props {
  client: SpotifyClient;
  playlistName: string;
  scan: ScanResult;
  plan: ApplyPlan;
  /** The playlist changed after the scan. Nothing was written. */
  onStale: (currentSnapshotId: string) => void;
  onDone: (verification: Verification) => void;
  onBack: () => void;
  onSessionEnded: (message: string) => void;
}

const LABEL: Record<ChangeProgress, string> = {
  waiting: 'Waiting',
  added: 'Replacement added',
  done: 'Done',
  failed: 'Stopped here',
};

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** Saves the backup as a file download. It sends nothing over the network. */
function downloadBackup(playlistName: string, scan: ScanResult): void {
  const now = new Date();
  const blob = new Blob([JSON.stringify(buildBackup(playlistName, scan, now), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName(playlistName, now);
  link.click();
  URL.revokeObjectURL(url);
}

export function ApplyScreen({
  client,
  playlistName,
  scan,
  plan,
  onStale,
  onDone,
  onBack,
  onSessionEnded,
}: Props) {
  // Progress is changed in place by the runner, and `refresh` redraws after each step.
  const [state] = useState(() => createApplyState(plan));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [backup, setBackup] = useState(true);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replacements = plan.changes.filter((c) => c.replacementUri !== null).length;
  const removalsOnly = plan.changes.length - replacements;
  const locals = plan.changes.filter((c) => c.isLocal).length;
  const progress = changeProgress(plan, state);

  async function start() {
    setError(null);
    setRunning(true);
    setStarted(true);
    // The backup is saved before the first write, and only once.
    if (backup && !saved) {
      downloadBackup(playlistName, scan);
      setSaved(true);
    }
    const outcome = await applyRepair(client, plan, state, { onProgress: refresh });
    setRunning(false);
    if (outcome.kind === 'stale') onStale(outcome.currentSnapshotId);
    else if (outcome.kind === 'done') onDone(outcome.verification);
    else if (outcome.error instanceof AuthError) {
      onSessionEnded(describeApplyError(outcome.error, outcome.phase, playlistName));
    } else setError(describeApplyError(outcome.error, outcome.phase, playlistName));
  }

  return (
    <>
      <h2>Apply changes</h2>
      <p>
        <strong>{playlistName}</strong>: {plural(replacements, 'replacement', 'replacements')} to
        add
        {removalsOnly > 0 && `, ${plural(removalsOnly, 'track', 'tracks')} to only remove`}.
        Replacements go in first, each where its greyed-out track is. Only after every one is added
        are the greyed-out tracks removed, so a failure never loses a track.
      </p>
      {locals > 0 && (
        <p className="notice">
          {plural(locals, 'local file', 'local files')} included.{' '}
          {plan.replaceLocals
            ? 'Spotify cannot remove a local file one at a time, so once every replacement is added the app saves the playlist again without its local files. Every other track keeps its place and date added. If Spotify refuses, the replacements stay, the files stay, and the last screen lists the files to delete by hand.'
            : 'Some local files in this playlist are not being replaced or removed, and Spotify cannot remove a local file one at a time. Each replacement is still added, the local files stay, and the last screen lists the ones to delete by hand.'}
        </p>
      )}
      {!started && (
        <>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={backup}
              onChange={(e) => {
                setBackup(e.target.checked);
              }}
            />{' '}
            Save a backup file of the playlist first (recommended)
          </label>
          <p className="fine-print">
            The backup lists every track as it is now, with its date added. Replacements get
            today&apos;s date as their date added. The backup stays on your computer.
          </p>
        </>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {running && <p role="status">Working… please keep this page open.</p>}
      <div className="actions">
        <button
          type="button"
          disabled={running}
          onClick={() => {
            void start();
          }}
        >
          {error !== null ? 'Resume' : 'Apply'}
        </button>
        <button type="button" className="secondary" disabled={running} onClick={onBack}>
          Back to review
        </button>
      </div>
      {started && (
        <ul className="apply-progress" aria-label="Progress by track">
          {plan.changes.map((change, i) => (
            <li key={`${String(change.position)}-${change.deadUri}`}>
              <span>
                {change.title}
                {change.artists.length > 0 && ` · ${change.artists.join(', ')}`}
                {change.replacementUri === null &&
                  (change.note === 'already-present'
                    ? ' (replacement already there)'
                    : ' (remove)')}
              </span>
              <span className="muted">{LABEL[progress[i] ?? 'waiting']}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
