export { parseLocalUri, withLocalUriFallback, type LocalUriFields } from './local';
export { matchCandidate, rankCandidates } from './match';
export {
  normalizeAlbum,
  normalizeText,
  similarity,
  splitTitle,
  type ParsedTitle,
} from './normalize';
export { combineParts, durationGapMs, durationScore, scoreParts } from './score';
export type {
  AlbumType,
  CapReason,
  Candidate,
  DeadTrack,
  Differences,
  Match,
  ScoreParts,
  Tier,
  VersionMarker,
} from './types';
