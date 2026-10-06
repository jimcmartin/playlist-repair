import type { AuthEnv, FetchLike, KeyValueStore } from '../../src/spotify/auth';

export class MemoryStore implements KeyValueStore {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

export interface FakeCall {
  url: string;
  method: string;
  headers: Headers;
  /** The request body parsed as a form. */
  form: URLSearchParams;
}

type Reply = Response | Error | Promise<Response>;

/** A fetch that records each call and answers with the queued replies in order. */
export function fakeFetch(...replies: Reply[]): { fetch: FetchLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      form: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`Unexpected request to ${url}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetch, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const NOW = 1_800_000_000_000;

export function authEnv(fetch: FetchLike, session = new MemoryStore()): AuthEnv {
  return { session, fetch, crypto: globalThis.crypto, now: () => NOW };
}

// --- Spotify client ------------------------------------------------------------

export interface RoutedCall {
  url: string;
  headers: Headers;
}

/**
 * A fetch that answers by calling `handler` for every request. Unlike
 * `fakeFetch` it does not depend on the order requests arrive in, so it suits
 * tests that run requests at the same time.
 */
export function routedFetch(handler: (call: RoutedCall) => Response | Error | Promise<Response>): {
  fetch: FetchLike;
  calls: RoutedCall[];
  maxInFlight: () => number;
} {
  const calls: RoutedCall[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetch: FetchLike = async (url, init) => {
    const call = { url, headers: new Headers(init?.headers) };
    calls.push(call);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      // Yield once, so overlapping requests really overlap.
      await Promise.resolve();
      const reply = await handler(call);
      if (reply instanceof Error) throw reply;
      return reply;
    } finally {
      inFlight -= 1;
    }
  };
  return { fetch, calls, maxInFlight: () => peak };
}

/** A sleep that returns at once and records how long it was asked to wait. */
export function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

export function tooManyRequests(retryAfter?: string, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
  });
}

export const API = 'https://api.spotify.com/v1';

export function loggedInSession(): MemoryStore {
  const session = new MemoryStore();
  session.setItem(
    'playlist-repair.tokens',
    JSON.stringify({
      accessToken: 'access-0',
      refreshToken: 'refresh-0',
      expiresAt: NOW + 3_600_000,
    }),
  );
  return session;
}
