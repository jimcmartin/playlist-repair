import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import type { View } from '../src/ui/boot';
import { MemoryStore } from './helpers/fakes';

const REDIRECT_URI = 'http://127.0.0.1:5173/';
const CLIENT_ID = '0123456789abcdef0123456789abcdef';

const render = (initial: View) =>
  renderToStaticMarkup(<App initial={initial} redirectUri={REDIRECT_URI} />);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the app name with the tagline outside the heading', () => {
    const html = render({ screen: 'setup' });

    expect(html).toContain('<h1>Playlist Repair</h1>');
    expect(html).toContain('<p class="tagline">for Spotify</p>');
  });

  it('shows the redirect URI to register on Setup, and never asks for a secret', () => {
    const html = render({ screen: 'setup' });

    expect(html).toContain(`<code>${REDIRECT_URI}</code>`);
    expect(html).toContain('Do not copy the client secret');
    expect(html.match(/<input/g)).toHaveLength(1);
  });

  it('links to Manage apps after logging out', () => {
    const html = render({ screen: 'setup', loggedOut: true });

    expect(html).toContain('href="https://www.spotify.com/account/apps/"');
  });

  it('shows an error on Connect as an alert', () => {
    const html = render({ screen: 'connect', clientId: CLIENT_ID, error: 'It broke.' });

    expect(html).toContain('<p role="alert" class="error">It broke.</p>');
    expect(html).toContain('Log in with Spotify');
  });

  it('shows the display name on the Playlists screen', () => {
    // The screen builds its client from the browser's storage and fetch.
    vi.stubGlobal('window', {
      sessionStorage: new MemoryStore(),
      localStorage: new MemoryStore(),
      fetch: vi.fn(),
      crypto: globalThis.crypto,
      location: { origin: 'http://127.0.0.1:5173', search: '' },
    });
    const html = render({
      screen: 'playlists',
      clientId: CLIENT_ID,
      profile: { id: 'jim', displayName: 'Jim M' },
    });

    expect(html).toContain('<strong>Jim M</strong>');
    expect(html).toContain('Loading your playlists');
    expect(html).toContain('Log out');
  });
});
