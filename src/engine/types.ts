/** The version markers the engine recognizes in a title tag. */
export type VersionMarker =
  | 'live'
  | 'acoustic'
  | 'remix'
  | 'instrumental'
  | 'karaoke'
  | 'demo'
  | 'edit'
  | 'mono'
  | 'stereo'
  | 'extended'
  | 're-recorded'
  | 'remaster';

export type Tier = 'exact' | 'high' | 'review' | 'none';

export type AlbumType = 'album' | 'single' | 'compilation';

/**
 * A greyed-out track, or a local file, to find a replacement for. Plain data:
 * the repair flow builds it from the API response.
 */
export interface DeadTrack {
  uri: string;
  title: string;
  artists: string[];
  album: string;
  /** Null when unknown. For a local file this is whole seconds times 1000. */
  durationMs: number | null;
  isrc: string | null;
  /** Null when unknown. A local file's flag is only a default, so it is ignored. */
  explicit: boolean | null;
  isLocal: boolean;
}

/** A search result. Candidates that are not playable are never scored. */
export interface Candidate {
  uri: string;
  title: string;
  artists: string[];
  album: string;
  albumType: AlbumType | null;
  durationMs: number;
  isrc: string | null;
  explicit: boolean;
  isPlayable: boolean;
}

/** Each part is 0 to 1, or null when the dead track has no value to compare. */
export interface ScoreParts {
  title: number;
  artists: number | null;
  duration: number | null;
  album: number | null;
}

export type CapReason = 'version' | 'explicit';

/** What differs between the dead track and a candidate, for the review row. */
export interface Differences {
  /** Candidate minus dead track, or null when either duration is unknown. */
  durationDiffMs: number | null;
  sameAlbum: boolean;
  explicitDiffers: boolean;
  /** Markers on one side only, remaster included. */
  markersOnlyOnDead: VersionMarker[];
  markersOnlyOnCandidate: VersionMarker[];
}

export interface Match {
  candidate: Candidate;
  score: number;
  parts: ScoreParts;
  tier: Tier;
  /** Whether the review screen should tick this row by default. */
  selected: boolean;
  /** Why the candidate was held at Review whatever its score. */
  capped: CapReason[];
  differences: Differences;
}
