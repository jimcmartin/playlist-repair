import type { Candidate, DeadTrack, Tier } from '../../src/engine';

/**
 * Invented dead-track and candidate sets for the common cases. Real ones from
 * Jim's playlists replace these in milestone 5.
 */
export interface EngineCase {
  name: string;
  dead: DeadTrack;
  candidates: Candidate[];
  /** The tier of each candidate once ranked, best first. */
  expectedTiers: Tier[];
  /** The URI that must rank first, or null when no candidate may be chosen. */
  best: string | null;
}

const isrc = (n: number): string => `USXXX2600${String(n).padStart(3, '0')}`;

function track(
  uri: string,
  title: string,
  artists: string[],
  album: string,
  durationMs: number,
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    uri: `spotify:track:${uri}`,
    title,
    artists,
    album,
    albumType: 'album',
    durationMs,
    isrc: null,
    explicit: false,
    isPlayable: true,
    ...extra,
  };
}

function deadTrack(
  title: string,
  artists: string[],
  album: string,
  durationMs: number | null,
  extra: Partial<DeadTrack> = {},
): DeadTrack {
  return {
    uri: 'spotify:track:dead',
    title,
    artists,
    album,
    durationMs,
    isrc: null,
    explicit: false,
    isLocal: false,
    ...extra,
  };
}

export const streamingCases: EngineCase[] = [
  {
    name: 're-delivered album, same ISRC',
    dead: deadTrack('Walk This Way', ['Aerosmith'], 'Toys in the Attic', 211_000, {
      isrc: isrc(1),
    }),
    candidates: [
      track('compilation', 'Walk This Way', ['Aerosmith'], 'Greatest Hits', 211_000, {
        isrc: isrc(1),
        albumType: 'compilation',
      }),
      track(
        'redelivered',
        'Walk This Way',
        ['Aerosmith'],
        'Toys in the Attic (Remastered)',
        211_200,
        {
          isrc: isrc(1),
        },
      ),
      track('cover', 'Walk This Way', ['Run-D.M.C.'], 'Raising Hell', 310_000, { isrc: isrc(2) }),
    ],
    expectedTiers: ['exact', 'exact', 'none'],
    best: 'spotify:track:redelivered',
  },
  {
    name: 'remaster of the same recording, new ISRC',
    dead: deadTrack('Space Oddity - 2009 Remaster', ['David Bowie'], 'David Bowie', 315_000, {
      isrc: isrc(3),
    }),
    candidates: [
      track('plain', 'Space Oddity', ['David Bowie'], 'David Bowie (Deluxe Edition)', 315_300, {
        isrc: isrc(4),
      }),
    ],
    expectedTiers: ['high'],
    best: 'spotify:track:plain',
  },
  {
    name: 'live version offered for a studio track',
    dead: deadTrack('Heroes', ['David Bowie'], 'Heroes', 370_000, { isrc: isrc(5) }),
    candidates: [
      track('live', 'Heroes - Live at Wembley', ['David Bowie'], 'Live 1985', 372_000, {
        isrc: isrc(6),
      }),
      track('studio', 'Heroes', ['David Bowie'], 'Heroes (2017 Remaster)', 370_400, {
        isrc: isrc(7),
      }),
    ],
    expectedTiers: ['high', 'review'],
    best: 'spotify:track:studio',
  },
  {
    name: 'explicit track, only a clean copy playable',
    dead: deadTrack('Lose Yourself', ['Eminem'], '8 Mile', 326_000, {
      isrc: isrc(8),
      explicit: true,
    }),
    candidates: [
      track('clean', 'Lose Yourself', ['Eminem'], '8 Mile', 326_000, {
        isrc: isrc(9),
        explicit: false,
      }),
    ],
    expectedTiers: ['review'],
    best: 'spotify:track:clean',
  },
  {
    name: 'clean track, explicit copy playable',
    dead: deadTrack('Lose Yourself', ['Eminem'], '8 Mile', 326_000, {
      isrc: isrc(9),
      explicit: false,
    }),
    candidates: [
      track('explicit', 'Lose Yourself', ['Eminem'], '8 Mile', 326_000, {
        isrc: isrc(8),
        explicit: true,
      }),
    ],
    expectedTiers: ['review'],
    best: 'spotify:track:explicit',
  },
  {
    name: 'compilation copy of the recording, different ISRC',
    dead: deadTrack('Tainted Love', ['Soft Cell'], 'Non-Stop Erotic Cabaret', 156_000, {
      isrc: isrc(10),
    }),
    candidates: [
      track('now', 'Tainted Love', ['Soft Cell'], 'Now That’s What I Call the 80s', 156_000, {
        isrc: isrc(11),
        albumType: 'compilation',
      }),
    ],
    expectedTiers: ['review'],
    best: 'spotify:track:now',
  },
  {
    name: 'feat. credit moved from title to artist',
    dead: deadTrack('Dance Monkey (feat. Ann Lee)', ['Tones'], 'The Kids Are Coming', 209_000, {
      isrc: isrc(12),
    }),
    candidates: [
      track('moved', 'Dance Monkey', ['Tones', 'Ann Lee'], 'The Kids Are Coming', 209_100, {
        isrc: isrc(13),
      }),
    ],
    expectedTiers: ['high'],
    best: 'spotify:track:moved',
  },
  {
    name: 'feat. credit moved from artist to title',
    dead: deadTrack('Dance Monkey', ['Tones', 'Ann Lee'], 'The Kids Are Coming', 209_000, {
      isrc: isrc(13),
    }),
    candidates: [
      track('moved', 'Dance Monkey (feat. Ann Lee)', ['Tones'], 'The Kids Are Coming', 209_000, {
        isrc: isrc(12),
      }),
    ],
    expectedTiers: ['high'],
    best: 'spotify:track:moved',
  },
  {
    name: 'no good match (Step On It, from the plan)',
    dead: deadTrack(
      'Step On It',
      ['Robben Ford & The Blue Line'],
      'Robben Ford & The Blue Line',
      292_000,
      {
        isrc: 'USGR19200025',
      },
    ),
    candidates: [
      track('start', 'Start It Up', ['Robben Ford & The Blue Line'], 'The Firm', 214_000, {
        isrc: 'USGR19200028',
        albumType: 'compilation',
      }),
      track('other', 'Step On It', ['Monkees'], 'Pool It!', 183_000, { isrc: isrc(14) }),
    ],
    expectedTiers: ['none', 'none'],
    best: null,
  },
];

streamingCases.push({
  name: 'same song by the band leader, live, beats unrelated artists',
  dead: deadTrack(
    'The Brother (For Jimmie & Stevie)',
    ['Robben Ford & The Blue Line'],
    'Robben Ford & The Blue Line',
    300_000,
    { isrc: isrc(20) },
  ),
  candidates: [
    track('cover', 'The Brother', ['Some Cover Band'], 'Tribute Night', 300_000, {
      isrc: isrc(21),
    }),
    track('live', 'The Brother - Live 1998', ['Robben Ford'], 'Live at the Roxy', 420_000, {
      isrc: isrc(22),
    }),
  ],
  expectedTiers: ['review', 'none'],
  best: 'spotify:track:live',
});

export const localCases: EngineCase[] = [
  {
    name: 'local file with a clear match',
    dead: deadTrack('Blue Monday', ['New Order'], 'Power, Corruption & Lies', 449_000, {
      uri: 'spotify:local:New+Order:Power%2C+Corruption+%26+Lies:Blue+Monday:449',
      isLocal: true,
    }),
    candidates: [
      track(
        'match',
        'Blue Monday',
        ['New Order'],
        'Power, Corruption & Lies (Collector’s Edition)',
        449_400,
        {
          isrc: isrc(15),
        },
      ),
    ],
    expectedTiers: ['high'],
    best: 'spotify:track:match',
  },
  {
    name: 'local file with only a loose match',
    dead: deadTrack('Blue Mondey', ['New Order'], '', 452_000, {
      uri: 'spotify:local:New+Order::Blue+Mondey:452',
      isLocal: true,
    }),
    candidates: [
      track('loose', 'Blue Monday', ['New Order'], 'Substance', 440_000, { isrc: isrc(16) }),
    ],
    expectedTiers: ['review'],
    best: 'spotify:track:loose',
  },
  {
    name: 'local file whose tags are missing',
    dead: deadTrack('', [], '', null, { uri: 'spotify:local::::0', isLocal: true }),
    candidates: [
      track('any', 'Blue Monday', ['New Order'], 'Substance', 449_000, { isrc: isrc(16) }),
    ],
    expectedTiers: ['none'],
    best: null,
  },
];
