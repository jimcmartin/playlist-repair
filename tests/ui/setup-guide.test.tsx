import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCAL_REDIRECT_URI } from '../../src/config';
import { SetupScreen } from '../../src/ui/SetupScreen';

const plain = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('setup guide', () => {
  it('has the same steps as the Setup screen', () => {
    const guide = readFileSync('docs/setup-guide.md', 'utf8');
    const guideSteps = [...guide.matchAll(/^\d+\. (.+(?:\n {3}.+)*)$/gm)].map((m) =>
      plain(m[1] ?? ''),
    );

    const html = renderToStaticMarkup(
      <SetupScreen redirectUri={LOCAL_REDIRECT_URI} onSave={() => undefined} />,
    );
    const list = /<ol>(.*?)<\/ol>/s.exec(html)?.[1] ?? '';
    const screenSteps = [...list.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => plain(m[1] ?? ''));

    expect(guideSteps.length).toBeGreaterThan(0);
    expect(screenSteps).toEqual(guideSteps);
  });

  it('links to the guide from the Setup screen', () => {
    const html = renderToStaticMarkup(
      <SetupScreen redirectUri={LOCAL_REDIRECT_URI} onSave={() => undefined} />,
    );
    expect(html).toContain('docs/setup-guide.md');
  });
});
