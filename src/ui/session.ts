import { createClient, realSleep, type SpotifyClient } from '../spotify/client';
import type { BrowserEnv } from './boot';

/** Counters the development panel shows, filled in by the client's events. */
export interface ClientStats {
  requests: number;
  /** One entry per 429: the Retry-After in milliseconds, or null if it had none. */
  rateLimits: (number | null)[];
  quotaStops: number;
  refreshes: number;
}

export function createSessionClient(
  env: BrowserEnv,
  clientId: string,
): { client: SpotifyClient; stats: ClientStats } {
  const stats: ClientStats = { requests: 0, rateLimits: [], quotaStops: 0, refreshes: 0 };
  const client = createClient({
    env,
    clientId,
    sleep: realSleep,
    onEvent: (event) => {
      switch (event.type) {
        case 'request':
          stats.requests += 1;
          break;
        case 'rate-limited':
          stats.rateLimits.push(event.retryAfterMs);
          break;
        case 'quota-exceeded':
          stats.quotaStops += 1;
          break;
        case 'refresh':
          stats.refreshes += 1;
          break;
      }
    },
  });
  return { client, stats };
}
