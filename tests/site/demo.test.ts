import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_POSTER, DEMO_VIDEO, demoSlot } from '../../site/demo.ts';

describe('demoSlot', () => {
  it('shows a marked placeholder while there is no video', () => {
    const html = demoSlot(false);
    expect(html).toContain('Placeholder');
    expect(html).not.toContain('<video');
  });

  it('shows a self-hosted video with a poster once the files exist', () => {
    const html = demoSlot(true);
    expect(html).toContain('<video');
    expect(html).toContain(`src="/${DEMO_VIDEO}"`);
    expect(html).toContain(`poster="/${DEMO_POSTER}"`);
    expect(html).not.toMatch(/https?:|iframe/);
  });
});

describe('the committed poster', () => {
  it('exists and stays under 200 KB', () => {
    const poster = new URL(`../../site/public/${DEMO_POSTER}`, import.meta.url);
    expect(existsSync(poster)).toBe(true);
    expect(statSync(poster).size).toBeLessThan(200 * 1024);
  });
});
