import { expect, test, type Page } from '@playwright/test';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

const dead = (id: string) => ({
  is_local: false,
  item: {
    type: 'track',
    id,
    uri: `spotify:track:${id}`,
    name: `Song ${id}`,
    artists: [{ id: 'zz', name: 'ZZ Top' }],
    album: { id: 'al', name: 'Eliminator', album_type: 'album' },
    duration_ms: 200_000,
    explicit: false,
    external_ids: { isrc: `USAAA000000${id.toUpperCase()}` },
    is_playable: false,
    restrictions: { reason: 'market' },
  },
});

const found = {
  type: 'track',
  id: 'new',
  uri: 'spotify:track:new',
  name: 'Song a',
  artists: [{ id: 'zz', name: 'ZZ Top' }],
  album: { id: 'al2', name: 'Eliminator', album_type: 'album' },
  duration_ms: 200_000,
  explicit: false,
  external_ids: { isrc: 'USAAA000000A' },
  is_playable: true,
};

/** `failing` lists search queries that answer 504 until it is emptied. */
async function mockSpotify(page: Page, failing: Set<string>) {
  await page.route('https://api.spotify.com/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const url = new URL(request.url());
    if (url.pathname === '/v1/me') {
      await route.fulfill({ headers: CORS, json: { id: 'tester', display_name: 'Test User' } });
    } else if (url.pathname === '/v1/me/playlists') {
      await route.fulfill({
        headers: CORS,
        json: {
          items: [
            {
              id: 'zz',
              name: 'Best ZZ Top',
              collaborative: false,
              snapshot_id: 's',
              owner: { id: 'tester' },
              items: { total: 3 },
              images: [],
            },
          ],
          next: null,
        },
      });
    } else if (url.pathname === '/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      if (failing.has(q)) {
        await route.fulfill({
          status: 504,
          headers: CORS,
          json: { error: { status: 504, message: 'upstream request timeout' } },
        });
      } else {
        await route.fulfill({
          headers: CORS,
          json: { tracks: { items: q.startsWith('isrc:USAAA000000A') ? [found] : [] } },
        });
      }
    } else {
      const items = [dead('a'), dead('b'), dead('c')];
      await route.fulfill({ headers: CORS, json: { items, total: items.length, next: null } });
    }
  });
}

test('Find fixes survives a timeout, shows what was found, and can be run again', async ({
  page,
}) => {
  const failing = new Set(['isrc:USAAA000000B']);
  await mockSpotify(page, failing);
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

  const loads: string[] = [];
  const errors: string[] = [];
  page.on('load', () => loads.push(page.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  const row = page.getByRole('listitem').filter({ hasText: 'Best ZZ Top' });
  await row.getByRole('button', { name: 'Scan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Best ZZ Top' });
  await expect(dialog.getByText('3 broken tracks')).toBeVisible();

  // The estimate is shown in a confirmation first.
  await dialog.getByRole('button', { name: 'Find fixes' }).click();
  await expect(page.getByRole('dialog', { name: 'Search for fixes?' })).toContainText(
    'up to 9 requests',
  );
  await page.getByRole('button', { name: /^Search 3 tracks/ }).click();

  // The timeout fails one track; the others are shown, with their best match.
  await expect(dialog.getByRole('alert')).toContainText('Spotify returned an error for 1 track');
  await expect(dialog.getByText('Song a').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply 1 fix' })).toBeEnabled();

  // Try again after the timeout clears: only the failed track is searched.
  failing.clear();
  await dialog.getByRole('button', { name: 'Find fixes' }).click();
  await page.getByRole('button', { name: /^Search 1 track/ }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  // Everything is searched now, so Find fixes says so instead of offering a search for 0 tracks.
  await dialog.getByRole('button', { name: 'Find fixes' }).click();
  await expect(dialog.getByRole('status')).toContainText(
    'already searched earlier in this session',
  );
  await expect(page.getByRole('dialog', { name: 'Search for fixes?' })).toHaveCount(0);

  expect(errors).toEqual([]);
  // One load, at the start: the page never reloaded.
  expect(loads).toHaveLength(1);
});
