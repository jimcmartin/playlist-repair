import { expect, test, type Page } from '@playwright/test';

// Runs against the production build (playwright.prod.config.ts), which is the
// only build that carries the Content Security Policy.

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const APP_URL = 'http://127.0.0.1:5173/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

/** Records every policy violation the page reports, by event and by console message. */
async function watchViolations(page: Page) {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} blocked ${event.blockedURI}`,
      );
    });
  });
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (error.message.includes('Content Security Policy')) violations.push(error.message);
  });
  return violations;
}

async function mockSpotify(page: Page) {
  await page.route('https://accounts.spotify.com/authorize?*', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? '';
    await route.fulfill({
      status: 302,
      headers: { Location: `${APP_URL}?code=mock-code&state=${state}` },
    });
  });
  await page.route('https://accounts.spotify.com/api/token', (route) =>
    route.fulfill({
      headers: CORS,
      json: {
        access_token: 'mock-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh',
      },
    }),
  );
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
            {
              id: 'mix',
              name: 'Road Trip Mix',
              collaborative: false,
              snapshot_id: 'snap-mix',
              owner: { id: 'tester', display_name: 'Test User' },
              items: { total: 2 },
              images: [],
            },
          ],
          next: null,
        },
      });
    } else {
      const items = [
        { item: { type: 'track', id: 'a', uri: 'spotify:track:a', is_playable: true } },
        {
          item: {
            type: 'track',
            id: 'b',
            uri: 'spotify:track:b',
            is_playable: false,
            restrictions: { reason: 'market' },
          },
        },
      ];
      await route.fulfill({ headers: CORS, json: { items, total: items.length, next: null } });
    }
  });
}

test('the production build carries the policy, and nothing in the app breaks it', async ({
  page,
}) => {
  const violations = await watchViolations(page);
  await mockSpotify(page);

  await page.goto('/');
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain('connect-src https://accounts.spotify.com https://api.spotify.com;');
  expect(policy).not.toContain('unsafe-');

  // Setup, login (authorize redirect and token exchange), playlists, scan.
  await page.getByLabel('Client ID').fill(CLIENT_ID);
  await page.getByRole('button', { name: 'Save client ID' }).click();
  await page.getByRole('button', { name: 'Log in with Spotify' }).click();
  await expect(page.getByRole('region', { name: 'Status' })).toContainText(
    'Logged in as Test User',
  );
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Road Trip Mix' });
  await expect(dialog.getByText('1 broken track · 0 local files')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Set up' })).toBeVisible();

  expect(violations).toEqual([]);
});

test('the policy is enforced: other hosts, inline script and inline style are blocked', async ({
  page,
}) => {
  const violations = await watchViolations(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Playlist Repair' })).toBeVisible();

  const outcome = await page.evaluate(async () => {
    const blockedFetch = await fetch('https://example.com/').then(
      () => 'allowed',
      () => 'blocked',
    );
    const script = document.createElement('script');
    script.textContent = 'window.inlineScriptRan = true';
    document.head.append(script);
    const style = document.createElement('style');
    style.textContent = 'body { outline: 5px solid red }';
    document.head.append(style);
    return {
      blockedFetch,
      inlineScriptRan: 'inlineScriptRan' in window,
      inlineStyleApplied: getComputedStyle(document.body).outlineStyle === 'solid',
    };
  });

  expect(outcome).toEqual({
    blockedFetch: 'blocked',
    inlineScriptRan: false,
    inlineStyleApplied: false,
  });
  expect(violations.join('\n')).toContain('connect-src');
  expect(violations.join('\n')).toContain('script-src');
  expect(violations.join('\n')).toContain('style-src');
});
