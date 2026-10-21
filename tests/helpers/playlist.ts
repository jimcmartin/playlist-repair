import type { SpotifyClient } from '../../src/spotify/client';
import { ApiError } from '../../src/spotify/client';

export interface FakeTrack {
  uri: string;
  name?: string;
}

export type Call =
  | { op: 'snapshot' }
  | { op: 'items' }
  | { op: 'insert'; uris: string[]; position: number }
  | { op: 'remove'; uris: string[] }
  | { op: 'replace'; uris: string[] };

export interface FakePlaylistOptions {
  /** Throws instead of answering for a call, so a test can fail any step. `n` counts all calls. */
  fail?: (call: Call, n: number) => Error | null;
  /** The write goes through, but the reply never arrives. */
  loseReply?: (call: Call, n: number) => boolean;
  /** Local files cannot be removed by URI. */
  refuseLocal?: boolean;
  /** The replace-all write is refused. */
  refuseReplace?: boolean;
  /** Removing a URI takes out only its first occurrence. */
  removeFirstOnly?: boolean;
  /** Write replies carry a snapshot id that a later read does not return. */
  wrongReplyIds?: boolean;
  /** Something else changes the playlist before the first call. */
  version?: string;
}

/** A playlist that behaves like Spotify's: inserts shift tracks down, and removal is by URI. */
export function fakePlaylist(uris: string[], options: FakePlaylistOptions = {}) {
  let list = [...uris];
  let version = 0;
  const calls: Call[] = [];
  let snapshot = options.version ?? 'v0';

  function entry(uri: string) {
    const local = uri.startsWith('spotify:local:');
    return {
      added_at: '2026-01-01T00:00:00Z',
      is_local: local,
      item: {
        type: 'track',
        id: local ? null : uri.split(':')[2],
        uri,
        name: `Name of ${uri}`,
        artists: [{ id: null, name: 'Artist' }],
        album: { id: null, name: 'Album', album_type: 'album' },
        duration_ms: 200_000,
        is_playable: !uri.includes('dead'),
        ...(uri.includes('dead') ? { restrictions: { reason: 'market' } } : {}),
      },
    };
  }

  function bump(): string {
    version += 1;
    snapshot = `v${String(version)}`;
    return snapshot;
  }

  const client: SpotifyClient = {
    get: (_path, params) => {
      if (params?.fields === 'snapshot_id') {
        const call: Call = { op: 'snapshot' };
        const error = record(call);
        return error ? Promise.reject(error) : Promise.resolve({ snapshot_id: snapshot });
      }
      const offset = Number(params?.offset ?? 0);
      const limit = Number(params?.limit ?? 50);
      if (offset === 0) {
        const error = record({ op: 'items' });
        if (error) return Promise.reject(error);
      }
      const page = list.slice(offset, offset + limit).map(entry);
      return Promise.resolve({
        items: page,
        total: list.length,
        next: offset + limit < list.length ? 'next' : null,
      });
    },
    send: (method, _path, body) => {
      const b = body as { uris?: string[]; position?: number; items?: { uri: string }[] };
      if (method === 'PUT') {
        const call: Call = { op: 'replace', uris: b.uris ?? [] };
        const error = record(call);
        if (error) return Promise.reject(error);
        if (options.refuseReplace) return Promise.reject(new ApiError(400, 'PUT refused'));
        list = [...call.uris];
        return replyOrLose(call);
      }
      if (method === 'POST') {
        const call: Call = { op: 'insert', uris: b.uris ?? [], position: b.position ?? 0 };
        const error = record(call);
        if (error) return Promise.reject(error);
        list.splice(call.position, 0, ...call.uris);
        return replyOrLose(call);
      }
      const removing = (b.items ?? []).map((item) => item.uri);
      const error = record({ op: 'remove', uris: removing });
      if (error) return Promise.reject(error);
      if (options.refuseLocal && removing.some((uri) => uri.startsWith('spotify:local:'))) {
        return Promise.reject(new ApiError(400, 'DELETE refused a local file'));
      }
      for (const uri of removing) {
        if (options.removeFirstOnly) {
          const at = list.indexOf(uri);
          if (at >= 0) list.splice(at, 1);
        } else list = list.filter((u) => u !== uri);
      }
      return replyOrLose({ op: 'remove', uris: removing });
    },
  };

  function replyOrLose(call: Call): Promise<unknown> {
    const id = bump();
    const reply = { snapshot_id: options.wrongReplyIds ? `reply-${id}` : id };
    if (options.loseReply?.(call, calls.length - 1)) {
      return Promise.reject(new ApiError(null, 'got no response'));
    }
    return Promise.resolve(reply);
  }

  function record(call: Call): Error | null {
    calls.push(call);
    return options.fail?.(call, calls.length - 1) ?? null;
  }

  return {
    client,
    calls,
    uris: () => [...list],
    /** Someone else edits the playlist. */
    editElsewhere: () => bump(),
    /** Someone else adds a track. */
    appendElsewhere: (uri: string) => {
      list.push(uri);
      return bump();
    },
    writes: () => calls.filter((c) => c.op === 'insert' || c.op === 'remove' || c.op === 'replace'),
  };
}
