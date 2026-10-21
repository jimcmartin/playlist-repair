import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Verification } from '../../src/repair/apply';
import { ApiError, QuotaExceededError } from '../../src/spotify/client';
import { DoneScreen } from '../../src/ui/DoneScreen';
import { describeApplyError, describeStale } from '../../src/ui/messages';

const clean: Verification = {
  entries: [],
  snapshotId: 's',
  replaced: 3,
  removedOnly: 1,
  missing: [],
  deadLeft: [],
  localLeft: [],
  orderOk: true,
  localBlocker: null,
};

const render = (v: Verification) =>
  renderToStaticMarkup(
    <DoneScreen
      playlistId="abc"
      playlistName="Road Trip"
      verification={v}
      onClose={() => undefined}
    />,
  );

describe('DoneScreen', () => {
  it('reports a clean run and links to the playlist', () => {
    const html = render(clean);
    expect(html).toContain('<h2>Done</h2>');
    expect(html).toContain('3 replacements added, 1 track removed');
    expect(html).toContain('https://open.spotify.com/playlist/abc');
    expect(html).not.toContain('role="alert"');
  });

  it('lists local files to delete by hand', () => {
    const html = render({
      ...clean,
      localLeft: [{ title: 'Old Song', artists: ['Artist'] }],
    });
    expect(html).toContain('delete these by hand');
    expect(html).toContain('Old Song · Artist');
    expect(html).toContain('Done, with something to check');
  });

  it('says why local files could not be dropped', () => {
    const html = render({
      ...clean,
      localLeft: [{ title: 'Old Song', artists: ['Artist'] }],
      localBlocker: { kind: 'too-long', count: 143 },
    });
    expect(html).toContain('143 tracks');
    expect(render({ ...clean, localLeft: [{ title: 'A', artists: [] }] })).not.toContain('rewrite');
  });

  it('flags a greyed-out track that is still there', () => {
    const html = render({ ...clean, deadLeft: [{ title: 'Dead', artists: [] }], orderOk: false });
    expect(html).toContain('role="alert"');
    expect(html).toContain('still in');
    expect(html).toContain('does not match what was planned');
  });
});

describe('apply messages', () => {
  it('says nothing is missing when an insert fails', () => {
    const message = describeApplyError(new ApiError(500, 'x'), 'insert', 'Road Trip');
    expect(message).toContain('Nothing was removed from "Road Trip", so no track is missing');
    expect(message).toContain('Choose Resume to continue.');
  });

  it('says replacements are in when a removal stops', () => {
    const message = describeApplyError(new QuotaExceededError('/p', 'DELETE'), 'remove', 'R');
    expect(message).toContain('Every replacement is already in "R"');
    expect(message).toContain('quota');
  });

  it('explains a stale playlist', () => {
    expect(describeStale('R', 1, 2)).toContain('nothing was applied');
    expect(describeStale('R', 0, 0)).not.toContain('no longer');
  });
});
