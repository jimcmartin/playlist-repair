# Playlist Repair

A browser-only web app that finds greyed-out tracks in a user's Spotify playlists,
matches each to a playable version of the same recording, and swaps them in after
the user approves. No backend. Each user connects with their own Spotify client ID.
It will be hosted at https://playlistrepair.com/.

The full plan is in `docs/technical-plan.md`. Read it before starting a milestone.
It is the source of truth for scope, architecture and build order.

## How to work

- Implement one milestone per session, as numbered in the plan's "Build order".
- Stop when that milestone's check passes. Do not start the next one.
- If the plan proves wrong or a decision changes, update `docs/technical-plan.md`
  in the same change and say so in your summary.
- When a milestone answers one of the plan's open questions, tick it and write
  the answer beside it.
- Create folders and files only where the plan's "Repository layout" puts them.
- You cannot log in to Spotify. Checks that need a real account are Jim's:
  say exactly what to do and what to look for, then wait for the result.

## Layout

- `src/engine/` is the matching engine: pure functions, no network, no DOM.
- `src/spotify/` holds auth (PKCE), the fetch wrapper, endpoint functions and types.
- `src/repair/` holds the flow: scan, candidate search, apply, backup.
- `src/ui/` holds React screens and components.
- `src/config.ts` holds scopes, endpoints, thresholds and throttle settings.
- `tests/` holds unit tests and fixtures. `e2e/` holds Playwright tests.

## Build and test

```sh
npm run dev         # dev server on http://127.0.0.1:5173/
npm run typecheck
npm run lint
npm test            # Vitest
npm run build
npm run e2e         # Playwright against a mocked Spotify API
npm run check       # typecheck, lint, test and build together
```

Run `npm run check` before reporting a milestone done.

## Rules that must hold

- **No backend.** Static files only. Never add a server, proxy or serverless function.
- **Two hosts.** Network requests go only to `https://accounts.spotify.com` and
  `https://api.spotify.com`. Never add analytics, fonts, CDNs or error reporting.
- **No secret.** Auth is Authorization Code with PKCE. Never ask for, store or
  mention using a client secret.
- **Token storage.** Tokens and the PKCE verifier live in `sessionStorage` only.
  Never put them in `localStorage`, logs, URLs, error messages or the backup file.
  Only the client ID may go in `localStorage`.
- **Redirect URI.** `https://playlistrepair.com/` in production and
  `http://127.0.0.1:5173/` locally. Never `localhost`. Do not change either:
  users have registered the production value in their own Spotify apps.
- **Pure engine.** `src/engine/` imports nothing outside itself except config,
  and never calls `fetch` or touches the DOM.
- **Nothing changes without approval.** A playlist is only written to after the
  user approves on the Review screen.
- **Insert before remove.** Every replacement is inserted before any dead track
  is removed, so a failure never loses a track.
- **Runtime dependencies.** `react` and `react-dom` only. Ask before adding another.
- **Naming.** The app is "Playlist Repair", with "for Spotify" as a tagline.
  "Spotify" is never part of the app name or logo, and the logo never uses
  Spotify's green, circle or waves.

## Spotify API notes

Development mode changed in 2026, and most tutorials and libraries are out of date.
Trust the plan and Spotify's current reference over memory.

- Playlist endpoints are `/playlists/{id}/items`, not `/tracks`. Each entry's
  track is under `item`.
- Search returns at most 10 results per request.
- There is no batch track lookup. `GET /tracks?ids=` is gone.
- Tracks have no `linked_from`, `available_markets` or `popularity`. The profile
  has no `country`. Tracks do have `external_ids.isrc`.
- Playlist contents are only returned for playlists the user owns or collaborates on.
- A 429 with `"reason": "QUOTA_EXCEEDED"` is a quota stop, not a rate limit.
  Do not retry it in a loop.

## Conventions

- TypeScript strict mode. No `any`. Validate API responses with small guards.
- React function components and hooks. No router, state library or CSS framework.
- Write engine and repair-flow code test-first.
- Every user-facing error says what happened, what was kept, and what to do next.
- Commit `package-lock.json`. CI installs with `npm ci`.
