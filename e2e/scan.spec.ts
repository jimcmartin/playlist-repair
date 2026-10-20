import { expect, test, type Page } from '@playwright/test';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

const playlist = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  collaborative: false,
  snapshot_id: `snap-${id}`,
  owner: { id: 'tester', display_name: 'Test User' },
  items: { total: 3 },
  images: [],
  ...extra,
});

const playable = { item: { type: 'track', id: 'a', uri: 'spotify:track:a', is_playable: true } };
const dead = {
  item: {
    type: 'track',
    id: 'b',
    uri: 'spotify:track:b',
    is_playable: false,
    restrictions: { reason: 'market' },
  },
};
const explicit = {
  item: { type: 'track', id: 'c', is_playable: false, restrictions: { reason: 'explicit' } },
};

const PLAYLISTS: Record<string, unknown[]> = {
  mix: [playable, dead, dead, explicit],
  road: [playable, dead],
};

async function mockSpotify(page: Page) {
  // The page is already logged in through sessionStorage, so only the API is mocked.
  await page.route('https://api.spotify.com/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const { pathname } = new URL(request.url());
    if (pathname === '/v1/me') {
      await route.fulfill({ headers: CORS, json: { id: 'tester', display_name: 'Test User' } });
    } else if (pathname === '/v1/me/playlists') {
      await route.fulfill({
        headers: CORS,
        json: {
          items: [
            playlist('mix', 'Road Trip Mix'),
            playlist('road', 'Shared Drive', {
              collaborative: true,
              owner: { id: 'sam', display_name: 'Sam' },
            }),
            playlist('followed', 'Someone Else', { owner: { id: 'sam' } }),
          ],
          next: null,
        },
      });
    } else {
      const id = pathname.split('/')[3] ?? '';
      const items = PLAYLISTS[id] ?? [];
      await route.fulfill({ headers: CORS, json: { items, total: items.length, next: null } });
    }
  });
}

test.beforeEach(async ({ page }) => {
  await mockSpotify(page);
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
});

test('lists only playlists you own, and says how many are left out', async ({ page }) => {
  await expect(page.getByText('Road Trip Mix')).toBeVisible();
  await expect(page.getByText('Shared Drive')).toHaveCount(0);
  await expect(page.getByText('Someone Else', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/2 playlists owned by someone else/)).toBeVisible();
});

test('shows a status bar with the user, the playlist count and the request count', async ({
  page,
}) => {
  const bar = page.getByRole('region', { name: 'Status' });
  await expect(bar.getByText('Test User')).toBeVisible();
  await expect(bar.getByText('1 playlist found')).toBeVisible();
  const text = (await bar.textContent()) ?? '';
  const before = Number(/(\d+) Spotify API/.exec(text)?.[1]);
  expect(before).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(bar).toContainText(`${String(before + 1)} Spotify API request`);
});

test('filters the playlists as you type', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search playlists' });
  await search.fill('zzz');
  await expect(page.getByText('Road Trip Mix')).toHaveCount(0);
  await expect(page.getByText(/No playlists match/)).toBeVisible();
  await search.fill('road');
  await expect(page.getByText('Road Trip Mix')).toBeVisible();
});

test('scanning a playlist opens a window listing the broken tracks and why', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Road Trip Mix' });
  await row.getByRole('button', { name: 'Scan' }).click();

  const dialog = page.getByRole('dialog', { name: 'Road Trip Mix' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('2 broken tracks · 0 local files')).toBeVisible();
  await expect(dialog.getByText('Greyed out: not playable in your market')).toHaveCount(2);
  await expect(dialog.getByText(/1 hidden by your explicit-content setting/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Find fixes' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply fixes' })).toBeDisabled();

  // Escape closes it, and the row keeps its result and a way back.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row.getByText('2 broken')).toBeVisible();
  await row.getByRole('button', { name: 'Review' }).click();
  await expect(dialog).toBeVisible();
});

test('a playlist with no problems shows a note and no window', async ({ page }) => {
  await page.route('https://api.spotify.com/v1/playlists/mix/items**', (route) =>
    route.fulfill({
      headers: CORS,
      json: { items: [playable], total: 1, next: null },
    }),
  );
  const row = page.getByRole('listitem').filter({ hasText: 'Road Trip Mix' });
  await row.getByRole('button', { name: 'Scan' }).click();
  await expect(row.getByText('No problems')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('scans everything, and shows raw broken entries in the development panel', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Scan all' }).click();
  // Nothing is requested until the estimate is confirmed.
  await expect(page.getByText(/takes about 1 request/)).toBeVisible();
  await page.getByRole('button', { name: 'Scan 1 playlist' }).click();

  await expect(
    page.getByRole('listitem').filter({ hasText: 'Road Trip Mix' }).getByText('2 broken'),
  ).toBeVisible();
  // Scanning everything does not open a window.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const panel = page.getByRole('region', { name: 'Development panel' });
  await expect(panel).toBeVisible();
  await panel.getByText('#1 broken').click();
  await expect(panel.getByText('"reason": "market"').first()).toBeVisible();
});

test('cancelling the Scan all estimate sends no scan requests', async ({ page }) => {
  const itemRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/items')) itemRequests.push(request.url());
  });

  await page.getByRole('button', { name: 'Scan all' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('button', { name: 'Scan all' })).toBeVisible();
  expect(itemRequests).toEqual([]);
});
