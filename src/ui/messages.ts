import { AuthError } from '../spotify/auth';
import {
  ApiError,
  BadResponseError,
  QuotaExceededError,
  RateLimitedError,
} from '../spotify/client';

// Every message says what happened, what was kept, and what to do next.

const ID_KEPT = 'Your client ID is still saved.';
const BOTH_KEPT = 'Your client ID and login were kept.';
const LOG_IN_AGAIN = 'Choose "Log in with Spotify" to try again.';

export const NO_CLIENT_ID_FOR_REPLY =
  'Spotify sent back a login reply, but no client ID is saved in this browser, so the reply was ignored. Nothing was changed. Enter your client ID to start again.';

export function describeError(error: unknown): string {
  if (error instanceof AuthError) return describeAuthError(error);
  if (error instanceof ApiError) return describeApiError(error);
  if (error instanceof QuotaExceededError || error instanceof RateLimitedError) {
    return `Spotify is limiting requests from this app right now, so loading your profile stopped. ${BOTH_KEPT} Wait a few minutes, then reload the page.`;
  }
  if (error instanceof BadResponseError) {
    return `Spotify returned an unexpected reply while loading your profile. ${BOTH_KEPT} Reload the page to try again.`;
  }
  return `Something unexpected went wrong while connecting. ${ID_KEPT} Reload the page to try again.`;
}

function describeAuthError(error: AuthError): string {
  const detail = error.detail === null ? '' : ` (${error.detail})`;
  switch (error.code) {
    case 'denied':
      return `The Spotify login was cancelled, so nothing is connected. ${ID_KEPT} ${LOG_IN_AGAIN}`;
    case 'state-mismatch':
      return `The reply from Spotify did not match the login this tab started, so it was ignored. ${ID_KEPT} ${LOG_IN_AGAIN}`;
    case 'no-pending-login':
      return `This tab had no login in progress, so the reply from Spotify was ignored. This happens when a login finishes in a different tab from the one that started it. ${ID_KEPT} ${LOG_IN_AGAIN}`;
    case 'invalid-client':
      return `Spotify did not recognise this client ID. It is still saved here. Compare it with the Client ID in your Spotify developer dashboard, then log in again or choose "Use a different client ID".`;
    case 'invalid-grant':
      return `Spotify rejected the login code. This happens when a login reply is used twice or the redirect URI does not match. ${ID_KEPT} ${LOG_IN_AGAIN}`;
    case 'session-expired':
    case 'not-logged-in':
      return `Your Spotify login has ended and could not be renewed. ${ID_KEPT} ${LOG_IN_AGAIN}`;
    case 'network':
      return `Could not reach Spotify to finish connecting. ${BOTH_KEPT} Check your connection, then reload the page.`;
    case 'bad-response':
    case 'spotify-error':
      return `Spotify returned an unexpected reply while connecting${detail}. ${ID_KEPT} ${LOG_IN_AGAIN}`;
  }
}

function describeApiError(error: ApiError): string {
  if (error.status === null) {
    return `Could not reach Spotify to load your profile. ${BOTH_KEPT} Check your connection, then reload the page.`;
  }
  if (error.status === 401) {
    return `Spotify did not accept this login when loading your profile. ${ID_KEPT} ${LOG_IN_AGAIN}`;
  }
  if (error.status === 403) {
    return `Spotify refused to share this account's profile (403). An app in development mode only works for accounts listed under "User Management" in its dashboard. ${BOTH_KEPT} Add this account's email there, then reload the page.`;
  }
  return `Spotify returned an error while loading your profile (${String(error.status)}). ${BOTH_KEPT} Reload the page to try again.`;
}

// --- Scanning -----------------------------------------------------------------

const NOTHING_CHANGED =
  'Nothing in your account was changed, and the counts already shown are kept.';

/** A message for a failed scan or playlist load. `playlist` is the playlist that failed, if one did. */
export function describeScanError(error: unknown, playlist?: string): string {
  const target = playlist === undefined ? 'your playlists' : `"${playlist}"`;
  if (error instanceof QuotaExceededError) {
    return `Spotify says this app has used up its request quota, so scanning stopped. ${NOTHING_CHANGED} Wait a while, then choose Scan again; playlists that already have a count are skipped.`;
  }
  if (error instanceof RateLimitedError) {
    const minutes = Math.ceil(error.waitMs / 60_000);
    return `Spotify asked this app to wait about ${String(minutes)} minute${minutes === 1 ? '' : 's'} before more requests, so scanning stopped. ${NOTHING_CHANGED} Wait that long, then choose Scan again.`;
  }
  if (error instanceof AuthError) {
    return `Your Spotify login ended while scanning. ${ID_KEPT} ${NOTHING_CHANGED} ${LOG_IN_AGAIN}`;
  }
  if (error instanceof ApiError) {
    if (error.status === null) {
      return `Could not reach Spotify while loading ${target}. ${NOTHING_CHANGED} Check your connection, then try again.`;
    }
    if (error.status === 403 || error.status === 404) {
      return `Spotify would not share the contents of ${target} (${String(error.status)}). ${NOTHING_CHANGED} Other playlists are not affected; try another one.`;
    }
    return `Spotify returned an error while loading ${target} (${String(error.status)}). ${NOTHING_CHANGED} Try again in a moment.`;
  }
  if (error instanceof BadResponseError) {
    return `Spotify returned a reply for ${target} that this app could not read. ${NOTHING_CHANGED} Try again; if it keeps happening, report it.`;
  }
  return `Something unexpected went wrong while loading ${target}. ${NOTHING_CHANGED} Reload the page to try again.`;
}
