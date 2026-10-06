import { AUTHORIZE_URL, SCOPES, STORAGE_KEYS, TOKEN_REFRESH_MARGIN_MS, TOKEN_URL } from '../config';
import { isRecord } from './types';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthEnv {
  /** sessionStorage: the PKCE verifier, the state value and the tokens. */
  session: KeyValueStore;
  fetch: FetchLike;
  crypto: Crypto;
  now: () => number;
}

export type AuthErrorCode =
  | 'denied'
  | 'state-mismatch'
  | 'no-pending-login'
  | 'invalid-client'
  | 'invalid-grant'
  | 'session-expired'
  | 'not-logged-in'
  | 'network'
  | 'bad-response'
  | 'spotify-error';

/** `detail` is Spotify's short error code or an HTTP status. It never holds a token or code. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly detail: string | null;

  constructor(code: AuthErrorCode, detail: string | null = null) {
    super(detail === null ? code : `${code} (${detail})`);
    this.name = 'AuthError';
    this.code = code;
    this.detail = detail;
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

// --- Client ID -------------------------------------------------------------

/** Trims a pasted client ID. Returns null if it cannot be one. */
export function normalizeClientId(input: string): string | null {
  const trimmed = input.trim();
  return /^[0-9a-zA-Z]{32}$/.test(trimmed) ? trimmed : null;
}

export function readClientId(local: KeyValueStore): string | null {
  const stored = local.getItem(STORAGE_KEYS.clientId);
  return stored === null ? null : normalizeClientId(stored);
}

export function saveClientId(local: KeyValueStore, clientId: string): void {
  local.setItem(STORAGE_KEYS.clientId, clientId);
}

// --- PKCE ------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function randomString(crypto: Crypto, byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** A 64-character code verifier. RFC 7636 allows 43 to 128 unreserved characters. */
export function createVerifier(crypto: Crypto): string {
  return randomString(crypto, 48);
}

/** The S256 challenge: the base64url-encoded SHA-256 hash of the verifier. */
export async function createChallenge(crypto: Crypto, verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

export function createState(crypto: Crypto): string {
  return randomString(crypto, 16);
}

// --- Login -----------------------------------------------------------------

/** Stores a new verifier and state, and returns the Spotify URL to send the user to. */
export async function beginLogin(
  env: AuthEnv,
  clientId: string,
  redirectUri: string,
): Promise<string> {
  const verifier = createVerifier(env.crypto);
  const state = createState(env.crypto);
  const challenge = await createChallenge(env.crypto, verifier);
  env.session.setItem(STORAGE_KEYS.verifier, verifier);
  env.session.setItem(STORAGE_KEYS.state, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Handles the query string Spotify redirects back with. Returns 'none' when
 * the query is not a login reply, and 'completed' once tokens are stored.
 * The verifier and state are single-use and are removed whatever happens.
 */
export async function completeLogin(
  env: AuthEnv,
  clientId: string,
  redirectUri: string,
  params: URLSearchParams,
): Promise<'none' | 'completed'> {
  const code = params.get('code');
  const error = params.get('error');
  if (code === null && error === null) return 'none';

  const verifier = env.session.getItem(STORAGE_KEYS.verifier);
  const expectedState = env.session.getItem(STORAGE_KEYS.state);
  env.session.removeItem(STORAGE_KEYS.verifier);
  env.session.removeItem(STORAGE_KEYS.state);

  if (verifier === null || expectedState === null) throw new AuthError('no-pending-login');
  if (params.get('state') !== expectedState) throw new AuthError('state-mismatch');
  if (code === null) {
    throw new AuthError(error === 'access_denied' ? 'denied' : 'spotify-error', error);
  }

  const response = await postToken(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (response.refreshToken === null) throw new AuthError('bad-response');
  writeTokens(env.session, {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: env.now() + response.expiresIn * 1000,
  });
  return 'completed';
}

// --- Tokens ----------------------------------------------------------------

export function readTokens(session: KeyValueStore): Tokens | null {
  const stored = session.getItem(STORAGE_KEYS.tokens);
  if (stored === null) return null;
  try {
    const json: unknown = JSON.parse(stored);
    if (
      isRecord(json) &&
      typeof json.accessToken === 'string' &&
      typeof json.refreshToken === 'string' &&
      typeof json.expiresAt === 'number'
    ) {
      return {
        accessToken: json.accessToken,
        refreshToken: json.refreshToken,
        expiresAt: json.expiresAt,
      };
    }
  } catch {
    // Not JSON: treat it as no session.
  }
  return null;
}

function writeTokens(session: KeyValueStore, tokens: Tokens): void {
  session.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
}

// Spotify replaces the refresh token on use, so two refreshes at once would
// leave one of them holding a dead token. Callers share the request in flight.
const refreshesInFlight = new WeakMap<KeyValueStore, Promise<Tokens>>();

/** Gets a new access token, keeping the old refresh token unless a new one comes back. */
export function refreshTokens(env: AuthEnv, clientId: string): Promise<Tokens> {
  const inFlight = refreshesInFlight.get(env.session);
  if (inFlight) return inFlight;

  const refresh = runRefresh(env, clientId).finally(() => {
    refreshesInFlight.delete(env.session);
  });
  refreshesInFlight.set(env.session, refresh);
  return refresh;
}

async function runRefresh(env: AuthEnv, clientId: string): Promise<Tokens> {
  const current = readTokens(env.session);
  if (current === null) throw new AuthError('not-logged-in');

  let response: TokenResponse;
  try {
    response = await postToken(env, {
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: clientId,
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === 'invalid-grant') {
      // The refresh token is revoked or expired, so the session is over.
      env.session.removeItem(STORAGE_KEYS.tokens);
      throw new AuthError('session-expired', error.detail);
    }
    throw error;
  }

  const tokens: Tokens = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? current.refreshToken,
    expiresAt: env.now() + response.expiresIn * 1000,
  };
  writeTokens(env.session, tokens);
  return tokens;
}

/** Returns an access token that is good for at least the refresh margin. */
export async function getAccessToken(env: AuthEnv, clientId: string): Promise<string> {
  const tokens = readTokens(env.session);
  if (tokens === null) throw new AuthError('not-logged-in');
  if (tokens.expiresAt - env.now() > TOKEN_REFRESH_MARGIN_MS) return tokens.accessToken;
  return (await refreshTokens(env, clientId)).accessToken;
}

/** Forgets the client ID, the tokens and any login in progress. */
export function logout(session: KeyValueStore, local: KeyValueStore): void {
  session.removeItem(STORAGE_KEYS.tokens);
  session.removeItem(STORAGE_KEYS.verifier);
  session.removeItem(STORAGE_KEYS.state);
  local.removeItem(STORAGE_KEYS.clientId);
}

// --- Token endpoint --------------------------------------------------------

interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

function parseTokenResponse(json: unknown): TokenResponse | null {
  if (
    !isRecord(json) ||
    typeof json.access_token !== 'string' ||
    typeof json.expires_in !== 'number'
  ) {
    return null;
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresIn: json.expires_in,
  };
}

async function postToken(env: AuthEnv, form: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  let json: unknown;
  try {
    response = await env.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    json = await response.json().catch(() => null);
  } catch {
    throw new AuthError('network');
  }

  if (!response.ok) {
    const reason =
      isRecord(json) && typeof json.error === 'string'
        ? json.error
        : `HTTP ${String(response.status)}`;
    if (reason === 'invalid_client') throw new AuthError('invalid-client', reason);
    if (reason === 'invalid_grant') throw new AuthError('invalid-grant', reason);
    throw new AuthError('spotify-error', reason);
  }

  const parsed = parseTokenResponse(json);
  if (parsed === null) throw new AuthError('bad-response');
  return parsed;
}
