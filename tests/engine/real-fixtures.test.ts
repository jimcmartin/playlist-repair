import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankCandidates, type Candidate, type DeadTrack } from '../../src/engine';

interface RealFixture {
  dead: DeadTrack;
  candidates: Candidate[];
  /** A candidate URI, "none", or null when the case was not marked. */
  correct: string | null;
}

const DIR = join(import.meta.dirname, '../fixtures/real');
const files = readdirSync(DIR).filter((name) => name.endsWith('.json'));

function load(name: string): RealFixture {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as RealFixture;
}

describe('real fixtures', () => {
  it.skipIf(files.length > 0)('has none yet', () => {
    expect(files).toEqual([]);
  });

  it.each(files)('%s is marked', (name) => {
    expect(load(name).correct, 'mark the correct answer, or "none"').not.toBeNull();
  });

  it.each(files)('%s has no wrong match in Exact or High', (name) => {
    const { dead, candidates, correct } = load(name);
    const confident = rankCandidates(dead, candidates).filter(
      (m) => m.tier === 'exact' || m.tier === 'high',
    );
    const wrong = confident.filter((m) => m.candidate.uri !== correct);
    expect(wrong.map((m) => `${m.candidate.title} (${m.tier}, ${m.score.toFixed(3)})`)).toEqual([]);
  });

  // Several releases often carry the same recording, and which one is "right" is a
  // preference, so the marked answer only has to be near the top, not first.
  it.each(files)('%s ranks the right answer in the top 3 when it is found', (name) => {
    const { dead, candidates, correct } = load(name);
    if (correct === null || correct === 'none') return;
    const ranked = rankCandidates(dead, candidates).map((m) => m.candidate.uri);
    if (!ranked.includes(correct)) return;
    expect(ranked.indexOf(correct)).toBeLessThan(3);
  });
});
