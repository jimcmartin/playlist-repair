import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Tier } from '../engine';
import {
  chooseCandidate,
  chosenMatch,
  groupRows,
  groupState,
  initialSelection,
  selectedCount,
  selectGroup,
  setRowSelected,
  type RowChoice,
  type Selection,
} from '../repair/review';
import type { FixRow, FixRun } from '../repair/search';
import type { PlaylistItem } from '../spotify/types';
import { describeDifferences, formatDuration, spotifyUrl } from './format';

// The fixture export is left out of the production build.
const FixtureExport = import.meta.env.DEV ? lazy(() => import('./FixtureExport')) : null;

const GROUPS: { tier: Tier; title: string; help: string }[] = [
  {
    tier: 'exact',
    title: 'Exact',
    help: 'The same recording: same ISRC, same length, same explicit flag. Selected for you.',
  },
  {
    tier: 'high',
    title: 'High confidence',
    help: 'Very close in title, artist, length and version. Selected for you, except local files.',
  },
  {
    tier: 'review',
    title: 'Needs a look',
    help: 'A likely match with something different, such as the version, the explicit flag or the length. Not selected.',
  },
  {
    tier: 'none',
    title: 'No match',
    help: 'Nothing close enough was found. These stay in the playlist.',
  },
];

const TIER_LABEL: Record<Tier, string> = {
  exact: 'Exact',
  high: 'High',
  review: 'Review',
  none: 'No match',
};

interface Props {
  playlistName: string;
  run: FixRun;
  /** Requests sent this session, scans and searches together. */
  sessionRequests: number;
  /** Why the search ended early or skipped tracks, if it did. */
  notice?: string | null;
  /** Decisions to start from, when the user comes back from Apply or the playlist was rescanned. */
  startSelection?: Selection | undefined;
  startRemoveAnyway?: ReadonlySet<number> | undefined;
  /** URIs already in the playlist, so a replacement that is there only needs the dead track removed. */
  presentUris: ReadonlySet<string>;
  onBack: () => void;
  onApply: (selection: Selection, removeAnyway: ReadonlySet<number>) => void;
}

export function ReviewScreen({
  playlistName,
  run,
  sessionRequests,
  notice,
  startSelection,
  startRemoveAnyway,
  presentUris,
  onBack,
  onApply,
}: Props) {
  const [selection, setSelection] = useState<Selection>(
    () => startSelection ?? initialSelection(run.rows),
  );
  const [removeAnyway, setRemoveAnyway] = useState<ReadonlySet<number>>(
    () => startRemoveAnyway ?? new Set(),
  );
  const groups = groupRows(run.rows);
  const chosen = selectedCount(selection);
  const total = chosen + removeAnyway.size;

  return (
    <>
      <h2>Review fixes</h2>
      <p>
        <strong>{playlistName}</strong>: {plural(run.rows.length, 'track', 'tracks')} searched. This
        run sent {plural(run.requests, 'request', 'requests')} to Spotify; {sessionRequests} this
        session so far. Nothing in your playlist has been changed.
      </p>
      {notice != null && (
        <p role="alert" className="error">
          {notice}
        </p>
      )}
      <p className="notice" role="status">
        {plural(chosen, 'replacement', 'replacements')} selected
        {removeAnyway.size > 0 && `, ${plural(removeAnyway.size, 'track', 'tracks')} to remove`}.
        Replacements get today&apos;s date as their date added; the backup file you can save before
        applying keeps the original dates.
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={total === 0}
          onClick={() => {
            onApply(selection, removeAnyway);
          }}
        >
          {total === 0 ? 'Apply' : `Apply ${plural(total, 'change', 'changes')}`}
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          Back to playlists
        </button>
      </div>
      {run.rows.length === 0 && <p>There was nothing to search for in this playlist.</p>}
      {GROUPS.map(({ tier, title, help }) => {
        const rows = groups[tier];
        if (rows.length === 0) return null;
        return (
          <section key={tier} className="review-group" aria-labelledby={`group-${tier}`}>
            <div className="review-group-head">
              <h3 id={`group-${tier}`}>
                {title} ({rows.length})
              </h3>
              {tier !== 'none' && (
                <GroupCheckbox
                  label={`Select all ${title.toLowerCase()}`}
                  state={groupState(selection, rows)}
                  onChange={(checked) => {
                    setSelection((current) => selectGroup(current, rows, checked));
                  }}
                />
              )}
            </div>
            <p className="muted">{help}</p>
            <ul className="review-rows">
              {rows.map((row) => (
                <ReviewRow
                  key={row.position}
                  row={row}
                  playlistName={playlistName}
                  presentUris={presentUris}
                  removeAnyway={removeAnyway.has(row.position)}
                  onRemoveAnyway={(checked) => {
                    setRemoveAnyway((current) => {
                      const next = new Set(current);
                      if (checked) next.add(row.position);
                      else next.delete(row.position);
                      return next;
                    });
                  }}
                  choice={selection[row.position] ?? { candidateUri: null, selected: false }}
                  onToggle={(checked) => {
                    setSelection((current) => setRowSelected(current, row.position, checked));
                  }}
                  onPick={(uri) => {
                    setSelection((current) => chooseCandidate(current, row, uri));
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function GroupCheckbox({
  label,
  state,
  onChange,
}: {
  label: string;
  state: 'all' | 'some' | 'none';
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <label className="inline-check">
      <input
        ref={ref}
        type="checkbox"
        checked={state === 'all'}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />{' '}
      {label}
    </label>
  );
}

interface RowProps {
  row: FixRow;
  playlistName: string;
  presentUris: ReadonlySet<string>;
  removeAnyway: boolean;
  onRemoveAnyway: (checked: boolean) => void;
  choice: RowChoice;
  onToggle: (checked: boolean) => void;
  onPick: (uri: string) => void;
}

function ReviewRow({
  row,
  playlistName,
  presentUris,
  removeAnyway,
  onRemoveAnyway,
  choice,
  onToggle,
  onPick,
}: RowProps) {
  const match = chosenMatch(row, choice);
  const replacement = match ? row.tracks[match.candidate.uri] : undefined;
  const differences = match ? describeDifferences(match) : [];
  return (
    <li className="review-row">
      <div className="review-pair">
        <TrackBlock
          heading="In the playlist"
          item={row.source}
          fallbackTitle={row.dead.title}
          fallbackArtists={row.dead.artists}
          badges={[
            row.dead.isLocal ? 'Local file' : 'Greyed out',
            row.dead.explicit === true && !row.dead.isLocal ? 'Explicit' : null,
          ]}
        />
        {match && replacement ? (
          <TrackBlock
            heading={`Replacement · ${TIER_LABEL[match.tier]}`}
            item={replacement}
            fallbackTitle={match.candidate.title}
            fallbackArtists={match.candidate.artists}
            badges={[match.candidate.explicit ? 'Explicit' : null]}
          />
        ) : (
          <div className="track-block">
            <span className="muted">Replacement</span>
            <p>No playable match found. This track stays where it is.</p>
          </div>
        )}
      </div>
      {match && (
        <>
          {differences.length > 0 && (
            <ul className="differences" aria-label="Differences from the original">
              {differences.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
          <label className="inline-check">
            <input
              type="checkbox"
              checked={choice.selected}
              onChange={(e) => {
                onToggle(e.target.checked);
              }}
            />{' '}
            Replace “{row.dead.title}” with this
          </label>
          {choice.selected && presentUris.has(match.candidate.uri) && (
            <p className="muted">
              This replacement is already in the playlist, so the greyed-out track is only removed.
            </p>
          )}
        </>
      )}
      {!match && (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={removeAnyway}
            onChange={(e) => {
              onRemoveAnyway(e.target.checked);
            }}
          />{' '}
          Remove “{row.dead.title}” from the playlist anyway
        </label>
      )}
      {row.matches.length > 1 && (
        <details>
          <summary>Choose a different match ({row.matches.length - 1} more)</summary>
          <ul className="picker">
            {row.matches.map((m) => (
              <li key={m.candidate.uri}>
                <label>
                  <input
                    type="radio"
                    name={`pick-${String(row.position)}`}
                    checked={m.candidate.uri === choice.candidateUri}
                    onChange={() => {
                      onPick(m.candidate.uri);
                    }}
                  />{' '}
                  {m.candidate.title} · {m.candidate.artists.join(', ')} · {m.candidate.album} ·{' '}
                  {formatDuration(m.candidate.durationMs)} · {TIER_LABEL[m.tier]}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      {FixtureExport !== null && (
        <Suspense fallback={null}>
          <FixtureExport row={row} playlistName={playlistName} />
        </Suspense>
      )}
    </li>
  );
}

interface BlockProps {
  heading: string;
  item: PlaylistItem;
  fallbackTitle: string;
  fallbackArtists: string[];
  badges: (string | null)[];
}

function TrackBlock({ heading, item, fallbackTitle, fallbackArtists, badges }: BlockProps) {
  const title = item.name ?? fallbackTitle;
  const trackUrl = spotifyUrl('track', item.id);
  const albumUrl = spotifyUrl('album', item.albumId);
  const artists =
    item.artists.length > 0 ? item.artists : fallbackArtists.map((name) => ({ id: null, name }));
  return (
    <div className="track-block">
      <span className="muted">{heading}</span>
      <strong>
        {trackUrl ? (
          <a href={trackUrl} target="_blank" rel="noreferrer noopener">
            {title}
          </a>
        ) : (
          title
        )}
      </strong>
      <span>
        {artists.map((artist, i) => {
          const url = spotifyUrl('artist', artist.id);
          return (
            <span key={`${artist.name}-${String(i)}`}>
              {i > 0 && ', '}
              {url ? (
                <a href={url} target="_blank" rel="noreferrer noopener">
                  {artist.name}
                </a>
              ) : (
                artist.name
              )}
            </span>
          );
        })}
      </span>
      <span className="muted">
        {item.albumName === null || item.albumName === '' ? null : albumUrl ? (
          <a href={albumUrl} target="_blank" rel="noreferrer noopener">
            {item.albumName}
          </a>
        ) : (
          item.albumName
        )}
        {' · '}
        {formatDuration(item.durationMs)}
      </span>
      <span className="badges">
        {badges
          .filter((badge) => badge !== null)
          .map((badge) => (
            <span key={badge} className="badge">
              {badge}
            </span>
          ))}
      </span>
    </div>
  );
}
