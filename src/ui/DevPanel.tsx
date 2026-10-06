import { useState } from 'react';
import { emptyCounts, scanPlaylist, type ScanResult, type StatusCounts } from '../repair/scan';
import type { SpotifyClient } from '../spotify/client';
import type { PlaylistSummary } from '../spotify/types';
import type { ClientStats } from './session';

// Development only: this file is not part of the production build. It exists
// to show what Spotify really sends, so the plan's open questions can be
// answered from a real account. Raw entries hold track metadata and no tokens.

interface Props {
  client: SpotifyClient;
  stats: ClientStats;
  playlists: PlaylistSummary[];
  results: Record<string, ScanResult>;
}

function tally(values: (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? '(none)';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function show(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function countsLine(counts: StatusCounts): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${status}: ${String(n)}`)
    .join(', ');
}

export default function DevPanel({ client, stats, playlists, results }: Props) {
  const scanned = playlists.filter((p) => results[p.id] !== undefined);
  const [selectedId, setSelectedId] = useState('');
  const [position, setPosition] = useState('');
  const [market, setMarket] = useState('');
  const [withMarket, setWithMarket] = useState<
    { market: string; result: ScanResult } | string | null
  >(null);
  const [query, setQuery] = useState('');
  const [probe, setProbe] = useState<string | null>(null);
  const [, refresh] = useState(0);

  const playlist = scanned.find((p) => p.id === selectedId) ?? scanned[0];
  const result = playlist ? results[playlist.id] : undefined;

  const items = result?.entries.map((e) => e.entry.item) ?? [];
  const playable = {
    true: items.filter((i) => i?.isPlayable === true).length,
    false: items.filter((i) => i?.isPlayable === false).length,
    absent: items.filter((i) => i !== null && i.isPlayable === null).length,
    noItem: items.filter((i) => i === null).length,
  };
  const reasons = tally(
    items.filter((i) => i?.isPlayable === false).map((i) => i?.restrictionReason ?? null),
  );
  const notOk = result?.entries.filter((e) => e.status !== 'ok') ?? [];
  const byPosition = result?.entries.find((e) => String(e.position) === position.trim());

  const totals = Object.values(results).reduce<StatusCounts>(
    (sum, r) => {
      for (const [status, n] of Object.entries(r.counts)) sum[status as keyof StatusCounts] += n;
      return sum;
    },
    { ...emptyCounts() },
  );

  const hosts = new Set<string>();
  for (const p of playlists) p.imageHosts.forEach((h) => hosts.add(h));
  for (const r of Object.values(results)) {
    for (const e of r.entries) e.entry.item?.imageHosts.forEach((h) => hosts.add(h));
  }

  async function rescanWithMarket() {
    if (!playlist || market.trim() === '') return;
    setWithMarket('Scanning…');
    try {
      setWithMarket({
        market: market.trim(),
        result: await scanPlaylist(client, playlist, { market: market.trim() }),
      });
    } catch (error) {
      setWithMarket(`Failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async function runProbe() {
    setProbe('Searching…');
    try {
      setProbe(show(await client.get('/search', { q: query, type: 'track', limit: 10 })));
    } catch (error) {
      setProbe(`Failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return (
    <section className="dev-panel" aria-label="Development panel">
      <h3>Development panel</h3>
      <p className="muted">Not part of the production build. Shows what Spotify really sent.</p>

      <p>
        <strong>Requests:</strong> {stats.requests} sent, {stats.rateLimits.length} rate limited
        {stats.rateLimits.length > 0 &&
          ` (Retry-After: ${stats.rateLimits.map((ms) => (ms === null ? 'none' : `${String(ms / 1000)}s`)).join(', ')})`}
        , {stats.quotaStops} quota stops, {stats.refreshes} token refreshes.{' '}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            refresh((n) => n + 1);
          }}
        >
          Refresh
        </button>
      </p>
      <p>
        <strong>All {scanned.length} scanned playlists:</strong> {countsLine(totals) || '(none)'}
      </p>
      <p>
        <strong>Image hosts seen:</strong>{' '}
        {hosts.size === 0 ? '(none yet)' : [...hosts].sort().join(', ')}
      </p>

      {scanned.length === 0 || !playlist || !result ? (
        <p>Scan a playlist to see its raw entries.</p>
      ) : (
        <>
          <label htmlFor="dev-playlist">Scanned playlist</label>
          <select
            id="dev-playlist"
            value={playlist.id}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setWithMarket(null);
            }}
          >
            {scanned.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <p>
            <strong>is_playable (no market sent):</strong> true {playable.true}, false{' '}
            {playable.false}, absent {playable.absent}, no item {playable.noItem}
            <br />
            <strong>Statuses:</strong> {countsLine(result.counts)}
            <br />
            <strong>restrictions.reason on is_playable=false:</strong>{' '}
            {Object.keys(reasons).length === 0 ? '(none)' : show(reasons)}
          </p>

          <label htmlFor="dev-market">Rescan with market (for example GB or US)</label>
          <input
            id="dev-market"
            type="text"
            value={market}
            maxLength={2}
            onChange={(e) => {
              setMarket(e.target.value.toUpperCase());
            }}
          />
          <button type="button" className="secondary" onClick={() => void rescanWithMarket()}>
            Rescan with market
          </button>
          {typeof withMarket === 'string' && <p>{withMarket}</p>}
          {withMarket !== null && typeof withMarket !== 'string' && (
            <p>
              <strong>With market {withMarket.market}:</strong>{' '}
              {countsLine(withMarket.result.counts)}
            </p>
          )}

          <h4>Raw entries that are not ok ({notOk.length})</h4>
          {notOk.length === 0 && <p>None. Use the position box below to look at any entry.</p>}
          {notOk.map((e) => (
            <details key={e.position}>
              <summary>
                #{e.position} {e.status}: {e.entry.item?.name ?? '(no item)'}
              </summary>
              <pre>{show(e.entry.raw)}</pre>
            </details>
          ))}

          <label htmlFor="dev-position">Show the raw entry at position</label>
          <input
            id="dev-position"
            type="text"
            value={position}
            onChange={(e) => {
              setPosition(e.target.value);
            }}
          />
          {byPosition && <pre>{show(byPosition.entry.raw)}</pre>}
        </>
      )}

      <h4>Search probe</h4>
      <p className="muted">
        One GET /search with limit 10, shown raw. It answers whether search results carry
        is_playable and whether search needs another scope.
      </p>
      <label htmlFor="dev-search">Search text</label>
      <input
        id="dev-search"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={query.trim() === ''}
        onClick={() => void runProbe()}
      >
        Search
      </button>
      {probe !== null && <pre>{probe}</pre>}
    </section>
  );
}
