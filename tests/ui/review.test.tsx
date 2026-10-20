import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../../src/engine';
import { createSearchCache, type FixRow, type FixRun } from '../../src/repair/search';
import type { ScanResult } from '../../src/repair/scan';
import { parseItemsPage, type PlaylistItem } from '../../src/spotify/types';
import { FindFixesPanel } from '../../src/ui/FindFixesPanel';
import { ReviewScreen } from '../../src/ui/ReviewScreen';
import { must } from '../helpers/must';
import { candidate, dead, localFile } from '../helpers/engine';

function itemOf(id: string, extra: Record<string, unknown> = {}): PlaylistItem {
  const page = parseItemsPage({
    items: [
      {
        item: {
          type: 'track',
          id,
          uri: `spotify:track:${id}`,
          name: `Song ${id}`,
          artists: [{ id: `ar-${id}`, name: 'Artist' }],
          album: { id: `al-${id}`, name: 'Album', album_type: 'album' },
          duration_ms: 200_000,
          ...extra,
        },
      },
    ],
  });
  return must(page?.entries[0]?.item);
}

function rowOf(
  position: number,
  deadTrack: FixRow['dead'],
  candidates: ReturnType<typeof candidate>[],
): FixRow {
  return {
    position,
    dead: deadTrack,
    source: itemOf(`dead${String(position)}`),
    matches: rankCandidates(deadTrack, candidates),
    tracks: Object.fromEntries(candidates.map((c) => [c.uri, itemOf(c.uri.split(':')[2] ?? 'x')])),
  };
}

const run: FixRun = {
  playlistId: 'p',
  snapshotId: 's',
  requests: 7,
  stopped: null,
  failed: [],
  rows: [
    rowOf(0, dead({ title: 'Song' }), [candidate({ uri: 'spotify:track:exact' })]),
    rowOf(1, dead({ title: 'Song', isrc: null }), [
      candidate({ uri: 'spotify:track:high', isrc: null }),
      candidate({ uri: 'spotify:track:alt', isrc: null, title: 'Song (Live)' }),
    ]),
    rowOf(2, dead({ title: 'Song', explicit: true, isrc: null }), [
      candidate({ uri: 'spotify:track:clean', isrc: null, explicit: false }),
    ]),
    rowOf(3, localFile({ title: 'Local Song' }), [
      candidate({ uri: 'spotify:track:fromlocal', title: 'Local Song' }),
    ]),
    rowOf(4, dead({ title: 'Song' }), []),
  ],
};

const html = renderToStaticMarkup(
  <ReviewScreen
    playlistName="Road Trip"
    run={run}
    sessionRequests={42}
    presentUris={new Set()}
    onBack={() => undefined}
    onApply={() => undefined}
  />,
);

describe('ReviewScreen notice', () => {
  const noticeHtml = renderToStaticMarkup(
    <ReviewScreen
      playlistName="Road Trip"
      run={run}
      sessionRequests={1}
      notice="Spotify returned an error for 1 track."
      presentUris={new Set()}
      onBack={() => undefined}
      onApply={() => undefined}
    />,
  );

  it('shows why the search was incomplete, above the results', () => {
    expect(noticeHtml).toContain(
      '<p role="alert" class="error">Spotify returned an error for 1 track.</p>',
    );
    expect(noticeHtml).toContain('Exact (1)');
  });

  it('shows no alert when the search was complete', () => {
    expect(html).not.toContain('role="alert"');
  });
});

describe('ReviewScreen', () => {
  it('shows the run and session request counts', () => {
    expect(html).toContain('This run sent 7 requests');
    expect(html).toContain('42 this session');
  });

  it('says nothing has been changed', () => {
    expect(html).toContain('Nothing in your playlist has been changed');
  });

  it('groups rows by tier, with a count in each heading', () => {
    expect(html).toContain('Exact (1)');
    expect(html).toContain('High confidence (2)');
    expect(html).toContain('Needs a look (1)');
    expect(html).toContain('No match (1)');
  });

  it('offers select-all for every group except No match', () => {
    expect(html).toContain('Select all exact');
    expect(html).toContain('Select all high confidence');
    expect(html).toContain('Select all needs a look');
    expect(html).not.toContain('Select all no match');
  });

  it('starts with Exact and High selected, local files and Review not', () => {
    const checked = html.match(/<input[^>]*type="checkbox"[^>]*checked=""/g) ?? [];
    // Two rows start selected (Exact and High), and the Exact group checkbox is fully ticked.
    expect(checked).toHaveLength(3);
    expect(html).toContain('2 replacements selected');
  });

  it('marks a local file', () => {
    expect(html).toContain('Local file');
  });

  it('marks what differs on a row', () => {
    expect(html).toContain('Replacement is clean');
  });

  it('links track, album and artist to Spotify', () => {
    expect(html).toContain('href="https://open.spotify.com/track/exact"');
    expect(html).toContain('href="https://open.spotify.com/album/al-exact"');
    expect(html).toContain('href="https://open.spotify.com/artist/ar-exact"');
  });

  it('opens Spotify links in a new tab, so the review and its results are not lost', () => {
    const links = html.match(/<a [^>]*open\.spotify\.com[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain('target="_blank"');
  });

  it('offers a picker when a row has other candidates', () => {
    expect(html).toContain('Choose a different match (1 more)');
    expect(html).toContain('type="radio"');
  });

  it('says a track with no match stays', () => {
    expect(html).toContain('This track stays where it is');
  });
});

function scanWith(counts: Partial<ScanResult['counts']>): ScanResult {
  return {
    playlistId: 'p',
    snapshotId: 's',
    entries: [],
    counts: { ok: 0, broken: 0, local: 0, ...counts } as ScanResult['counts'],
  };
}

const panel = (overrides: Partial<Parameters<typeof FindFixesPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <FindFixesPanel
      scan={scanWith({ broken: 2, local: 3 })}
      cache={createSearchCache()}
      includeLocal={false}
      onIncludeLocal={() => undefined}
      confirming={false}
      busy={false}
      progress={null}
      run={undefined}
      onAsk={() => undefined}
      onCancel={() => undefined}
      onStart={() => undefined}
      onReview={() => undefined}
      {...overrides}
    />,
  );

describe('FindFixesPanel', () => {
  it('has the local-files checkbox off by default', () => {
    const out = panel();
    expect(out).toContain('Include local files (3)');
    expect(out).not.toContain('checked=""');
  });

  it('shows nothing for a playlist with no broken tracks or local files', () => {
    expect(panel({ scan: scanWith({}) })).toBe('');
  });

  it('hides the checkbox when there are no local files', () => {
    expect(panel({ scan: scanWith({ broken: 1 }) })).not.toContain('Include local files');
  });

  it('shows the estimate before anything is sent', () => {
    const out = panel({ confirming: true });
    expect(out).toContain('Confirm search');
    expect(out).toContain('Finding fixes for 0 tracks');
  });

  it('shows progress with the requests so far', () => {
    const out = panel({ progress: { done: 3, total: 10, requests: 8 } });
    expect(out).toContain('3 of 10 tracks');
    expect(out).toContain('8 requests so far');
  });

  it('shows the last run’s request count and a way back to the review', () => {
    const out = panel({ run });
    expect(out).toContain('5 tracks, 7 requests sent');
    expect(out).toContain('Review fixes');
  });
});
