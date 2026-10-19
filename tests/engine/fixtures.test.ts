import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../../src/engine';
import { localCases, streamingCases, type EngineCase } from '../fixtures/engine-cases';

function check(testCase: EngineCase): void {
  const ranked = rankCandidates(testCase.dead, testCase.candidates);
  expect(ranked.map((m) => m.tier)).toEqual(testCase.expectedTiers);
  expect(ranked.find((m) => m.tier !== 'none')?.candidate.uri ?? null).toBe(testCase.best);
}

describe('streaming fixtures', () => {
  it.each(streamingCases)('$name', check);

  it('never preselect a match that is not Exact or High', () => {
    for (const testCase of streamingCases) {
      for (const match of rankCandidates(testCase.dead, testCase.candidates)) {
        expect(match.selected).toBe(match.tier === 'exact' || match.tier === 'high');
      }
    }
  });
});

describe('local file fixtures', () => {
  it.each(localCases)('$name', check);

  it('never reach Exact and are never preselected', () => {
    for (const testCase of localCases) {
      for (const match of rankCandidates(testCase.dead, testCase.candidates)) {
        expect(match.tier).not.toBe('exact');
        expect(match.selected).toBe(false);
      }
    }
  });
});
