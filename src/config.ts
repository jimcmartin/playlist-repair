export const APP_NAME = 'Playlist Repair';
export const APP_TAGLINE = 'for Spotify';

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const API_BASE_URL = 'https://api.spotify.com/v1';

// Pages the user is sent to by a link. The app never fetches them.
export const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
export const MANAGE_APPS_URL = 'https://www.spotify.com/account/apps/';

export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
] as const;

// Users register these exact values in their own Spotify apps. Do not change them.
export const PRODUCTION_REDIRECT_URI = 'https://playlistrepair.com/';
export const LOCAL_REDIRECT_URI = 'http://127.0.0.1:5173/';

/** The redirect URI for the origin the app is served from, or null if it has none. */
export function redirectUriForOrigin(origin: string): string | null {
  return (
    [PRODUCTION_REDIRECT_URI, LOCAL_REDIRECT_URI].find((uri) => new URL(uri).origin === origin) ??
    null
  );
}

// Only the client ID may go in localStorage. Everything else is sessionStorage.
export const STORAGE_KEYS = {
  clientId: 'playlist-repair.client-id',
  verifier: 'playlist-repair.pkce-verifier',
  state: 'playlist-repair.auth-state',
  tokens: 'playlist-repair.tokens',
} as const;

/** Refresh an access token this long before it expires. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

// --- Spotify client ----------------------------------------------------------

/** Requests in flight at once. Spotify counts its rate limit over a rolling 30 seconds. */
export const MAX_CONCURRENT_REQUESTS = 2;

/** Entries per page for /me/playlists and /playlists/{id}/items. 50 is Spotify's maximum. */
export const PAGE_SIZE = 50;

/** How long to wait after a 429 that has no readable Retry-After header. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;

/** A Retry-After longer than this stops the work instead of waiting silently. */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** How many times one request is retried after a 429 before the work stops. */
export const RATE_LIMIT_MAX_RETRIES = 5;

/** Playlists scanned at once by "Scan all". The client's throttle still applies. */
export const SCAN_ALL_CONCURRENCY = 2;
