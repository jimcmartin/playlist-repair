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

test('lists owned and collaborative playlists, and says how many are left out', async ({
  page,
}) => {
  await expect(page.getByText('Road Trip Mix')).toBeVisible();
  await expect(page.getByText('Collaborative, owned by Sam')).toBeVisible();
  await expect(page.getByText('Someone Else')).toHaveCount(0);
  await expect(page.getByText(/1 playlist you follow/)).toBeVisible();
});

test('scans one playlist and shows its broken count', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Road Trip Mix' });
  await row.getByRole('button', { name: 'Scan' }).click();

  await expect(row.getByText('2 broken tracks')).toBeVisible();
  await expect(row.getByText(/1 hidden by your explicit-content setting/)).toBeVisible();
  await expect(row.getByText(/1 good track · 0 local files/)).toBeVisible();
  // The other playlist has not been scanned.
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Shared Drive' })
      .getByText(/broken/),
  ).toHaveCount(0);
});

test('scans everything, and shows raw broken entries in the development panel', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Scan all' }).click();
  // Nothing is requested until the estimate is confirmed.
  await expect(page.getByText(/takes about 2 requests/)).toBeVisible();
  await page.getByRole('button', { name: 'Scan 2 playlists' }).click();

  await expect(
    page.getByRole('listitem').filter({ hasText: 'Road Trip Mix' }).getByText('2 broken tracks'),
  ).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Shared Drive' }).getByText('1 broken track'),
  ).toBeVisible();

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
