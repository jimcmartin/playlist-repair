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
