export const APP_NAME = 'Playlist Repair';
export const APP_TAGLINE = 'for Spotify';

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const API_BASE_URL = 'https://api.spotify.com/v1';

// Pages the user is sent to by a link. The app never fetches them.
export const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
export const MANAGE_APPS_URL = 'https://www.spotify.com/account/apps/';
export const SETUP_GUIDE_URL =
  'https://github.com/jimcmartin/playlist-repair/blob/main/docs/setup-guide.md';

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

/** Spotify takes at most 100 URIs in one insert or removal. */
export const WRITE_BATCH_SIZE = 100;

// --- Matching engine ---------------------------------------------------------
// Starting values from the plan. They are tuned against real fixtures in milestone 5.

/** Weight of each score part. They sum to 1. */
export const MATCH_WEIGHTS = { title: 0.3, artists: 0.35, duration: 0.2, album: 0.15 } as const;

/** Score needed for the High and Review tiers. Below `review` a candidate is None. */
export const MATCH_THRESHOLDS = { high: 0.9, review: 0.7 } as const;

/** Exact needs the durations this close, and High needs them within `high`. */
export const MATCH_DURATION_TOLERANCE_MS = { exact: 2_000, high: 3_000 } as const;

/** The duration part is 1 up to `full` apart and falls linearly to 0 at `zero`. */
export const DURATION_SCORE_MS = { full: 2_000, zero: 15_000 } as const;

/** Share of the artists part that comes from the primary artist. The rest is set overlap. */
export const ARTIST_PRIMARY_SHARE = 0.6;

/**
 * An artists part under this holds a candidate at None: a different artist is a
 * cover or a mistake, whatever else matches. An ISRC match (Exact) is not held back.
 */
export const MATCH_MIN_ARTIST_SCORE = 0.3;

/**
 * Title and artist this close mean the same song by the same artist, so the
 * candidate is at least Review even when length and album differ, as a live
 * version does.
 */
export const MATCH_SAME_WORK = { title: 0.9, artists: 0.8 } as const;

/** Two artist names where one holds all the words of the other ("Robben Ford" in "Robben Ford and The Blue Line"). */
export const ARTIST_CONTAINED_NAME_SCORE = 0.9;

/** The shorter name must have at least this many characters to count as contained. */
export const ARTIST_CONTAINED_MIN_LENGTH = 4;

/** An album name holding all the words of the other ("Tribute" in "Randy Rhoads - Tribute") scores this. */
export const ALBUM_CONTAINED_NAME_SCORE = 0.9;

/** The shorter album name must have at least this many characters to count as contained. */
export const ALBUM_CONTAINED_MIN_LENGTH = 6;

/**
 * An album this alike (see `albumNameScore`) is the same album. A "live" marker only the
 * candidate has is then expected, so it does not cap the candidate.
 */
export const MATCH_SAME_ALBUM_SCORE = 0.85;

/** Taken off the score when only one side is a remaster. A remaster never caps the tier. */
export const REMASTER_SCORE_PENALTY = 0.03;

/**
 * A part the dead track has no value for (a local file with bad tags) is scored
 * `value` and counts for `weightFactor` of its normal weight.
 */
export const MISSING_PART = { value: 0.5, weightFactor: 0.5 } as const;

/** A local file's duration is whole seconds, so it can be this far off by rounding alone. */
export const LOCAL_DURATION_ROUNDING_MS = 1_000;

// --- Candidate search --------------------------------------------------------

/** Spotify's cap on results per search request in development mode. */
export const SEARCH_RESULT_LIMIT = 10;

/** The most searches one track costs: ISRC, then title and artist, then plain text. */
export const SEARCH_STEPS_STREAMING = 3;

/** A local file has no ISRC, so it skips the first step. */
export const SEARCH_STEPS_LOCAL = 2;

/** Tracks searched at once. The client's throttle still applies. */
export const SEARCH_CONCURRENCY = 2;
