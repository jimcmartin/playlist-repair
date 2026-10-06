import { AuthError } from '../spotify/auth';
import { ApiError } from '../spotify/endpoints';

// Every message says what happened, what was kept, and what to do next.

const ID_KEPT = 'Your client ID is still saved.';
const BOTH_KEPT = 'Your client ID and login were kept.';
const LOG_IN_AGAIN = 'Choose "Log in with Spotify" to try again.';

export const NO_CLIENT_ID_FOR_REPLY =
  'Spotify sent back a login reply, but no client ID is saved in this browser, so the reply was ignored. Nothing was changed. Enter your client ID to start again.';

export function describeError(error: unknown): string {
  if (error instanceof AuthError) return describeAuthError(error);
  if (error instanceof ApiError) return describeApiError(error);
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
