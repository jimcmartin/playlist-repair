import { expect, test, type Page } from '@playwright/test';

// Runs against the built landing page (playwright.site.config.ts).

const BASE = 'http://127.0.0.1:4173';
const SITE = 'https://playlistrepair.com';

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
  return violations;
}

test('the page loads with its content, no script and no policy violations', async ({ page }) => {
  const violations = await watchViolations(page);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Playlist Repair/);
  await expect(page.getByRole('heading', { level: 1, name: 'Playlist Repair' })).toBeVisible();
  await expect(page.getByText('for Spotify', { exact: true }).first()).toBeVisible();
  for (const name of [
    'See it work',
    'How it works',
    'Why it’s safe',
    'Local files',
    'Get started',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText('Not affiliated with or endorsed by Spotify.')).toBeVisible();
  // The demo slot holds the video when the release asset is present, and the placeholder when not.
  await expect(page.locator('.demo-frame')).toBeVisible();
  if ((await page.locator('video').count()) === 0) {
    await expect(page.getByText('Placeholder', { exact: true })).toBeVisible();
  }

  // No client-side JavaScript, and nothing requested from any other origin.
  expect(await page.locator('script').count()).toBe(0);
  expect(requested.filter((url) => !url.startsWith(`${BASE}/`))).toEqual([]);

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).not.toContain('unsafe-');
  expect(policy).not.toContain('script-src');

  expect(violations).toEqual([]);
});

test('the policy is enforced: scripts, other hosts and inline style are blocked', async ({
  page,
}) => {
  const violations = await watchViolations(page);
  await page.goto('/');

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

test('every internal link, asset and anchor resolves', async ({ page, request }) => {
  await page.goto('/');

  const targets = await page.evaluate(() => {
    const attribute = (selector: string, name: string) =>
      [...document.querySelectorAll(selector)]
        .map((element) => element.getAttribute(name))
        .filter((value): value is string => value !== null);
    return [
      ...attribute('a[href]', 'href'),
      ...attribute('link[href]', 'href'),
      ...attribute('img[src], source[src]', 'src'),
      ...attribute('video[poster]', 'poster'),
      ...attribute('meta[property="og:image"], meta[name="twitter:image"]', 'content'),
    ];
  });

  // The page names its own origin in the canonical and preview URLs. Check those against the local build.
  const local = targets
    .map((target) => (target.startsWith(SITE) ? BASE + target.slice(SITE.length) : target))
    .filter(
      (target) => target.startsWith('/') || target.startsWith('#') || target.startsWith(BASE),
    );
  expect(local.length).toBeGreaterThan(5);

  for (const target of new Set(local)) {
    if (target.startsWith('#')) {
      await expect(page.locator(`[id="${target.slice(1)}"]`), `anchor ${target}`).toHaveCount(1);
      continue;
    }
    const response = await request.get(new URL(target, `${BASE}/`).href);
    expect(response.status(), target).toBe(200);
    if (/\.(svg|png|css|jpg|mp4)$/.test(target)) {
      expect(response.headers()['content-type'], target).not.toContain('text/html');
    }
  }

  // The preview server must answer a file that does not exist with 404, or the loop above proves nothing.
  expect((await request.get(`${BASE}/no-such-file.png`)).status()).toBe(404);

  // Every other link points at the project's GitHub repository.
  const external = targets.filter((target) => /^https?:/.test(target) && !target.startsWith(SITE));
  expect(external.length).toBeGreaterThan(0);
  for (const url of external) {
    expect(url, url).toMatch(/^https:\/\/github\.com\/jimcmartin\/playlist-repair(\/|$)/);
  }
});

test('the sharing tags are present', async ({ page }) => {
  await page.goto('/');
  const content = (selector: string) => page.locator(selector).getAttribute('content');

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE}/`);
  expect(await content('meta[name="description"]')).toBeTruthy();
  expect(await content('meta[property="og:type"]')).toBe('website');
  expect(await content('meta[property="og:site_name"]')).toBe('Playlist Repair');
  expect(await content('meta[property="og:title"]')).toBe('Playlist Repair for Spotify');
  expect(await content('meta[property="og:description"]')).toBeTruthy();
  expect(await content('meta[property="og:url"]')).toBe(`${SITE}/`);
  expect(await content('meta[property="og:image"]')).toBe(`${SITE}/og.png`);
  expect(await content('meta[property="og:image:width"]')).toBe('1200');
  expect(await content('meta[property="og:image:height"]')).toBe('630');
  expect(await content('meta[property="og:image:alt"]')).toBeTruthy();
  expect(await content('meta[name="twitter:card"]')).toBe('summary_large_image');
  expect(await content('meta[name="twitter:title"]')).toBeTruthy();
  expect(await content('meta[name="twitter:image"]')).toBe(`${SITE}/og.png`);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
});

test('the preview image is 1200x630', async ({ request }) => {
  const body = await (await request.get('/og.png')).body();
  expect(body.readUInt32BE(16)).toBe(1200);
  expect(body.readUInt32BE(20)).toBe(630);
});

test('it fits a phone screen and every control is reachable by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The first Tab reaches the skip link, then the two hero buttons, with a visible focus ring.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toBeFocused();
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement ?? document.body).outlineStyle,
  );
  expect(outline).toBe('solid');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Setup guide', exact: true })).toBeFocused();
});
