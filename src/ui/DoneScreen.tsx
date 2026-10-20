import type { TrackRef, Verification } from '../repair/apply';

interface Props {
  playlistId: string;
  playlistName: string;
  verification: Verification;
  onClose: () => void;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function TrackList({ tracks }: { tracks: TrackRef[] }) {
  return (
    <ul>
      {tracks.map((track, i) => (
        <li key={`${track.title}-${String(i)}`}>
          {track.title}
          {track.artists.length > 0 && ` · ${track.artists.join(', ')}`}
        </li>
      ))}
    </ul>
  );
}

export function DoneScreen({ playlistId, playlistName, verification, onClose }: Props) {
  const { replaced, removedOnly, missing, deadLeft, localLeft, orderOk } = verification;
  const clean = missing.length === 0 && deadLeft.length === 0 && orderOk;
  return (
    <>
      <h2>{clean && localLeft.length === 0 ? 'Done' : 'Done, with something to check'}</h2>
      <p role="status">
        <strong>{playlistName}</strong>: {plural(replaced, 'replacement', 'replacements')} added
        {removedOnly > 0 && `, ${plural(removedOnly, 'track', 'tracks')} removed`}. The playlist was
        read again from Spotify to check.
      </p>
      {clean ? (
        <p>
          Every replacement is in place, the order is kept, and no greyed-out track is left except
          any listed below.
        </p>
      ) : (
        <div role="alert" className="error">
          {missing.length > 0 && (
            <>
              <p>
                {plural(missing.length, 'replacement is', 'replacements are')} not in the playlist.
                Run Find fixes again to retry:
              </p>
              <TrackList tracks={missing} />
            </>
          )}
          {deadLeft.length > 0 && (
            <>
              <p>
                {plural(deadLeft.length, 'greyed-out track is', 'greyed-out tracks are')} still in
                the playlist. Spotify may have removed only some copies. Scan the playlist again and
                apply again:
              </p>
              <TrackList tracks={deadLeft} />
            </>
          )}
          {orderOk ? null : (
            <p>
              The playlist does not match what was planned. It may have been edited while this ran,
              or Spotify placed a track elsewhere. Compare it with your backup file if you saved
              one.
            </p>
          )}
        </div>
      )}
      {localLeft.length > 0 && (
        <div className="notice">
          <p>
            Spotify did not let this app remove{' '}
            {plural(localLeft.length, 'local file', 'local files')}. Each replacement was added, so
            delete these by hand in Spotify:
          </p>
          <TrackList tracks={localLeft} />
        </div>
      )}
      <p className="fine-print">
        Replacements have today&apos;s date as their date added. The original dates are in the
        backup file, if you saved one.
      </p>
      <div className="actions">
        <a
          className="button"
          href={`https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open the playlist in Spotify
        </a>
        <button type="button" className="secondary" onClick={onClose}>
          Back to playlists
        </button>
      </div>
    </>
  );
}
