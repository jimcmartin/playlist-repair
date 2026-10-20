import {
  API_BASE_URL,
  MAX_CONCURRENT_REQUESTS,
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_MAX_WAIT_MS,
} from '../config';
import { AuthError, getAccessToken, readTokens, refreshTokens, type AuthEnv } from './auth';
import { isRecord } from './types';

/** `status` is the HTTP status, or null when the request never got a response. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Spotify answered, but without the fields the app needs. */
export class BadResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadResponseError';
  }
}

/** A 429 with `"reason": "QUOTA_EXCEEDED"`. Waiting a few seconds will not help, so it is never retried. */
export class QuotaExceededError extends Error {
  constructor(path: string, method = 'GET') {
    super(`${method} ${path} was refused: quota exceeded`);
    this.name = 'QuotaExceededError';
  }
}

/** A rate limit the client gave up on: the wait was too long, or it kept coming back. */
export class RateLimitedError extends Error {
  /** How long Spotify asked the app to wait. */
  readonly waitMs: number;

  constructor(path: string, waitMs: number, method = 'GET') {
    super(`${method} ${path} was rate limited`);
    this.name = 'RateLimitedError';
    this.waitMs = waitMs;
  }
}

export type ClientEvent =
  | { type: 'request'; path: string }
  /** `retryAfterMs` is null when the Retry-After header was missing or unreadable. */
  | { type: 'rate-limited'; path: string; retryAfterMs: number | null }
  | { type: 'quota-exceeded'; path: string }
  | { type: 'refresh' };

export type QueryParams = Record<string, string | number | undefined>;

export interface SpotifyClient {
  /** GETs a path under the API base URL and returns the parsed JSON body. */
  get: (path: string, params?: QueryParams) => Promise<unknown>;
  /** Sends a JSON body with POST or DELETE and returns the parsed JSON reply, or null if it had none. */
  send: (method: 'POST' | 'DELETE', path: string, body: unknown) => Promise<unknown>;
}

export interface ClientOptions {
  env: AuthEnv;
  clientId: string;
  sleep: (ms: number) => Promise<void>;
  onEvent?: (event: ClientEvent) => void;
}

// The URL is always built here from the base URL. The client never follows a
// URL taken from a response, so a reply cannot send a request to another host.
function buildUrl(path: string, params: QueryParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  return `${API_BASE_URL}${path}${queryString === '' ? '' : `?${queryString}`}`;
}

function isQuotaExceeded(json: unknown): boolean {
  if (!isRecord(json)) return false;
  if (json.reason === 'QUOTA_EXCEEDED') return true;
  return isRecord(json.error) && json.error.reason === 'QUOTA_EXCEEDED';
}

/** Retry-After is a whole number of seconds. Returns null if it is missing or not one. */
function parseRetryAfter(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export function createClient({ env, clientId, sleep, onEvent }: ClientOptions): SpotifyClient {
  let inFlight = 0;
  const queue: (() => void)[] = [];
  // Set by a 429, so the other slot and the queue wait as well.
  let pausedUntil = 0;

  async function acquire(): Promise<void> {
    if (inFlight < MAX_CONCURRENT_REQUESTS) {
      inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
  }

  function release(): void {
    const next = queue.shift();
    // A waiting request takes over the slot, so the count does not change.
    if (next) next();
    else inFlight -= 1;
  }

  async function run(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: QueryParams,
    body?: unknown,
  ): Promise<unknown> {
    const url = buildUrl(path, params);
    let refreshed = false;
    let rateLimitRetries = 0;

    for (;;) {
      const pause = pausedUntil - env.now();
      if (pause > 0) await sleep(pause);

      const accessToken = await getAccessToken(env, clientId);
      onEvent?.({ type: 'request', path });

      let response: Response;
      let json: unknown;
      try {
        response = await env.fetch(
          url,
          method === 'GET'
            ? { headers: { Authorization: `Bearer ${accessToken}` } }
            : {
                method,
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
              },
        );
        json = await response.json().catch(() => null);
      } catch {
        throw new ApiError(null, `${method} ${path} got no response`);
      }

      if (response.status === 401) {
        if (refreshed) throw new AuthError('session-expired', 'HTTP 401');
        refreshed = true;
        // Another request may have refreshed already. If so, just use its token.
        if (readTokens(env.session)?.accessToken === accessToken) {
          onEvent?.({ type: 'refresh' });
          await refreshTokens(env, clientId);
        }
        continue;
      }

      if (response.status === 429) {
        if (isQuotaExceeded(json)) {
          onEvent?.({ type: 'quota-exceeded', path });
          throw new QuotaExceededError(path, method);
        }
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
        onEvent?.({ type: 'rate-limited', path, retryAfterMs });
        const waitMs = retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS;
        if (waitMs > RATE_LIMIT_MAX_WAIT_MS || rateLimitRetries >= RATE_LIMIT_MAX_RETRIES) {
          throw new RateLimitedError(path, waitMs, method);
        }
        rateLimitRetries += 1;
        pausedUntil = Math.max(pausedUntil, env.now() + waitMs);
        continue;
      }

      if (!response.ok) {
        throw new ApiError(
          response.status,
          `${method} ${path} returned ${String(response.status)}`,
        );
      }
      return json;
    }
  }

  async function queued(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: QueryParams,
    body?: unknown,
  ): Promise<unknown> {
    await acquire();
    try {
      return await run(method, path, params, body);
    } finally {
      release();
    }
  }

  return {
    get: (path, params = {}) => queued('GET', path, params),
    send: (method, path, body) => queued(method, path, {}, body),
  };
}

/** The real timer, for the app. Tests pass their own. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
