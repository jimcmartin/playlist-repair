import { useSyncExternalStore } from 'react';
import { Icon } from './icons';
import type { ClientStats } from './session';

interface Props {
  userName: string;
  /** Playlists the user owns, as listed. Null while they load. */
  playlists: number | null;
  stats: ClientStats;
  subscribe: (listener: () => void) => () => void;
}

/** The bar along the bottom of the main screen: who is logged in, what was found, and the request count. */
export function StatusBar({ userName, playlists, stats, subscribe }: Props) {
  const requests = useSyncExternalStore(
    subscribe,
    () => stats.requests,
    () => stats.requests,
  );
  return (
    <section className="status-bar" aria-label="Status">
      <span>
        <Icon name="user" /> Logged in as <strong>{userName}</strong>
      </span>
      <span>
        <Icon name="list" />{' '}
        {playlists === null ? (
          'Loading playlists…'
        ) : (
          <>
            <strong>{playlists}</strong> {playlists === 1 ? 'playlist' : 'playlists'} found
          </>
        )}
      </span>
      <span>
        <Icon name="pulse" /> <strong>{requests}</strong> Spotify API{' '}
        {requests === 1 ? 'request' : 'requests'}
      </span>
    </section>
  );
}
