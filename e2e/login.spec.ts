import { expect, test, type Page, type Route } from '@playwright/test';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const APP_URL = 'http://127.0.0.1:5173/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

/** Stands in for Spotify's login page: sends the browser straight back with `reply`. */
async function mockAuthorize(page: Page, reply: string) {
  await page.route('https://accounts.spotify.com/authorize?*', async (route: Route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? '';
    await route.fulfill({
      status: 302,
      headers: { Location: `${APP_URL}?${reply}&state=${state}` },
    });
  });
}

/** Stands in for the token endpoint and GET /me. Returns the token requests it saw. */
async function mockTokenAndProfile(page: Page) {
  const tokenRequests: URLSearchParams[] = [];

  await page.route('https://accounts.spotify.com/api/token', async (route) => {
    tokenRequests.push(new URLSearchParams(route.request().postData() ?? ''));
    await route.fulfill({
      headers: CORS,
      json: {
        access_token: 'mock-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh',
      },
    });
  });
  await page.route('https://api.spotify.com/v1/me', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    await route.fulfill({ headers: CORS, json: { id: 'tester', display_name: 'Test User' } });
  });
  await page.route('https://api.spotify.com/v1/me/playlists?*', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    await route.fulfill({ headers: CORS, json: { items: [], next: null } });
  });

  return tokenRequests;
}

async function saveClientIdAndLogIn(page: Page) {
  await page.getByLabel('Client ID').fill(CLIENT_ID);
  await page.getByRole('button', { name: 'Save client ID' }).click();
  await page.getByRole('button', { name: 'Log in with Spotify' }).click();
}

test('set up, log in, reload and log out', async ({ page }) => {
  await mockAuthorize(page, 'code=mock-code');
  const tokenRequests = await mockTokenAndProfile(page);

  await page.goto('/');
  await expect(page).toHaveTitle('Playlist Repair');
  await expect(page.getByRole('heading', { level: 1, name: 'Playlist Repair' })).toBeVisible();

  await page.getByLabel('Client ID').fill('not a client id');
  await page.getByRole('button', { name: 'Save client ID' }).click();
  await expect(page.getByRole('alert')).toContainText('not a client ID');

  await saveClientIdAndLogIn(page);

  await expect(page.getByText('Connected as Test User')).toBeVisible();
  // The code is gone from the address bar, and was exchanged exactly once.
  expect(page.url()).toBe(APP_URL);
  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0]?.get('code')).toBe('mock-code');
  expect(tokenRequests[0]?.get('redirect_uri')).toBe(APP_URL);
  expect(tokenRequests[0]?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/);

  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    localValues: JSON.stringify(localStorage),
  }));
  expect(stored.local).toEqual(['playlist-repair.client-id']);
  expect(stored.session).toEqual(['playlist-repair.tokens']);
  expect(stored.localValues).not.toContain('mock-');

  await page.reload();
  await expect(page.getByText('Connected as Test User')).toBeVisible();
  expect(tokenRequests).toHaveLength(1);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Set up' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage apps' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Set up' })).toBeVisible();
});

test('a cancelled login returns to Connect with the client ID kept', async ({ page }) => {
  await mockAuthorize(page, 'error=access_denied');

  await page.goto('/');
  await saveClientIdAndLogIn(page);

  await expect(page.getByRole('alert')).toContainText('cancelled');
  await expect(page.getByText(CLIENT_ID)).toBeVisible();
  expect(page.url()).toBe(APP_URL);
});

test('localhost is turned away, because Spotify will not redirect to it', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  await expect(page.getByRole('alert')).toContainText('cannot connect to Spotify from this');
  await expect(page.getByRole('link', { name: APP_URL })).toBeVisible();
});
