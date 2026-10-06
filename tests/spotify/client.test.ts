import { describe, expect, it } from 'vitest';
import { AuthError, readTokens } from '../../src/spotify/auth';
import {
  ApiError,
  createClient,
  QuotaExceededError,
  RateLimitedError,
  type ClientEvent,
} from '../../src/spotify/client';
import {
  API,
  authEnv,
  fakeSleep,
  json,
  loggedInSession,
  routedFetch,
  tooManyRequests,
  type RoutedCall,
} from '../helpers/fakes';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function setUp(handler: (call: RoutedCall) => Response | Error | Promise<Response>) {
  const session = loggedInSession();
  const routed = routedFetch(handler);
  const { sleep, waits } = fakeSleep();
  const events: ClientEvent[] = [];
  const client = createClient({
    env: authEnv(routed.fetch, session),
    clientId: CLIENT_ID,
    sleep,
    onEvent: (event) => events.push(event),
  });
  return { client, session, waits, events, ...routed };
}

describe('client', () => {
  it('sends the bearer token to the API host only, with query parameters', async () => {
    const { client, calls } = setUp(() => json({ ok: true }));

    expect(
      await client.get('/me/playlists', { limit: 50, offset: 100, market: undefined }),
    ).toEqual({
      ok: true,
    });

    expect(calls.map((c) => c.url)).toEqual([`${API}/me/playlists?limit=50&offset=100`]);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer access-0');
  });

  it('never has more than 2 requests in flight', async () => {
    const { client, calls, maxInFlight } = setUp(() => json({}));

    await Promise.all(Array.from({ length: 8 }, (_, i) => client.get(`/x/${String(i)}`)));

    expect(calls).toHaveLength(8);
    expect(maxInFlight()).toBe(2);
  });

  it('waits for Retry-After after a 429 and then retries', async () => {
    let n = 0;
    const { client, calls, waits, events } = setUp(() =>
      ++n === 1 ? tooManyRequests('3') : json({ done: true }),
    );

    expect(await client.get('/me')).toEqual({ done: true });

    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3000]);
    expect(events).toContainEqual({ type: 'rate-limited', path: '/me', retryAfterMs: 3000 });
  });

  it('uses a default wait when Retry-After is missing or unreadable', async () => {
    let n = 0;
    const { client, waits, events } = setUp(() => (++n === 1 ? tooManyRequests('soon') : json({})));

    await client.get('/me');

    expect(waits).toEqual([5000]);
    expect(events).toContainEqual({ type: 'rate-limited', path: '/me', retryAfterMs: null });
  });

  it('pauses a request queued behind a 429, not only the one that got it', async () => {
    let limited = false;
    const { client, waits } = setUp((call) => {
      if (call.url.endsWith('/a') && !limited) {
        limited = true;
        return tooManyRequests('2');
      }
      return json({});
    });

    await Promise.all([client.get('/a'), client.get('/b')]);

    // /a waits once after its 429, and /b, which started alongside it, waits too.
    expect(waits.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(1);
  });

  it('stops at once on QUOTA_EXCEEDED, without retrying', async () => {
    const { client, calls, waits } = setUp(() =>
      tooManyRequests('1', { error: { status: 429, reason: 'QUOTA_EXCEEDED' } }),
    );

    await expect(client.get('/me')).rejects.toBeInstanceOf(QuotaExceededError);

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('also reads a top-level QUOTA_EXCEEDED reason', async () => {
    const { client, calls } = setUp(() => tooManyRequests(undefined, { reason: 'QUOTA_EXCEEDED' }));

    await expect(client.get('/me')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(calls).toHaveLength(1);
  });

  it('stops instead of waiting when Retry-After is longer than a minute', async () => {
    const { client, calls, waits } = setUp(() => tooManyRequests('3600'));

    const error: unknown = await client.get('/me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toHaveProperty('waitMs', 3_600_000);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('gives up after 5 retries of a request that keeps getting 429', async () => {
    const { client, calls } = setUp(() => tooManyRequests('1'));

    await expect(client.get('/me')).rejects.toBeInstanceOf(RateLimitedError);

    expect(calls).toHaveLength(6);
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    const { client, calls, session } = setUp((call) => {
      if (call.url === TOKEN_URL) {
        return json({ access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' });
      }
      return call.headers.get('Authorization') === 'Bearer access-1'
        ? json({ id: 'jim' })
        : json({}, 401);
    });

    expect(await client.get('/me')).toEqual({ id: 'jim' });

    expect(calls.map((c) => c.url)).toEqual([`${API}/me`, TOKEN_URL, `${API}/me`]);
    expect(readTokens(session)?.accessToken).toBe('access-1');
  });

  it('ends the session when the retry after a refresh is a 401 too', async () => {
    const { client, calls } = setUp((call) =>
      call.url === TOKEN_URL ? json({ access_token: 'access-1', expires_in: 3600 }) : json({}, 401),
    );

    const error: unknown = await client.get('/me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toHaveProperty('code', 'session-expired');
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('ends the session when the refresh token is rejected', async () => {
    const { client } = setUp((call) =>
      call.url === TOKEN_URL ? json({ error: 'invalid_grant' }, 400) : json({}, 401),
    );

    await expect(client.get('/me')).rejects.toMatchObject({ code: 'session-expired' });
  });

  it('shares one refresh between two requests that both get a 401', async () => {
    const { client, calls } = setUp((call) => {
      if (call.url === TOKEN_URL) {
        return json({ access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' });
      }
      return call.headers.get('Authorization') === 'Bearer access-1' ? json({}) : json({}, 401);
    });

    await Promise.all([client.get('/a'), client.get('/b')]);

    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('reports other statuses and a missing response as ApiError', async () => {
    const forbidden = setUp(() => json({}, 403));
    await expect(forbidden.client.get('/me')).rejects.toMatchObject({ status: 403 });

    const offline = setUp(() => new TypeError('offline'));
    const error: unknown = await offline.client.get('/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toHaveProperty('status', null);
  });

  it('never puts a token in an error message', async () => {
    const { client } = setUp(() => json({}, 500));

    const error = await client.get('/me').catch((e: unknown) => e);

    expect((error as Error).message).not.toMatch(/access-0|refresh-0/);
  });
});
