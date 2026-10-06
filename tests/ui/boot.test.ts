import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../src/config';
import { readTokens } from '../../src/spotify/auth';
import { boot, type BrowserEnv } from '../../src/ui/boot';
import { authEnv, fakeFetch, json, MemoryStore, NOW } from '../helpers/fakes';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const ME_URL = 'https://api.spotify.com/v1/me';

function setUp(options: { search?: string; origin?: string; replies?: (Response | Error)[] }) {
  const { fetch, calls } = fakeFetch(...(options.replies ?? []));
  const local = new MemoryStore();
  const session = new MemoryStore();
  const replaced: string[] = [];
  const env: BrowserEnv = {
    ...authEnv(fetch, session),
    local,
    origin: options.origin ?? 'http://127.0.0.1:5173',
    search: options.search ?? '',
    replaceUrl: (path) => replaced.push(path),
  };
  return { env, local, session, calls, replaced };
}

function logIn(session: MemoryStore, expiresAt = NOW + 3_600_000) {
  session.setItem(
    STORAGE_KEYS.tokens,
    JSON.stringify({ accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt }),
  );
}

describe('boot', () => {
  it('starts on Setup when no client ID is saved', async () => {
    const { env, calls, replaced } = setUp({});

    expect(await boot(env)).toEqual({ screen: 'setup' });
    expect(calls).toHaveLength(0);
    expect(replaced).toEqual([]);
  });

  it('starts on Connect when a client ID is saved but nobody is logged in', async () => {
    const { env, local, calls } = setUp({});
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);

    expect(await boot(env)).toEqual({ screen: 'connect', clientId: CLIENT_ID });
    expect(calls).toHaveLength(0);
  });

  it('finishes a login: exchanges the code, cleans the URL and loads the profile', async () => {
    const { env, local, session, calls, replaced } = setUp({
      search: '?code=the-code&state=the-state',
      replies: [
        json({ access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' }),
        json({ id: 'jim', display_name: 'Jim M' }),
      ],
    });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    session.setItem(STORAGE_KEYS.verifier, 'the-verifier');
    session.setItem(STORAGE_KEYS.state, 'the-state');

    const view = await boot(env);

    expect(view).toEqual({
      screen: 'connected',
      clientId: CLIENT_ID,
      profile: { id: 'jim', displayName: 'Jim M' },
    });
    expect(replaced).toEqual(['/']);
    expect(calls.map((call) => call.url)).toEqual([
      'https://accounts.spotify.com/api/token',
      ME_URL,
    ]);
    expect(calls[1]?.headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('cleans the URL and shows why when the state does not match', async () => {
    const { env, local, session, calls, replaced } = setUp({
      search: '?code=the-code&state=forged',
    });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    session.setItem(STORAGE_KEYS.verifier, 'the-verifier');
    session.setItem(STORAGE_KEYS.state, 'the-state');

    const view = await boot(env);

    expect(view).toMatchObject({ screen: 'connect', clientId: CLIENT_ID });
    expect(view).toHaveProperty('error', expect.stringContaining('did not match'));
    expect(replaced).toEqual(['/']);
    expect(calls).toHaveLength(0);
  });

  it('shows a cancelled login on Connect', async () => {
    const { env, local, session } = setUp({ search: '?error=access_denied&state=the-state' });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    session.setItem(STORAGE_KEYS.verifier, 'the-verifier');
    session.setItem(STORAGE_KEYS.state, 'the-state');

    expect(await boot(env)).toHaveProperty('error', expect.stringContaining('cancelled'));
  });

  it('ignores a login reply when no client ID is saved', async () => {
    const { env, calls, replaced } = setUp({ search: '?code=the-code&state=the-state' });

    const view = await boot(env);

    expect(view).toMatchObject({ screen: 'setup' });
    expect(view).toHaveProperty('error', expect.stringContaining('no client ID'));
    expect(replaced).toEqual(['/']);
    expect(calls).toHaveLength(0);
  });

  it('keeps the session across a reload', async () => {
    const { env, local, session, calls } = setUp({
      replies: [json({ id: 'jim', display_name: null })],
    });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    logIn(session);

    const view = await boot(env);

    // With no display name, the user ID stands in.
    expect(view).toMatchObject({ screen: 'connected', profile: { displayName: 'jim' } });
    expect(calls.map((call) => call.url)).toEqual([ME_URL]);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer access-0');
  });

  it('refreshes an expired token on reload before loading the profile', async () => {
    const { env, local, session, calls } = setUp({
      replies: [
        json({ access_token: 'access-1', expires_in: 3600 }),
        json({ id: 'jim', display_name: 'Jim M' }),
      ],
    });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    logIn(session, NOW - 1);

    expect(await boot(env)).toMatchObject({ screen: 'connected' });
    expect(calls[1]?.headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('keeps the login when the profile cannot be loaded, and says what to do', async () => {
    const { env, local, session } = setUp({ replies: [json({ error: { status: 403 } }, 403)] });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    logIn(session);

    const view = await boot(env);

    expect(view).toMatchObject({ screen: 'connect' });
    expect(view).toHaveProperty('error', expect.stringContaining('User Management'));
    expect(readTokens(session)).not.toBeNull();
  });

  it('never puts a token in an error message', async () => {
    const { env, local, session } = setUp({ replies: [new TypeError('offline')] });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);
    logIn(session);

    const view = await boot(env);

    expect(JSON.stringify(view)).not.toMatch(/access-0|refresh-0/);
  });

  it('refuses to start a login from an address Spotify will not redirect to', async () => {
    const { env, local } = setUp({ origin: 'http://localhost:5173' });
    local.setItem(STORAGE_KEYS.clientId, CLIENT_ID);

    expect(await boot(env)).toEqual({ screen: 'wrong-address' });
  });
});
