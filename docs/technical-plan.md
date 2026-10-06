# Playlist Repair: Technical Plan

Oct 2, 2026 · Jim

## Summary

Playlist Repair is a browser-only web app that finds greyed-out tracks in a person's Spotify playlists, matches each one to a playable version of the same recording, and swaps them in after the user approves. It is open source, has no backend, and each user connects it with their own Spotify client ID.

- **Language:** TypeScript in strict mode.
- **Build and UI:** Vite and React, with no router, state library or CSS framework.
- **Auth:** Authorization Code with PKCE, written by hand on the browser's Web Crypto API.
- **Hosting:** GitHub Pages at `https://playlistrepair.com/`.
- **Runtime dependencies:** `react` and `react-dom` only.

The project is done when the site is live, someone other than Jim sets it up from the guide alone and repairs a playlist, and the README explains the design well enough to stand as a portfolio piece.

## Why it is built this way

Spotify's rules decide most of the design. These were checked against Spotify's documentation on Oct 2, 2026.

- **User cap.** A new app starts in development mode: at most 5 users, each added by hand, and the owner needs Premium. Extended quota is only open to registered organizations with 250k monthly active users. One shared client ID cannot serve the public, so each user brings their own.
- **Reduced API.** Since February 2026, development mode returns at most 10 search results per request, has no batch track lookup, and only returns the contents of playlists the user owns or collaborates on.
- **Removed fields.** Tracks no longer carry `linked_from`, `available_markets` or `popularity`, and the user profile no longer carries `country`. The ISRC (`external_ids`) was removed in February and restored in March.
- **Redirect URIs.** They must match the registered value exactly and use HTTPS, except on the loopback address `127.0.0.1`. `localhost` is not allowed.

Two product goals come from using Playlist Hospital, the existing tool: approve matches in bulk, and never leave the user stuck after an error.

## Scope

**In**

- Connect with a user-supplied client ID
- List the playlists the user owns or collaborates on
- Scan a playlist for unplayable tracks, and count its good, broken and local tracks
- Replace local files with streaming versions, for playlists the user chooses
- Find and rank replacement candidates for each one
- Review screen with matches grouped by confidence, and bulk approval per group
- Apply: insert replacements at the original positions, then remove the dead tracks
- Backup file of the playlist before any change
- Setup guide for getting a client ID, and a privacy page

**Deferred**

- Repairing into a copy of the playlist instead of in place
- Duplicate removal
- Liked Songs and saved albums
- A Spicetify extension built on the same matching engine
- Any server, account system or analytics

**v1, due October 24, 2026**

v1 is milestones 1 to 6, the setup guide, a README and a 30-second demo video. Replacing local files is part of v1, because Jim's own playlists hold far more local files than broken tracks. The repo is public and the app runs locally on `127.0.0.1`. Milestone 7 (hardening) and the rest of milestone 8 (the hosted site and the privacy page) come after v1.

## Architecture

```text
            ┌──────────── browser only ────────────┐
  UI ─────> Repair flow ─────> Spotify client ────────> api.spotify.com
(React)     (scan, search,     (fetch wrapper,
             apply, backup)     throttle, retry)
                 │                    ^
                 v                    │
           Matching engine          Auth ─────────────> accounts.spotify.com
           (pure functions)        (PKCE, tokens)
```

The matching engine never touches the network or the DOM. The repair flow fetches candidates, hands plain data to the engine, and acts on what it returns.

| Module | Path | Owns |
| --- | --- | --- |
| Matching engine | `src/engine/` | Normalizing, scoring, ranking and confidence tiers |
| Auth | `src/spotify/auth.ts` | PKCE, token exchange, refresh, logout |
| Spotify client | `src/spotify/` | The fetch wrapper, endpoint functions and response types |
| Repair flow | `src/repair/` | Scan, candidate search, apply, backup |
| UI | `src/ui/` | Screens and components |

## Repository layout

```text
playlist-repair/
├── CLAUDE.md
├── README.md
├── LICENSE                  MIT
├── index.html               carries the Content Security Policy meta tag
├── package.json
├── vite.config.ts           dev server bound to 127.0.0.1:5173
├── docs/
│   ├── technical-plan.md    this file
│   └── setup-guide.md       how to get a client ID (v1)
├── public/
│   ├── CNAME                playlistrepair.com
│   └── privacy.html
├── src/
│   ├── main.tsx
│   ├── config.ts            scopes, endpoints, thresholds, throttle settings
│   ├── engine/              no imports from outside this folder
│   ├── spotify/
│   ├── repair/
│   └── ui/
├── tests/
│   ├── engine/              unit tests
│   ├── spotify/             unit tests, with a fake `fetch`
│   ├── repair/              unit tests for the repair flow, with a fake client
│   ├── ui/                  unit tests for startup and screens
│   ├── helpers/             fakes shared by the tests
│   └── fixtures/            real dead-track and candidate pairs
├── e2e/                     Playwright, against a mocked API
└── .github/workflows/       check on every push, deploy on main
```

## Authentication

The app uses Authorization Code with PKCE, which needs no client secret.

1. The user pastes their client ID on the setup screen. It is stored in `localStorage`, since it is not a secret.
2. The app generates a code verifier and a `state` value, stores both in `sessionStorage`, and redirects to `https://accounts.spotify.com/authorize` with the S256 challenge.
3. Spotify redirects back to the site root with `?code=` and `state`. The app checks `state`, exchanges the code at `https://accounts.spotify.com/api/token`, and removes the query string with `history.replaceState`.
4. Tokens live in `sessionStorage` and are gone when the tab closes.
5. Access tokens last one hour. The client refreshes with `grant_type=refresh_token`, the refresh token and the client ID, and keeps a new refresh token if one comes back.
6. Log out clears both stores and links to Spotify's "Manage apps" page so the user can revoke access. It removes the app's own keys only, since other projects served from `127.0.0.1:5173` share the same storage.

The login reply is handled once at startup, before React renders, because a code can only be exchanged once and React's StrictMode runs effects twice in development. Concurrent refreshes share one request, because Spotify replaces the refresh token on use.

**Redirect URI.** The redirect URI is the site root, `https://playlistrepair.com/`, with the trailing slash. Every static host serves the root, so this works without a router or host-specific rewrites. Local development uses `http://127.0.0.1:5173/`. The production value is permanent: every user registers it in their own Spotify app, so changing it later breaks their setup. The app picks the redirect URI from the origin it is served from. On any other origin, including `http://localhost:5173`, it shows a message pointing to `http://127.0.0.1:5173/` and does not start a login.

**Scopes.** `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-private`, `playlist-modify-public`. Request nothing else: milestone 4 showed search works without `user-read-private`.

## Spotify API usage

| Purpose | Call | Notes |
| --- | --- | --- |
| Who is logged in | `GET /me` | Used for the display name and to tell which playlists the user owns |
| List playlists | `GET /me/playlists` | 50 per page |
| Playlist version | `GET /playlists/{id}?fields=snapshot_id` | Checked again just before writing |
| Playlist contents | `GET /playlists/{id}/items` | 50 per page; each entry's track is under `item` (`track` is deprecated) |
| Find candidates | `GET /search?type=track` | 10 results per request; supports `isrc:`, `track:`, `artist:` and `album:` filters. Checked on Oct 6, 2026: `isrc:` finds a known track, but `tracks.total` can say 0 while `items` holds a result, so read `items.length`, never `total` |
| Insert | `POST /playlists/{id}/items` | Up to 100 URIs, with a zero-based `position` |
| Remove | `DELETE /playlists/{id}/items` | Up to 100 `{ uri }` objects, with `snapshot_id` |

**Client behavior.**

- **Throttle.** At most 2 requests in flight. Spotify's rate limit is counted over a rolling 30-second window.
- **429.** Wait for the `Retry-After` header, then retry. A 429 also pauses the other request slot and the queue. If the body's `reason` is `QUOTA_EXCEEDED`, stop, keep the work done so far, and tell the user to resume later. A `Retry-After` over 60 seconds, or a request still limited after 5 retries, is treated the same way: stop and keep the work. With no readable `Retry-After`, wait 5 seconds.
- **Quota.** Spotify counts the quota per developer account, not per client ID or user, in buckets of endpoints, and publishes neither the numbers nor the reset time. A full scan of 120 playlists costs about 360 requests, since each playlist needs at least one request plus one per 50 tracks. Avoid rescanning what is already scanned, and plan milestone 5's searches (up to 3 per broken track, up to 2 per local file) against this budget. The Playlists screen shows the estimated request count before searching, and local files are searched only for playlists the user chooses, with results cached by artist, title and duration so a file in several playlists is searched once.
- **Paging.** Pages are requested by `offset`. The client builds every URL from the API base and never follows a `next` URL from a reply, so a reply cannot send the app to another host.
- **401.** Refresh the token once and retry. If that fails, send the user back to Connect without losing the review state.
- **Cache.** Search results are cached in memory by query for the session, and candidate lists by dead track URI.
- **Market.** No `market` parameter is sent. With a user token Spotify uses the account's country, and the profile no longer exposes it. Confirmed in milestone 4 on Oct 6, 2026: a rescan with `market` set to US and to GB gave the same results as sending none.
- **Validation.** Responses are checked with small hand-written guards for the fields the app reads. A missing field is handled, not assumed.

## Detecting broken tracks

A playlist entry is broken when all of these hold. `is_playable` must be present: if Spotify leaves it out, the entry is unknown, not broken (it is the first open question below that decides how common that is).

- `is_local` is false
- `item` is a track, not an episode
- `item.is_playable` is false
- `item.restrictions.reason` is `market` or absent

Other cases are shown but not repaired:

| Case | Shown as |
| --- | --- |
| `restrictions.reason` is `explicit` | Hidden by the user's explicit-content setting |
| `restrictions.reason` is `product` | Not available on the user's plan |
| `item` is null | Removed from Spotify, with nothing left to match |
| Local file | Counted separately, and repaired only when the user includes local files for that playlist |
| `restrictions.reason` is any other value | Shown as another restriction, not repaired |
| `item.is_playable` is missing | Shown as unknown, not counted as broken or playable |

## Matching engine

The engine takes one dead track and a list of candidates and returns them ranked, each with a score and a confidence tier. It is pure TypeScript with no dependencies.

**Search order.** The repair flow makes at most three searches per dead track and stops as soon as it has an Exact match.

1. `isrc:{ISRC}`. The ISRC identifies the recording and usually survives a label re-delivering an album under new IDs.
2. `track:"{base title}" artist:"{primary artist}"`.
3. `{base title} {primary artist}` as plain text.

Only candidates with `is_playable` true are scored.

**Normalizing.**

- Lowercase, strip diacritics and punctuation, turn `&` into `and`, collapse spaces.
- Split a title into a base title and version tags. Tags come from parentheses, brackets and the part after ` - `.
- Move `feat.` credits out of the title and into the artist comparison.
- Recognize version markers: live, acoustic, remix, instrumental, karaoke, demo, edit, mono, stereo, extended, re-recorded, remaster.

**Score.** Each part is 0 to 1, combined with these starting weights.

| Part | Weight | Measure |
| --- | --- | --- |
| Title | 0.40 | Similarity of base titles |
| Artists | 0.25 | Primary artist match, then overlap of the full artist sets |
| Duration | 0.20 | 1.0 within 2 seconds, falling to 0 at 15 seconds apart |
| Album | 0.15 | Similarity of album names, ignoring edition words such as "deluxe" |

**Tiers.**

| Tier | Rule | Default |
| --- | --- | --- |
| Exact | Same ISRC, duration within 2 seconds, same explicit flag | Selected |
| High | Score 0.90 or more, duration within 3 seconds, same version markers, same explicit flag | Selected |
| Review | Score 0.70 to 0.90, or held back by a cap | Not selected |
| None | Best score under 0.70, or no candidates | Left in place |

**Caps.** A version-marker mismatch other than remaster, or a different explicit flag, holds a candidate at Review whatever its score. A remaster difference only lowers the score slightly.

**Ties.** When several candidates share an ISRC, prefer the same album name, then an album over a compilation, then the closest duration.

**Local files.** A local file has a title, artist, album and a duration in whole seconds, read from its tags, and nothing else: no ISRC, no ID, and an `explicit` flag that is only a default. The same fields are encoded in its `spotify:local:` URI, which is the fallback when a field is missing.

- Search steps 2 and 3 only, since there is no ISRC. Try step 2 first and use step 3 only if it finds nothing usable.
- A local file can never reach Exact, which needs a matching ISRC. At best it reaches High.
- The explicit-flag cap does not apply, because the flag is unknown, not false.
- Its matches are never preselected, even in High. The user selects them one by one or with "select all" for the group.
- Tags are often messy, so the duration and album parts count for less when the file's value is missing.

Weights and thresholds are starting values. They live in `src/config.ts` and are tuned against real fixtures in milestone 5.

## Applying a repair

Inserts happen before removals, so a failure partway leaves extra tracks in the playlist and never missing ones.

1. **Check the version.** Fetch `snapshot_id` again. If it changed since the scan, rescan and keep the user's decisions for tracks that are still there.
2. **Back up.** Offer a JSON download of the playlist as scanned: position, URI, title, artists, album and date added. The option is on by default.
3. **Insert.** Work from the bottom of the playlist up, so earlier positions stay valid. Each replacement goes in at its dead track's position. Neighboring replacements share one call.
4. **Remove.** Delete the dead URIs in batches of 100, passing the latest `snapshot_id`.
5. **Verify.** Fetch the playlist again and confirm each dead URI is gone and each replacement is where it should be. Show a summary.

Progress is tracked per track in memory, so Resume continues after an error instead of starting over.

**Edge cases.**

- **Replacement already in the playlist.** The default action becomes remove-only, and the row says why.
- **Dead track listed more than once.** Insert the replacement at each position. Milestone 6 confirms that removing by URI removes every occurrence.
- **No match.** The track stays. "Remove anyway" is offered per track and is off by default.
- **Local files.** Each local file is replaced like a dead track, and the backup file keeps its original entry. Removing a `spotify:local:` URI through the API is untested, so milestone 6 checks it on a copy and falls back to removing by position if URI removal fails.
- **Someone else's collaborative playlist.** Listed with a label, and repaired only if the user can edit it.

Replacements get today's date as their "date added". The backup file keeps the original dates, and the review screen says so before the user applies.

## Screens

There is no router. One piece of state decides which screen shows.

| Screen | What the user does |
| --- | --- |
| Setup | Pastes a client ID, with the setup guide beside the field |
| Connect | Logs in with Spotify |
| Playlists | Sees owned and collaborative playlists, chooses one and scans it, and sees how many tracks are good, broken and local. Then chooses "Find fixes", with a checkbox to include local files, which is off by default. The screen shows the estimated number of requests first. "Scan all" stays, and also shows its estimate and asks for confirmation before it sends anything |
| Review | Sees broken tracks grouped by tier, selects a whole group or single rows, and picks a different candidate where needed |
| Apply | Watches progress, and can resume after an error |
| Done | Reads the summary and opens the playlist in Spotify |

- Each review row shows the dead track beside its proposed replacement, with the differences marked: album, duration, explicit flag, version.
- Every track, album and artist name links to its page on Spotify.
- Every error message says what happened, what was kept, and what to press next.

## Security and privacy

These are the claims the project makes to its users, and each one is enforced in code.

- **No backend.** The app is static files. There is nothing to send data to.
- **Two hosts only.** A Content Security Policy in `index.html` limits `connect-src` to `https://accounts.spotify.com` and `https://api.spotify.com`. Scripts and styles load from the site itself, and images from the site and Spotify's image hosts.
- **No third-party code at runtime.** No analytics, fonts, CDNs or error reporters.
- **No secret.** The app never asks for a client secret, and the setup guide tells users not to paste one.
- **Short-lived tokens.** Tokens stay in `sessionStorage` and are never written to `localStorage`, logs, URLs or the backup file.
- **Few dependencies.** Two runtime packages, a committed lockfile, and `npm ci` in CI.

GitHub Pages cannot send custom headers, so the policy is a meta tag. The development server needs a looser policy, so the strict one is applied to the production build only.

## Branding rules

Spotify's guidelines apply because the app shows Spotify metadata.

- The app is called "Playlist Repair", with "for Spotify" as a tagline. "Spotify" is never part of the name, domain or logo.
- The logo does not use Spotify's green, circle or waves.
- Content from Spotify is credited with the official Spotify logo, used unmodified.
- Track, album and artist names are shown as Spotify returns them and link back to Spotify.
- Album art is not cropped or overlaid, and has rounded corners.

## Testing

| Layer | Tool | Covers |
| --- | --- | --- |
| Engine | Vitest | Normalizing, scoring, tiers, ties, and the fixture set |
| Spotify client | Vitest with a fake `fetch` | Paging, 429 and `Retry-After`, quota stop, token refresh |
| Repair flow | Vitest with a fake client | Insert order, batching, resume, each edge case |
| App | Playwright with mocked routes | Setup through Done, plus the error paths |

**Fixtures.** The review screen has a development-only "export as fixture" action that saves a dead track and its candidates as JSON, with the correct answer marked by hand. Real cases from Jim's playlists go into `tests/fixtures/`, and the thresholds are tuned until the Exact and High tiers contain no wrong matches.

**By hand.** Login, scanning and applying are checked against real Spotify on `127.0.0.1`, using a copy of a real playlist so the original is never at risk.

## Hosting and deployment

- **Host.** GitHub Pages, deployed by a GitHub Actions workflow on every push to `main`.
- **Domain.** `playlistrepair.com` as the custom domain, with `www` redirecting to it and HTTPS enforced. `public/CNAME` keeps the setting across deploys.
- **CI.** Every push runs typecheck, lint, unit tests and the build. Playwright runs before deploy.
- **Moving hosts.** The domain is the fixed point. If headers are ever needed, Cloudflare Pages can serve the same build at the same URL.

## Build order

There are eight milestones, each small enough for one session and each ending in a check.

| # | Milestone | Check |
| --- | --- | --- |
| 1 | Project scaffold and CI | `npm run check` passes locally and in GitHub Actions |
| 2 | Matching engine | Unit tests pass, and `src/engine/` imports nothing outside itself |
| 3 | Setup screen and login | Jim logs in on `127.0.0.1` with his own client ID, a reload keeps the session, and log out clears it |
| 4 | Spotify client and playlist scan | The broken count for a real playlist matches the greyed-out tracks in the Spotify desktop app |
| 5 | Candidate search and review screen | On a real playlist, every Exact and High match is correct |
| 6 | Apply, backup and verify | A copy of a real playlist is repaired with order kept, no duplicates and no dead tracks left |
| 7 | Error paths, accessibility and Content Security Policy | Playwright passes, the console shows no policy violations, and the whole flow works by keyboard |
| 8 | Deploy, setup guide, privacy page and README | The site is live, and a second person completes setup from the guide alone |

Milestone 5 carries the most product risk, since match quality is the reason to build this. Milestone 4 answers most of the open questions about the API.

**Order for v1.** Milestones 3 and 4 come first, in the week of October 5. Milestone 2 has no dependency on them, so it moves to the week of October 12 with milestone 5. Milestone 6, the setup guide, the README and the demo video are the week of October 19.

## Working with Claude Code

This plan is the brief, and each session implements one milestone from it. `CLAUDE.md` holds the standing rules and is read at the start of every session.

1. Start a session in the project folder and paste the prompt for the next milestone.
2. For milestones 4 to 6, use plan mode first so Claude proposes an approach before changing files.
3. Do the check yourself when it needs a real Spotify account, and tell Claude what you saw.
4. Commit, then start a new session for the next milestone.

Claude can run the typecheck, tests and build itself. It cannot log in to Spotify, so anything involving a real account is your check.

**Milestone 1: scaffold**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 1 only:
the project scaffold and CI.

Set up Vite, React and TypeScript in strict mode, with ESLint, Prettier,
Vitest and Playwright installed and configured. Bind the dev server to
127.0.0.1:5173 with strictPort. Create the folder layout from the plan
with a placeholder screen, the npm scripts listed in CLAUDE.md, a
.gitignore, an MIT LICENSE, a short README, and a GitHub Actions workflow
that runs `npm run check` on every push. Run `git init` if the folder is
not a repository yet.

Runtime dependencies must be react and react-dom only. Stop when
`npm run check` passes. Summarise what you built and anything in the plan
that proved wrong.
```

**Milestone 2: matching engine**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 2 only:
the matching engine in src/engine/, as described in the plan's "Matching
engine" section.

Write it test-first. Cover normalizing, title and version-tag splitting,
each score part, the tier rules, the caps and the tie-breaks. Invent
fixtures for the common cases: a re-delivered album with the same ISRC, a
remaster, a live version, a clean versus explicit pair, a compilation
copy, a feat. credit moved between title and artist, and a track with no
good match. Put weights and thresholds in src/config.ts.

Also handle local files, as described in the plan's "Matching engine"
section: no ISRC, an unknown explicit flag, and a duration in whole
seconds. Add fixtures for a local file with a clear match, one with only
a loose match, and one whose tags are missing, and test that none of
them reach Exact.

The engine must not import anything outside src/engine/ except config,
and must not use fetch or the DOM. Add a lint rule or test that enforces
this. Stop when the tests pass. Summarise what you built and anything in
the plan that proved wrong.
```

**Milestone 3: setup and login**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 3 only:
the Setup and Connect screens and src/spotify/auth.ts, as described in
the plan's "Authentication" section.

Write PKCE by hand on Web Crypto, with no auth library. Include the state
check, the token exchange, refresh, and log out. Keep the client ID in
localStorage and everything else in sessionStorage. After login, call
GET /me and show the display name. Unit-test the verifier, challenge,
state handling and refresh logic with a fake fetch.

I will do the real login check myself on http://127.0.0.1:5173/ and tell
you what I see. Before you stop, tell me exactly what to enter in the
Spotify developer dashboard. Summarise what you built and anything in the
plan that proved wrong.
```

**Milestone 4: client and scan**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 4 only:
the Spotify client and the playlist scan.

Build the fetch wrapper with the throttle, 429 and Retry-After handling,
the QUOTA_EXCEEDED stop, and the single 401 refresh-and-retry. Add
endpoint functions and response guards for /me/playlists and
/playlists/{id}/items. Build the Playlists screen: list owned and
collaborative playlists, scan one or all, and show a broken count using
the rules in "Detecting broken tracks". Test paging, retry and the
detection rules with a fake fetch.

Add a development-only panel that shows the raw item for any broken
track, so I can check these open questions against my real playlists:
whether omitting `market` works, what `restrictions.reason` values
appear, and what a removed track looks like. I will report what I see.
Update the plan's open questions with the answers. Summarise what you
built and anything in the plan that proved wrong.
```

**Milestone 5: search and review**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 5 only:
candidate search and the Review screen.

In src/repair/, run the three-step search from the plan for each broken
track, cache results, and pass candidates to the engine. Build the Review
screen: tracks grouped by tier, select-all per group, per-row selection,
a candidate picker for choosing a different match, and the differences
between dead track and replacement marked on each row.

On the Playlists screen, add "Find fixes" for a scanned playlist, with a
checkbox to include local files that is off by default and an estimated
request count shown first. Local-file matches are never preselected.
Cache searches by artist, title and duration. Add the
development-only "export as fixture" action.

I will run it on real playlists, export fixtures, and mark the correct
answers. Then tune the weights and thresholds in src/config.ts until the
Exact and High tiers contain no wrong matches in the fixture set, and
tell me what you changed and why. Summarise what you built and anything
in the plan that proved wrong.
```

**Milestone 6: apply**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 6 only:
apply, backup and verify, as described in "Applying a repair".

Build the snapshot check, the backup download, bottom-up inserts with
neighboring replacements batched, removal in batches of 100, the
verifying rescan, per-track progress with Resume, and the Apply and Done
screens. Handle each edge case in the plan. Test the insert ordering,
batching, resume after a failure at each step, and every edge case with
a fake client.

Inserts must always complete before any removal. Also test removing a
local file by its spotify:local: URI on the copy, and report whether it
works. If it does not, remove by position and say so in the plan. I will test on a copy
of a real playlist, never an original, and tell you what I see. That
test also answers whether removing by URI removes every occurrence;
update the plan with the answer. Summarise what you built and anything
in the plan that proved wrong.
```

**Milestone 7: hardening**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 7 only:
error paths, accessibility and the Content Security Policy.

Write Playwright tests against mocked accounts.spotify.com and
api.spotify.com routes, covering Setup through Done plus: a wrong client
ID, a denied login, an expired token mid-scan, a 429, a quota stop, a
playlist changed between scan and apply, and a failure halfway through
apply. Add the production-only Content Security Policy meta tag from
"Security and privacy" and a test that fails on any policy violation.
Make every screen usable by keyboard with visible focus and proper
labels, and check color contrast.

Stop when `npm run check` and `npm run e2e` pass. Summarise what you
built and anything in the plan that proved wrong.
```

**Milestone 8: deploy and docs**

```text
Read CLAUDE.md and docs/technical-plan.md. Implement milestone 8 only:
deployment and documentation.

Add the GitHub Pages deploy workflow and public/CNAME for
playlistrepair.com. Write docs/setup-guide.md from the plan's "Setup
guide" section and show the same steps on the Setup screen, with a copy
button for the redirect URI. Write public/privacy.html. Apply the
"Branding rules" section across the app. Rewrite the README for someone
reviewing this as a portfolio piece: what it does, why each user brings
a client ID, how matching works, the security model, and how to run it
locally on 127.0.0.1.

Tell me which DNS records and GitHub settings I need to set by hand.
Summarise what you built and anything in the plan that proved wrong.
```

## Setup guide

This is the draft of what each user follows. For v1 it is written alongside milestone 6, after the run steps from the README, and the app runs locally. Check the wording against the live developer dashboard when writing it.

1. You need Spotify Premium. Spotify requires it for the owner of a development-mode app.
2. Go to `https://developer.spotify.com/dashboard`, log in, and choose **Create app**.
3. Give it any name and description. The name must not contain "Spotify".
4. Set the redirect URI to `http://127.0.0.1:5173/`, exactly as written, including the final slash. Once the hosted site exists, this becomes `https://playlistrepair.com/`.
5. Choose **Web API** when asked which API the app uses.
6. Accept the terms and save.
7. Open the app's settings and copy the **Client ID**. Do not copy the client secret. Playlist Repair never needs it.
8. Paste the Client ID into Playlist Repair and choose **Connect**.

To disconnect later, log out in Playlist Repair and remove the app under "Manage apps" in your Spotify account.

## Risks and open questions

The largest risk is not technical: Spotify's Developer Policy may not allow the bring-your-own-client-ID model on a hosted site.

**Risks.**

- **One client ID per app.** Developer Policy section VII.2 says to use a separate client ID for each app and not more than one client ID per app. Many users registering their own client ID for the same hosted site may conflict with that. Running your own copy on `127.0.0.1` is the clearly safe form. Decide whether to ask on Spotify's developer forum before publicizing the hosted site.
- **Rule changes.** Spotify changed development mode in February, March and July 2026. Another change could remove something this depends on, such as the ISRC or the search filters.
- **Premium only.** Every user must have Premium and be willing to create a developer app. The audience is small.
- **Match quality.** Some dead tracks have no ISRC match and weak metadata. Those must land in Review or None, never in a preselected tier.
- **Date added.** Replacements lose the original date. The backup file is the only record.

**Open questions.**

Test case from Jim's playlists, Oct 6, 2026: "Step On It" by Robben Ford & The Blue Line (ISRC `USGR19200025`) is market-removed, and `isrc:USGR19200025` returns nothing, so it has no playable copy by ISRC. Its neighbour "Start It Up" (`USGR19200028`) is playable on the compilation "The Firm". Use the first as a "no match" fixture in milestone 5.

A full scan of 120 playlists, Oct 6, 2026, covered 14,185 entries: 10,515 ok, 134 broken and 3,536 local files. There were no removed (null-item), unknown, `explicit`, `product` or other-restriction entries. So no removed track has been seen on this account, and the question of what one looks like is open for another account.

Real data from Jim's playlists, Oct 6, 2026: a local file has `is_local: true`, a `spotify:local:` URI, `id: null` and no `is_playable`. Local files are counted as skipped, and a playlist of imported files can show 0 broken.

- [x] Does omitting `market` return `is_playable` for playlist items and search results? (milestone 4) **Yes, for both, checked on Jim's account on Oct 6, 2026. Playlist items had `is_playable` true and false with no `market` sent. A plain-text search for "Step On It Robben Ford" returned 10 results, every one with `is_playable: true`. Rescanning a playlist with `market` set to US and to GB changed nothing. Not yet seen: a search result with `is_playable: false`, so it is not known whether search hides unplayable tracks. Milestone 5 still scores only playable candidates.**
- [x] Does search need the `user-read-private` scope to use the account's country? (milestone 4) **No. Search worked with only the four playlist scopes on Oct 6, 2026, with no 403. The scopes stay as they are. Whether results follow the account's country is not directly visible, but every result came back playable.**
- [ ] Which `restrictions.reason` values appear in real playlists, and can a greyed-out track have none? (milestone 4) *Partly answered on Oct 6, 2026: on one playlist, all 4 tracks with `is_playable: false` had reason `market`, and none had no reason. Other values (`explicit`, `product`) have not been seen, and one playlist is a small sample.*
- [x] Does the app owner need to add themselves under User Management, or are they allowed automatically? (milestone 3) **No. The owner is allowed automatically: Jim logged in on Oct 6, 2026 without adding his account.**
- [ ] Does removing by URI remove every occurrence of that track? (milestone 6)
- [ ] Can a `spotify:local:` entry be removed by URI, or only by position? (milestone 6)
- [x] Which image hosts does album art come from, for the Content Security Policy? (milestone 4) **Four hosts seen on Jim's playlists on Oct 6, 2026: `i.scdn.co` (album art), `mosaic.scdn.co`, `image-cdn-ak.spotifycdn.com` and `image-cdn-fa.spotifycdn.com`. The `-ak` and `-fa` names suggest more CDN variants exist, so milestone 7 should allow `https://*.scdn.co` and `https://*.spotifycdn.com` in `img-src`, not just these four.**
- [ ] What request rate triggers a 429 in development mode? Set the throttle from what milestone 4 shows. *Partly answered on Oct 6, 2026. The rate limit was never hit: 0 rate limits over about 800 requests at 2 in flight, so the throttle stays at 2. The quota was hit: a first "Scan all" sent 437 requests with no limit, and a second one stopped with 2 `QUOTA_EXCEEDED` replies after 360 requests, having scanned 120 playlists. That is about 800 requests in one session. Spotify publishes no numbers or reset time. The reset time is still unknown: Jim should try again later and report when scanning works again.*
- [ ] Is the hosted site acceptable under Developer Policy section VII.2, or should the project be self-run only?

## Sources

- [Spotify: Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify: February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify: Web API changelog, March 2026](https://developer.spotify.com/documentation/web-api/references/changes/march-2026)
- [Spotify: Web API quota updates, July 2026](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)
- [Spotify: Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify: Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)
- [Spotify: Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
- [Spotify: Scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes)
- [Spotify: Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Spotify: Get playlist items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)
- [Spotify: Add items to playlist](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist)
- [Spotify: Remove playlist items](https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist)
- [Spotify: Search](https://developer.spotify.com/documentation/web-api/reference/search)
- [Spotify: Design and branding guidelines](https://developer.spotify.com/documentation/design)
- [Spotify: Developer Policy](https://developer.spotify.com/policy)
- [Playlist Hospital](https://playlisthospital.com/)
