import { API_BASE_URL } from '../config';
import type { FetchLike } from './auth';
import { parseProfile, type Profile } from './types';

/** `status` is the HTTP status, or null when the request never got a response. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** GET /me: who is logged in. */
export async function getProfile(fetchFn: FetchLike, accessToken: string): Promise<Profile> {
  let response: Response;
  let json: unknown;
  try {
    response = await fetchFn(`${API_BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    json = await response.json().catch(() => null);
  } catch {
    throw new ApiError(null, 'GET /me got no response');
  }
  if (!response.ok) {
    throw new ApiError(response.status, `GET /me returned ${String(response.status)}`);
  }

  const profile = parseProfile(json);
  if (profile === null) throw new ApiError(response.status, 'GET /me returned no user id');
  return profile;
}
