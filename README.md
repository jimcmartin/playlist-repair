# Playlist Repair

_for Spotify_

Playlist Repair finds the greyed-out tracks in your Spotify playlists, matches each one to a
playable version of the same recording, and swaps the matches in after you approve them. It can
also replace local files with streaming versions. It is a browser-only app with no backend, and
each user connects it with their own Spotify client ID.

**Status:** v1 runs locally on `127.0.0.1`. Setup, login, scanning, candidate search, review,
apply, backup and verification all work. There is no hosted app yet and no privacy page. `https://playlistrepair.com/` is meant to serve a
static landing page, built from `site/`.

**Demo video:** _(link to come)_

## How to use it

1. Follow the [setup guide](docs/setup-guide.md) to create a Spotify app and get its client ID.
2. Run the app (see [Run it locally](#run-it-locally)) and open <http://127.0.0.1:5173/>.
3. Paste the client ID and log in.
4. Scan a playlist. A window lists its broken tracks and local files and why each is a problem.
5. Choose **Find fixes**. The app shows how many requests this will take before it sends any.
6. Review the matches, tick the ones you want, and choose **Apply fixes**.

Only playlists you own are listed. Spotify returns the contents of a playlist only to its owner
and collaborators in a development-mode app, and Playlist Repair does not edit other people's
playlists.

## Why you bring your own client ID

Since 2026, a new Spotify app starts in development mode: at most 5 users, each added by hand,
and the owner needs Premium. Extended quota is open only to registered organizations with a large
audience. One shared client ID therefore cannot serve the public, so each user creates their own
app in Spotify's developer dashboard and pastes in its client ID. The client ID is not a secret.
The app uses no client secret and never asks for one.

Whether Spotify's Developer Policy allows this model on a hosted site is an open question in the
plan. Running your own copy on `127.0.0.1` is the safe form, and it is the only one that exists
today.

## How matching works

For each broken track the app makes up to three searches, and stops as soon as it has an Exact
match:

1. `isrc:` search. The ISRC identifies the recording and usually survives a label re-delivering an
   album under new IDs.
2. A search on the base title and primary artist.
3. A plain-text search on the same words.

Only playable candidates are scored. The matching engine (`src/engine/`) is pure functions with
no network or DOM access, so it is tested on its own against invented cases and real pairs from
the author's playlists (`tests/fixtures/`). It normalizes titles (case, diacritics, punctuation,
`feat.` credits), splits off version tags such as live, remix or remaster, and scores title,
artists, duration and album. The artist counts most.

Each track's best candidate gets a confidence tier:

| Tier   | Meaning                                                                     | Default       |
| ------ | --------------------------------------------------------------------------- | ------------- |
| Exact  | Same ISRC, duration within 2 seconds, same explicit flag                    | Selected      |
| High   | Score 0.90 or more, close duration, same version markers and explicit flag  | Selected      |
| Review | Score 0.70 to 0.90, or held back because a version or explicit flag differs | Not selected  |
| None   | Nothing scores 0.70                                                         | Left in place |

A live or remix version never reaches the selected tiers for a studio original, however well the
rest matches. The Review screen groups tracks by tier, lets you approve a whole group or single
rows, and lets you pick a different candidate. Each row shows the dead track beside its proposed
replacement with the differences marked. Weights and thresholds are in `src/config.ts`. The full
rules are in the [plan](docs/technical-plan.md#matching-engine).

## How a repair is applied safely

Nothing is written until you approve on the Review screen. Then:

1. **Check the version.** If the playlist changed since the scan, the app rescans and keeps your
   choices for tracks that are still there.
2. **Back up.** A JSON file of the playlist as scanned (position, URI, title, artists, album, date
   added) is downloaded first. This is on by default and the file never leaves your computer.
3. **Insert.** Replacements are inserted at the dead tracks' positions, working from the bottom up
   so earlier positions stay valid.
4. **Remove.** Only after every insert succeeds are the dead tracks removed.
5. **Verify.** The app reads the playlist again and checks that each dead track is gone and each
   replacement is in place. The Done screen lists any difference.

Because inserts come before removals, a failure leaves extra tracks and never missing ones. If an
error stops the run, **Resume** continues from where it stopped instead of starting over. Replacements
get today's date as their "date added"; the backup keeps the original dates.

## Local files

Local files can be replaced, with limits:

- They are repaired only when you tick **Include local files** for that playlist.
- A local file has only tags to go on, with no ISRC, so it can reach High at best, never Exact.
  Its matches are never preselected: you tick them one by one or with "select all" for a group.
- Spotify's API cannot add a local file back, and removing one by URI does not work. A local file
  leaves a playlist only through a replace-all, which the app uses only when every local file in
  the playlist is being replaced or removed and the result has 100 tracks or fewer. Otherwise the
  replacement is still inserted, the local file stays, and the Done screen lists the files to
  delete by hand and says why.

## Security model

- **No backend.** The app is static files. There is no server to send data to.
- **PKCE.** Login uses Authorization Code with PKCE, written on the browser's Web Crypto API with no
  auth library. There is no client secret.
- **Two hosts only.** The built app carries a Content Security Policy that limits network requests
  to `https://accounts.spotify.com` and `https://api.spotify.com`, with scripts and styles from the
  site itself and images from the site and Spotify's image hosts. There is no analytics, font
  host, CDN or error reporting. A Playwright test against the production build fails on any
  policy violation.
- **Short-lived storage.** Tokens and the PKCE verifier live in `sessionStorage` and are gone when
  the tab closes. Only the client ID is kept in `localStorage`. Neither tokens nor the verifier are
  written to logs, URLs, error messages or the backup file.
- **Few dependencies.** `react` and `react-dom` are the only runtime packages, and the lockfile is
  committed.
- **Scopes.** `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-private`
  and `playlist-modify-public`, and nothing else.

## Spotify's quota

Development mode has a request quota that Spotify does not publish. A full scan of 120 playlists
cost about 360 requests, and a quota stop can last days. The app limits itself to 2 requests at a
time, shows an estimate before any scan or search, shows a running request count in the status bar,
and on a quota stop keeps the work done and tells you to try again later.

## Run it locally

You need Node.js 24 or later.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. Use that address and not `localhost`: Spotify only accepts the
loopback IP as a local redirect URI, and the app turns other addresses away.

## Scripts and tests

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Dev server on `http://127.0.0.1:5173/`        |
| `npm run typecheck` | TypeScript in strict mode                     |
| `npm run lint`      | ESLint and a Prettier check                   |
| `npm run format`    | Rewrite files with Prettier                   |
| `npm test`          | Unit tests with Vitest                        |
| `npm run build`     | Production build into `dist/`                 |
| `npm run e2e`       | Playwright tests against a mocked Spotify API |
| `npm run check`     | Typecheck, lint, test and build together      |

Before the first `npm run e2e`, install the browser with `npx playwright install chromium`.
`npm run e2e` also builds and serves the production build on port 5173 to test the Content
Security Policy, so stop any running dev server first.

Unit tests cover the engine, the Spotify client (with a fake `fetch`), the repair flow (with a fake
client) and the screens. The Playwright tests never contact Spotify. Logging in, scanning and
applying against a real account are checked by hand, on a copy of a playlist.

## Layout

- `src/engine/` is the matching engine.
- `src/spotify/` holds auth, the fetch wrapper, endpoint functions and types.
- `src/repair/` holds scan, candidate search, apply and backup.
- `src/ui/` holds the React screens.
- `src/config.ts` holds scopes, endpoints, thresholds and throttle settings.
- `site/` holds the landing page. `npm run build:site` builds it into `dist-site/`.

The design, the build order and the questions still open are in the
[technical plan](docs/technical-plan.md).

## License

[MIT](LICENSE)
