import { describe, expect, it } from 'vitest';
import { describeSearchError, describeSearchFailures } from '../../src/ui/messages';
import { ApiError } from '../../src/spotify/client';

describe('describeSearchFailures', () => {
  it('says what happened, what was kept and what to do', () => {
    const message = describeSearchFailures(2, 5, 'Best ZZ Top');
    expect(message).toContain('2 tracks in "Best ZZ Top"');
    expect(message).toContain('Nothing in your playlist was changed');
    expect(message).toContain('The other 5 are shown below');
    expect(message).toContain('Choose Find fixes again');
  });

  it('uses the singular for one track', () => {
    const message = describeSearchFailures(1, 1, 'P');
    expect(message).toContain('1 track in "P", so it was not searched');
    expect(message).toContain('The other 1 is shown');
  });
});

describe('describeSearchError', () => {
  it('uses the singular for one kept track', () => {
    const message = describeSearchError(new ApiError(503, 'x'), 1, 'P');
    expect(message).toContain('The 1 track already searched in "P" is kept');
  });
});
