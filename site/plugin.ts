import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type Plugin } from 'vite';
import { DEMO_POSTER, DEMO_VIDEO, demoSlot } from './demo.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The page loads nothing but its own stylesheet, images and (later) video. No script at all.
export const SITE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "media-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Reads one custom property from the shared tokens, so the favicon uses the app's colors. */
function token(css: string, name: string): string {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1];
  if (!value) throw new Error(`src/ui/tokens.css has no ${name}.`);
  return value.trim();
}

/** Renders the app's own LogoMark component to static markup, so there is one drawing. */
async function renderLogoMark(): Promise<string> {
  const server = await createServer({
    configFile: false,
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    clearScreen: false,
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const { LogoMark } = await server.ssrLoadModule('/src/ui/LogoMark.tsx');
    if (typeof LogoMark !== 'function') throw new Error('src/ui/LogoMark.tsx exports no LogoMark.');
    return renderToStaticMarkup(createElement(LogoMark as ComponentType));
  } finally {
    await server.close();
  }
}

/** The tile as a standalone SVG: the gradient square with the drawing in white, 5px in on a 64px tile. */
export function tileSvg(logo: string, tokens: string): string {
  const from = token(tokens, '--tile-from');
  const to = token(tokens, '--tile-to');
  const radius = Number.parseFloat(token(tokens, '--tile-radius'));
  const art = logo.replace('<svg ', '<svg x="5" y="5" color="#fff" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="${String(radius)}" fill="url(#tile)"/>${art}</svg>\n`;
}

/**
 * Renders the page at build time: the logo drawing comes from src/ui/LogoMark.tsx, the favicon
 * from the same drawing and the shared tokens, and the demo slot from what exists in site/public.
 */
export function landingPage(): Plugin {
  let logo = '';
  return {
    name: 'landing-page',
    async buildStart() {
      logo = await renderLogoMark();
      const tokens = readFileSync(resolve(repoRoot, 'src/ui/tokens.css'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: tileSvg(logo, tokens) });
      for (const name of ['og.png', 'apple-touch-icon.png']) {
        if (!existsSync(resolve(repoRoot, 'site/public', name))) {
          this.warn(`site/public/${name} is missing. Run npm run site:images.`);
        }
      }
    },
    transformIndexHtml(html) {
      const publicDir = resolve(repoRoot, 'site/public');
      const hasVideo = [DEMO_VIDEO, DEMO_POSTER].every((file) =>
        existsSync(resolve(publicDir, file)),
      );
      return {
        html: html.replace('<!--logo-mark-->', logo).replace('<!--demo-->', demoSlot(hasVideo)),
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: SITE_CONTENT_SECURITY_POLICY,
            },
            injectTo: 'head-prepend',
          },
          {
            tag: 'link',
            attrs: { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
            injectTo: 'head',
          },
        ],
      };
    },
  };
}
