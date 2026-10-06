import { redirectUriForOrigin } from '../config';
import {
  completeLogin,
  getAccessToken,
  readClientId,
  readTokens,
  type AuthEnv,
  type KeyValueStore,
} from '../spotify/auth';
import { createClient, realSleep } from '../spotify/client';
import { getProfile } from '../spotify/endpoints';
import type { Profile } from '../spotify/types';
import { describeError, NO_CLIENT_ID_FOR_REPLY } from './messages';

/** The one piece of state that decides which screen shows. */
export type View =
  | { screen: 'wrong-address' }
  | { screen: 'setup'; error?: string; loggedOut?: boolean }
  | { screen: 'connect'; clientId: string; error?: string }
  | { screen: 'playlists'; clientId: string; profile: Profile };

export interface BrowserEnv extends AuthEnv {
  /** localStorage: the client ID only. */
  local: KeyValueStore;
  origin: string;
  /** The query string of the current URL. */
  search: string;
  replaceUrl: (path: string) => void;
}

export function browserEnv(): BrowserEnv {
  return {
    session: window.sessionStorage,
    local: window.localStorage,
    // Wrapped because fetch throws if it is called as a method of another object.
    fetch: (input, init) => window.fetch(input, init),
    crypto: window.crypto,
    now: () => Date.now(),
    origin: window.location.origin,
    search: window.location.search,
    replaceUrl: (path) => {
      window.history.replaceState(null, '', path);
    },
  };
}

/** Works out the first screen: finishes a login, resumes a session, or starts fresh. */
export async function boot(env: BrowserEnv): Promise<View> {
  const redirectUri = redirectUriForOrigin(env.origin);
  if (redirectUri === null) return { screen: 'wrong-address' };

  const params = new URLSearchParams(env.search);
  const isLoginReply = params.has('code') || params.has('error');
  // Take the code out of the address bar and history before anything else.
  if (isLoginReply) env.replaceUrl('/');

  const clientId = readClientId(env.local);
  if (clientId === null) {
    return isLoginReply ? { screen: 'setup', error: NO_CLIENT_ID_FOR_REPLY } : { screen: 'setup' };
  }

  try {
    if (isLoginReply) await completeLogin(env, clientId, redirectUri, params);
    if (readTokens(env.session) === null) return { screen: 'connect', clientId };

    // Refresh up front if the token is stale, so a reload does not start with a 401.
    await getAccessToken(env, clientId);
    const profile = await getProfile(createClient({ env, clientId, sleep: realSleep }));
    return { screen: 'playlists', clientId, profile };
  } catch (error) {
    return { screen: 'connect', clientId, error: describeError(error) };
  }
}
