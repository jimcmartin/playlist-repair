import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../../src/engine';
import { initialSelection } from '../../src/repair/review';
import { createSearchCache, type FixRow, type FixRun } from '../../src/repair/search';
import { buildScanResult, type ScanResult } from '../../src/repair/scan';
import { parseItemsPage, type PlaylistItem } from '../../src/spotify/types';
import { PlaylistDialog } from '../../src/ui/PlaylistDialog';
import { ReviewList } from '../../src/ui/ReviewList';
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
  <ReviewList
    playlistName="Road Trip"
    run={run}
    selection={initialSelection(run.rows)}
    removeAnyway={new Set()}
    presentUris={new Set()}
    onSelection={() => undefined}
    onRemoveAnyway={() => undefined}
  />,
);

describe('ReviewList', () => {
  it('shows no alert', () => {
    expect(html).not.toContain('role="alert"');
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
    // Two rows start switched on (Exact and High), and the Exact group checkbox is fully ticked.
    expect(html.match(/<button[^>]*aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/<button[^>]*aria-pressed="false"/g)).toHaveLength(2);
    expect(html.match(/<input[^>]*type="checkbox"[^>]*checked=""/g)).toHaveLength(1);
  });

  it('puts a Replace toggle only on rows that have a replacement', () => {
    expect(html.match(/class="replace-toggle/g)).toHaveLength(4);
    expect(html).toContain('Replace<span class="visually-hidden"> “Song”</span>');
  });

  it('marks a local file', () => {
    expect(html).toContain('Local file');
  });

  it('marks what differs on a row', () => {
    expect(html).toContain('Replacement is clean');
  });

  it('shows the differences under the replacement, inside its cell', () => {
    // After the replacement's own block, and ending with the cell and the pair closing together.
    const underReplacement =
      /Replacement · Review.*?<ul class="differences"[^>]*>.*?Replacement is clean.*?<\/ul><\/div><\/div>/;
    expect(underReplacement.test(html)).toBe(true);
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

  it('offers all potential fixes when a row has other candidates', () => {
    expect(html).toContain('Show all potential fixes (2)');
    expect(html).toContain('type="radio"');
    // Each candidate is laid out like the other tracks: title, artists, then album and length.
    const picker = html.slice(html.indexOf('class="picker"'));
    expect(picker).toContain('<div class="track-block"><strong>');
    expect(picker).toContain('href="https://open.spotify.com/track/alt"');
  });

  it('says a track with no match stays, and offers to remove it', () => {
    expect(html).toContain('This track stays where it is');
    expect(html).toContain('anyway');
  });
});

const rawEntry = (id: string, extra: Record<string, unknown> = {}, isLocal = false) => ({
  is_local: isLocal,
  item: {
    type: 'track',
    id: isLocal ? null : id,
    uri: isLocal ? `spotify:local:${id}` : `spotify:track:${id}`,
    name: `Song ${id}`,
    artists: [{ id: null, name: 'Artist' }],
    album: { name: 'Album' },
    duration_ms: 200_000,
    ...extra,
  },
});

function scanOf(...entries: ReturnType<typeof rawEntry>[]): ScanResult {
  return buildScanResult('p', 's', parseItemsPage({ items: entries })?.entries ?? []);
}

const problemScan = scanOf(
  rawEntry('ok', { is_playable: true }),
  rawEntry('b1', { is_playable: false, restrictions: { reason: 'market' } }),
  rawEntry('b2', { is_playable: false }),
  rawEntry('l1', {}, true),
  rawEntry('e1', { is_playable: false, restrictions: { reason: 'explicit' } }),
);

const dialog = (overrides: Partial<Parameters<typeof PlaylistDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <PlaylistDialog
      playlistName="Road Trip"
      scan={problemScan}
      cache={createSearchCache()}
      run={undefined}
      selection={{}}
      removeAnyway={new Set()}
      includeLocal={false}
      progress={null}
      confirming={false}
      notice={null}
      onIncludeLocal={() => undefined}
      onAsk={() => undefined}
      onCancelAsk={() => undefined}
      onStart={() => undefined}
      onSelection={() => undefined}
      onRemoveAnyway={() => undefined}
      onApply={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />,
  );

describe('PlaylistDialog before a search', () => {
  it('lists each broken track and local file with what is wrong', () => {
    const out = dialog();
    expect(out).toContain('Song b1');
    expect(out).toContain('Greyed out: not playable in your market');
    expect(out).toContain('Song b2');
    expect(out).toContain('Local file: not in Spotify’s catalog');
    expect(out).not.toContain('Song ok');
    expect(out).toContain('2 broken tracks · 1 local file');
  });

  it('mentions tracks hidden by a setting without listing them as problems', () => {
    const out = dialog();
    expect(out).toContain('1 hidden by your explicit-content setting');
    expect(out).not.toContain('Song e1');
  });

  it('has the local-files checkbox off by default, and Apply disabled', () => {
    const out = dialog();
    expect(out).toContain('Include local files (1)');
    expect(out).not.toMatch(/<input[^>]*checked=""/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Apply fixes<\/button>/);
  });

  it('hides the checkbox when there are no local files', () => {
    const out = dialog({ scan: scanOf(rawEntry('b1', { is_playable: false })) });
    expect(out).not.toContain('Include local files');
  });

  it('shows the request estimate in a confirmation before anything is sent', () => {
    const out = dialog({ confirming: true });
    expect(out).toContain('Search for fixes?');
    expect(out).toContain('Finding fixes for 2 tracks takes');
    expect(out).toContain('up to 4 requests');
  });

  it('counts local files in the estimate only when included', () => {
    expect(dialog({ confirming: true, includeLocal: true })).toContain('up to 6 requests');
  });

  it('shows progress with the requests so far', () => {
    const out = dialog({ progress: { done: 3, total: 10, requests: 8 } });
    expect(out).toContain('3 of 10 tracks');
    expect(out).toContain('8 requests');
  });
});

describe('PlaylistDialog info message', () => {
  it('shows a plain message above the results', () => {
    const out = dialog({ info: 'Every track here was already searched.' });
    expect(out).toContain(
      '<p role="status" class="notice">Every track here was already searched.</p>',
    );
  });
});

describe('PlaylistDialog after a search', () => {
  const scan = scanOf(
    ...Array.from({ length: 5 }, (_, i) =>
      rawEntry(`b${String(i)}`, { is_playable: false, restrictions: { reason: 'market' } }),
    ),
  );

  it('shows the fixes, the request count and what a click will do', () => {
    const out = dialog({ scan, run, selection: initialSelection(run.rows) });
    expect(out).toContain('5 tracks searched using 7 requests');
    expect(out).toContain('nothing in your playlist changes until you apply');
    expect(out).toContain('Exact (1)');
  });

  it('enables Apply once a fix is ticked, and counts them', () => {
    const out = dialog({ scan, run, selection: initialSelection(run.rows) });
    expect(out).toContain('Apply 2 fixes');
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply 2 fixes/);
  });

  it('keeps Apply disabled when nothing is ticked', () => {
    const out = dialog({ scan, run, selection: {} });
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Apply fixes<\/button>/);
  });

  it('shows why the search was incomplete, above the results', () => {
    const out = dialog({ scan, run, notice: 'Spotify returned an error for 1 track.' });
    expect(out).toContain(
      '<p role="alert" class="error">Spotify returned an error for 1 track.</p>',
    );
  });
});
