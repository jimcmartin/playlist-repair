export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface Profile {
  id: string;
  displayName: string;
}

/** Reads the fields the app uses from a GET /me response, or null if they are missing. */
export function parseProfile(json: unknown): Profile | null {
  if (!isRecord(json) || typeof json.id !== 'string') return null;
  // display_name is null for accounts that never set one.
  const name = typeof json.display_name === 'string' ? json.display_name.trim() : '';
  return { id: json.id, displayName: name === '' ? json.id : name };
}
