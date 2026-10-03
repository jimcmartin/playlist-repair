import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';

describe('placeholder screen', () => {
  it('shows the app name with the tagline outside the heading', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<h1>Playlist Repair</h1>');
    expect(html).toContain('<p>for Spotify</p>');
  });
});
