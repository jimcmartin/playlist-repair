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
