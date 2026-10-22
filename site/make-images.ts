// Makes the two PNGs the page needs: the 1200x630 preview image and the 180x180
// apple-touch icon. Run it with `npm run site:images` and commit the result.
// Both come from the built favicon.svg (the logo tile) and src/ui/tokens.css, so they
// follow the app's drawing and colors. They are committed, not rebuilt on every deploy,
// because the text is drawn with the machine's own fonts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoPath = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const faviconPath = repoPath('dist-site/favicon.svg');
if (!existsSync(faviconPath)) {
  throw new Error('dist-site/favicon.svg is missing. Run npm run site:images, not this file.');
}
const tile = readFileSync(faviconPath, 'utf8');
const tokens = readFileSync(repoPath('src/ui/tokens.css'), 'utf8');

const previewPage = `<!doctype html><style>${tokens}
  body { margin: 0; width: 1200px; height: 630px; display: flex; align-items: center; gap: 64px; padding: 0 110px; box-sizing: border-box;
    background: radial-gradient(ellipse 70% 70% at 25% 0%, rgba(94, 106, 210, 0.45), transparent 70%), var(--bg); }
  .tile { flex: none; width: 260px; height: 260px; filter: drop-shadow(0 12px 40px rgba(94, 106, 210, 0.5)); }
  .tile svg { width: 100%; height: 100%; display: block; }
  h1 { margin: 0; font-size: 104px; line-height: 1.05; font-weight: 600; letter-spacing: -0.03em; }
  p { margin: 12px 0 0; font-size: 48px; color: var(--muted); }
</style>
<div class="tile">${tile}</div>
<div><h1>Playlist Repair</h1><p>for Spotify</p></div>`;

// iOS rounds the corners itself, so the icon is a full square.
const iconPage = `<!doctype html><style>
  body { margin: 0; width: 180px; height: 180px; }
  svg { width: 180px; height: 180px; display: block; }
</style>${tile.replace(/ rx="[\d.]+"/, ' rx="0"')}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(previewPage);
  writeFileSync(repoPath('site/public/og.png'), await page.screenshot());

  await page.setViewportSize({ width: 180, height: 180 });
  await page.setContent(iconPage);
  writeFileSync(repoPath('site/public/apple-touch-icon.png'), await page.screenshot());
} finally {
  await browser.close();
}
console.log('Wrote site/public/og.png and site/public/apple-touch-icon.png.');
