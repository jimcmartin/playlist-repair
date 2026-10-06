import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../src/config';
import {
  AuthError,
  beginLogin,
  completeLogin,
  createChallenge,
  createState,
  createVerifier,
  getAccessToken,
  logout,
  normalizeClientId,
  readClientId,
  readTokens,
  refreshTokens,
  saveClientId,
  type Tokens,
} from '../../src/spotify/auth';
import { authEnv, fakeFetch, json, MemoryStore, NOW } from '../helpers/fakes';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const REDIRECT_URI = 'http://127.0.0.1:5173/';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const tokenReply = (extra: Record<string, unknown> = {}) =>
  json({ access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, ...extra });

function pendingLogin(session: MemoryStore) {
  session.setItem(STORAGE_KEYS.verifier, 'the-verifier');
  session.setItem(STORAGE_KEYS.state, 'the-state');
}

function storeTokens(session: MemoryStore, tokens: Partial<Tokens> = {}) {
  session.setItem(
    STORAGE_KEYS.tokens,
    JSON.stringify({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: NOW + 3_600_000,
      ...tokens,
    }),
  );
}

async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AuthError)) throw new Error('Expected an AuthError');
  return error;
}

describe('client ID', () => {
  it('trims a pasted ID and rejects anything that is not 32 letters and digits', () => {
    expect(normalizeClientId(`  ${CLIENT_ID}\n`)).toBe(CLIENT_ID);
    expect(normalizeClientId('')).toBeNull();
    expect(normalizeClientId(CLIENT_ID.slice(1))).toBeNull();
    expect(normalizeClientId(`${CLIENT_ID.slice(1)}!`)).toBeNull();
  });

  it('round-trips through the store', () => {
    const local = new MemoryStore();
    expect(readClientId(local)).toBeNull();
    saveClientId(local, CLIENT_ID);
    expect(readClientId(local)).toBe(CLIENT_ID);
  });
});

describe('PKCE', () => {
  it('creates a 64-character verifier from the unreserved characters', () => {
    expect(createVerifier(globalThis.crypto)).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it('creates a different verifier and state every time', () => {
    expect(createVerifier(globalThis.crypto)).not.toBe(createVerifier(globalThis.crypto));
    expect(createState(globalThis.crypto)).not.toBe(createState(globalThis.crypto));
  });

  it('derives the S256 challenge from RFC 7636 appendix B', async () => {
    const challenge = await createChallenge(
      globalThis.crypto,
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('beginLogin', () => {
  it('builds the authorize URL and stores the verifier and state', async () => {
    const env = authEnv(fakeFetch().fetch);
    const url = new URL(await beginLogin(env, CLIENT_ID, REDIRECT_URI));
    const verifier = env.session.getItem(STORAGE_KEYS.verifier) ?? '';

    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      state: env.session.getItem(STORAGE_KEYS.state),
      scope:
        'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public',
      code_challenge_method: 'S256',
      code_challenge: await createChallenge(globalThis.crypto, verifier),
    });
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // The verifier itself never goes in the URL.
    expect(url.href).not.toContain(verifier);
  });
});

describe('completeLogin', () => {
  const reply = (query: string) => new URLSearchParams(query);

  it('does nothing when the URL is not a login reply', async () => {
    const { fetch, calls } = fakeFetch();
    const session = new MemoryStore();
    pendingLogin(session);

    const result = await completeLogin(authEnv(fetch, session), CLIENT_ID, REDIRECT_URI, reply(''));

    expect(result).toBe('none');
    expect(calls).toHaveLength(0);
    expect(session.getItem(STORAGE_KEYS.verifier)).toBe('the-verifier');
  });

  it('exchanges the code, stores the tokens and clears the verifier and state', async () => {
    const { fetch, calls } = fakeFetch(tokenReply({ refresh_token: 'refresh-1' }));
    const session = new MemoryStore();
    pendingLogin(session);

    const result = await completeLogin(
      authEnv(fetch, session),
      CLIENT_ID,
      REDIRECT_URI,
      reply('code=the-code&state=the-state'),
    );

    expect(result).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TOKEN_URL);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(calls[0]?.headers.has('Authorization')).toBe(false);
    expect(Object.fromEntries(calls[0]?.form ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: 'the-verifier',
    });
    expect(readTokens(session)).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: NOW + 3_600_000,
    });
    expect([...session.items.keys()]).toEqual([STORAGE_KEYS.tokens]);
  });

  it.each([
    ['a different state', 'code=the-code&state=someone-elses'],
    ['no state', 'code=the-code'],
  ])('rejects a reply with %s without calling Spotify', async (_name, query) => {
    const { fetch, calls } = fakeFetch();
    const session = new MemoryStore();
    pendingLogin(session);

    const error = await rejection(
      completeLogin(authEnv(fetch, session), CLIENT_ID, REDIRECT_URI, reply(query)),
    );

    expect(error.code).toBe('state-mismatch');
    expect(calls).toHaveLength(0);
    expect(session.items.size).toBe(0);
  });

  it('rejects a reply when this tab has no login in progress', async () => {
    const { fetch, calls } = fakeFetch();

    const error = await rejection(
      completeLogin(authEnv(fetch), CLIENT_ID, REDIRECT_URI, reply('code=the-code&state=x')),
    );

    expect(error.code).toBe('no-pending-login');
    expect(calls).toHaveLength(0);
  });

  it('reports a cancelled login and clears the verifier and state', async () => {
    const { fetch, calls } = fakeFetch();
    const session = new MemoryStore();
    pendingLogin(session);

    const error = await rejection(
      completeLogin(
        authEnv(fetch, session),
        CLIENT_ID,
        REDIRECT_URI,
        reply('error=access_denied&state=the-state'),
      ),
    );

    expect(error.code).toBe('denied');
    expect(calls).toHaveLength(0);
    expect(session.items.size).toBe(0);
  });

  it('checks the state before trusting an error in the reply', async () => {
    const session = new MemoryStore();
    pendingLogin(session);

    const error = await rejection(
      completeLogin(
        authEnv(fakeFetch().fetch, session),
        CLIENT_ID,
        REDIRECT_URI,
        reply('error=access_denied&state=forged'),
      ),
    );

    expect(error.code).toBe('state-mismatch');
  });

  it.each([
    ['invalid_client', 'invalid-client'],
    ['invalid_grant', 'invalid-grant'],
    ['server_error', 'spotify-error'],
  ])('maps a %s reply from the token endpoint to %s', async (spotifyError, code) => {
    const { fetch } = fakeFetch(json({ error: spotifyError, error_description: 'nope' }, 400));
    const session = new MemoryStore();
    pendingLogin(session);

    const error = await rejection(
      completeLogin(
        authEnv(fetch, session),
        CLIENT_ID,
        REDIRECT_URI,
        reply('code=the-code&state=the-state'),
      ),
    );

    expect(error.code).toBe(code);
    expect(error.detail).toBe(spotifyError);
    expect(readTokens(session)).toBeNull();
  });

  it('reports a network failure without leaking the code or verifier', async () => {
    const { fetch } = fakeFetch(new TypeError('Failed to fetch the-code the-verifier'));
    const session = new MemoryStore();
    pendingLogin(session);

    const error = await rejection(
      completeLogin(
        authEnv(fetch, session),
        CLIENT_ID,
        REDIRECT_URI,
        reply('code=the-code&state=the-state'),
      ),
    );

    expect(error.code).toBe('network');
    expect(error.message).not.toMatch(/the-code|the-verifier/);
  });

  it.each([
    ['no access token', { token_type: 'Bearer', expires_in: 3600, refresh_token: 'r' }],
    ['no refresh token', { access_token: 'a', token_type: 'Bearer', expires_in: 3600 }],
    ['no expiry', { access_token: 'a', token_type: 'Bearer', refresh_token: 'r' }],
  ])('rejects a token reply with %s', async (_name, body) => {
    const session = new MemoryStore();
    pendingLogin(session);

    const error = await rejection(
      completeLogin(
        authEnv(fakeFetch(json(body)).fetch, session),
        CLIENT_ID,
        REDIRECT_URI,
        reply('code=the-code&state=the-state'),
      ),
    );

    expect(error.code).toBe('bad-response');
    expect(readTokens(session)).toBeNull();
  });
});

describe('readTokens', () => {
  it('treats missing, malformed or incomplete data as no session', () => {
    const session = new MemoryStore();
    expect(readTokens(session)).toBeNull();
    session.setItem(STORAGE_KEYS.tokens, 'not json');
    expect(readTokens(session)).toBeNull();
    session.setItem(STORAGE_KEYS.tokens, JSON.stringify({ accessToken: 'a' }));
    expect(readTokens(session)).toBeNull();
  });
});

describe('refreshTokens', () => {
  it('sends the refresh token and client ID, with no secret', async () => {
    const { fetch, calls } = fakeFetch(tokenReply());
    const session = new MemoryStore();
    storeTokens(session);

    await refreshTokens(authEnv(fetch, session), CLIENT_ID);

    expect(calls[0]?.url).toBe(TOKEN_URL);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.has('Authorization')).toBe(false);
    expect(Object.fromEntries(calls[0]?.form ?? [])).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: CLIENT_ID,
    });
  });

  it('keeps the old refresh token when Spotify does not send a new one', async () => {
    const session = new MemoryStore();
    storeTokens(session);

    const tokens = await refreshTokens(authEnv(fakeFetch(tokenReply()).fetch, session), CLIENT_ID);

    const expected = {
      accessToken: 'access-1',
      refreshToken: 'old-refresh',
      expiresAt: NOW + 3_600_000,
    };
    expect(tokens).toEqual(expected);
    expect(readTokens(session)).toEqual(expected);
  });

  it('stores a new refresh token when one comes back', async () => {
    const session = new MemoryStore();
    storeTokens(session);

    await refreshTokens(
      authEnv(fakeFetch(tokenReply({ refresh_token: 'new-refresh' })).fetch, session),
      CLIENT_ID,
    );

    expect(readTokens(session)?.refreshToken).toBe('new-refresh');
  });

  it('ends the session when Spotify rejects the refresh token', async () => {
    const session = new MemoryStore();
    storeTokens(session);

    const error = await rejection(
      refreshTokens(
        authEnv(fakeFetch(json({ error: 'invalid_grant' }, 400)).fetch, session),
        CLIENT_ID,
      ),
    );

    expect(error.code).toBe('session-expired');
    expect(readTokens(session)).toBeNull();
  });

  it('keeps the tokens when the refresh fails for a passing reason', async () => {
    const session = new MemoryStore();
    storeTokens(session);

    const offline = await rejection(
      refreshTokens(authEnv(fakeFetch(new TypeError('offline')).fetch, session), CLIENT_ID),
    );
    const busy = await rejection(
      refreshTokens(
        authEnv(fakeFetch(new Response('', { status: 503 })).fetch, session),
        CLIENT_ID,
      ),
    );

    expect(offline.code).toBe('network');
    expect(busy.code).toBe('spotify-error');
    expect(busy.detail).toBe('HTTP 503');
    expect(readTokens(session)?.refreshToken).toBe('old-refresh');
  });

  it('fails without calling Spotify when there is no session', async () => {
    const { fetch, calls } = fakeFetch();

    const error = await rejection(refreshTokens(authEnv(fetch), CLIENT_ID));

    expect(error.code).toBe('not-logged-in');
    expect(calls).toHaveLength(0);
  });

  it('shares one request between callers that refresh at the same time', async () => {
    const { fetch, calls } = fakeFetch(
      tokenReply({ refresh_token: 'new-refresh' }),
      tokenReply({ access_token: 'access-2' }),
    );
    const session = new MemoryStore();
    storeTokens(session);
    const env = authEnv(fetch, session);

    const [first, second] = await Promise.all([
      refreshTokens(env, CLIENT_ID),
      refreshTokens(env, CLIENT_ID),
    ]);

    expect(calls).toHaveLength(1);
    expect(first).toEqual(second);

    // Once it settles, the next refresh is a new request with the new token.
    const third = await refreshTokens(env, CLIENT_ID);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.form.get('refresh_token')).toBe('new-refresh');
    expect(third.accessToken).toBe('access-2');
  });
});

describe('getAccessToken', () => {
  it('returns the stored token while it is fresh', async () => {
    const { fetch, calls } = fakeFetch();
    const session = new MemoryStore();
    storeTokens(session, { expiresAt: NOW + 61_000 });

    expect(await getAccessToken(authEnv(fetch, session), CLIENT_ID)).toBe('old-access');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['about to expire', NOW + 60_000],
    ['expired', NOW - 1],
  ])('refreshes a token that is %s', async (_name, expiresAt) => {
    const { fetch, calls } = fakeFetch(tokenReply());
    const session = new MemoryStore();
    storeTokens(session, { expiresAt });

    expect(await getAccessToken(authEnv(fetch, session), CLIENT_ID)).toBe('access-1');
    expect(calls).toHaveLength(1);
  });

  it('fails when there is no session', async () => {
    const error = await rejection(getAccessToken(authEnv(fakeFetch().fetch), CLIENT_ID));
    expect(error.code).toBe('not-logged-in');
  });
});

describe('logout', () => {
  it('removes the client ID, the tokens and any login in progress, and nothing else', () => {
    const session = new MemoryStore();
    const local = new MemoryStore();
    pendingLogin(session);
    storeTokens(session);
    saveClientId(local, CLIENT_ID);
    session.setItem('someone-elses-key', 'kept');
    local.setItem('someone-elses-key', 'kept');

    logout(session, local);

    expect([...session.items.keys()]).toEqual(['someone-elses-key']);
    expect([...local.items.keys()]).toEqual(['someone-elses-key']);
  });
});
