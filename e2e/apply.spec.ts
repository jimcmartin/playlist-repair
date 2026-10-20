import { expect, test, type Page } from '@playwright/test';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

const track = (id: string, playable: boolean) => ({
  type: 'track',
  id,
  uri: `spotify:track:${id}`,
  name: id === 'new' ? 'Song a' : `Song ${id}`,
  artists: [{ id: 'zz', name: 'ZZ Top' }],
  album: { id: 'al', name: 'Eliminator', album_type: 'album' },
  duration_ms: 200_000,
  explicit: false,
  external_ids: { isrc: `USAAA000000${id === 'new' ? 'A' : id.toUpperCase()}` },
  is_playable: playable,
  ...(playable ? {} : { restrictions: { reason: 'market' } }),
});
const entry = (id: string, playable = false) => ({
  is_local: false,
  added_at: '2020-01-01T00:00:00Z',
  item: track(id, playable),
});

/** A playlist that applies the writes it receives, and a log of them. */
async function mockSpotify(page: Page, uris: string[], log: string[]) {
  let version = 0;
  await page.route('https://api.spotify.com/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/v1/me') {
      await route.fulfill({ headers: CORS, json: { id: 'tester', display_name: 'Test User' } });
    } else if (path === '/v1/me/playlists') {
      await route.fulfill({
        headers: CORS,
        json: {
          items: [
            {
              id: 'zz',
              name: 'Best ZZ Top',
              collaborative: false,
              snapshot_id: `v${String(version)}`,
              owner: { id: 'tester' },
              items: { total: uris.length },
              images: [],
            },
          ],
          next: null,
        },
      });
    } else if (path === '/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      const items = q.startsWith('isrc:USAAA000000A') ? [track('new', true)] : [];
      await route.fulfill({ headers: CORS, json: { tracks: { items } } });
    } else if (path === '/v1/playlists/zz/items' && request.method() === 'POST') {
      const body = request.postDataJSON() as { uris: string[]; position: number };
      log.push(`POST ${body.uris.join(',')} @${String(body.position)}`);
      uris.splice(body.position, 0, ...body.uris);
      version += 1;
      await route.fulfill({
        status: 201,
        headers: CORS,
        json: { snapshot_id: `v${String(version)}` },
      });
    } else if (path === '/v1/playlists/zz/items' && request.method() === 'DELETE') {
      const body = request.postDataJSON() as { items: { uri: string }[] };
      const gone = body.items.map((i) => i.uri);
      log.push(`DELETE ${gone.join(',')}`);
      for (let i = uris.length - 1; i >= 0; i--)
        if (gone.includes(uris[i] ?? '')) uris.splice(i, 1);
      version += 1;
      await route.fulfill({ headers: CORS, json: { snapshot_id: `v${String(version)}` } });
    } else if (path === '/v1/playlists/zz') {
      await route.fulfill({ headers: CORS, json: { snapshot_id: `v${String(version)}` } });
    } else {
      const items = uris.map((uri) => entry(uri.split(':')[2] ?? '', uri.includes('new')));
      await route.fulfill({ headers: CORS, json: { items, total: items.length, next: null } });
    }
  });
}

test('applies a replacement: backup, insert before remove, verified Done screen', async ({
  page,
}) => {
  const uris = ['spotify:track:b', 'spotify:track:a'];
  const log: string[] = [];
  await mockSpotify(page, uris, log);
  await page.addInitScript((clientId) => {
    localStorage.setItem('playlist-repair.client-id', clientId);
    sessionStorage.setItem(
      'playlist-repair.tokens',
      JSON.stringify({
        accessToken: 'mock-access',
        refreshToken: 'mock-refresh',
        expiresAt: Date.now() + 3_600_000,
      }),
    );
  }, CLIENT_ID);
  await page.goto('/');

  const row = page.getByRole('listitem').filter({ hasText: 'Best ZZ Top' });
  await row.getByRole('button', { name: 'Scan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Best ZZ Top' });
  await expect(dialog.getByText('2 broken tracks')).toBeVisible();
  // Nothing can be applied before fixes are found and ticked.
  await expect(dialog.getByRole('button', { name: 'Apply fixes' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Find fixes' }).click();
  await page.getByRole('button', { name: /^Search 2 tracks/ }).click();
  await expect(dialog.getByRole('button', { name: 'Show all potential fixes' })).toHaveCount(0);

  // The Replace toggle switches the fix off and on, and Apply follows it.
  const toggle = dialog.getByRole('button', { name: /^Replace/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: 'Apply fixes' })).toBeDisabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('button', { name: /^Apply 1 fix/ }).click();
  await expect(page.getByRole('heading', { name: 'Apply changes' })).toBeVisible();
  // Nothing has been written yet.
  expect(log).toEqual([]);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^playlist-repair-Best-ZZ-Top-\d{4}-\d{2}-\d{2}\.json$/,
  );

  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  expect(log).toEqual(['POST spotify:track:new @1', 'DELETE spotify:track:a']);
  expect(uris).toEqual(['spotify:track:b', 'spotify:track:new']);
  await expect(page.getByText(/1 replacement added/)).toBeVisible();

  await page.getByRole('button', { name: 'Back to playlists' }).click();
  await expect(row.getByText('1 broken', { exact: true })).toBeVisible();
});
