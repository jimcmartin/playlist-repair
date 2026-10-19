import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = join(import.meta.dirname, '../../src/engine');
const files = readdirSync(ENGINE_DIR, { recursive: true, encoding: 'utf8' }).filter((f) =>
  /\.tsx?$/.test(f),
);

/** Strip comments so a word in documentation does not trip the checks. */
function code(file: string): string {
  return readFileSync(join(ENGINE_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function specifiers(source: string): string[] {
  const found = [
    ...source.matchAll(/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  return found.map((m) => m[1] ?? '');
}

describe('src/engine boundaries', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports only from the engine folder or config', (file) => {
    for (const spec of specifiers(code(file))) {
      expect(spec, `${file} imports ${spec}`).toMatch(/^(\.\/[\w-]+|\.\.\/config)$/);
    }
  });

  it.each(files)('%s uses no network or DOM APIs', (file) => {
    const forbidden =
      /\b(fetch|XMLHttpRequest|WebSocket|EventSource|document|window|navigator|location|localStorage|sessionStorage|indexedDB|globalThis|self)\b/;
    expect(code(file)).not.toMatch(forbidden);
  });
});
