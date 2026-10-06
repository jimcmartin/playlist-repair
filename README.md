# Playlist Repair

_for Spotify_

A browser-only web app that finds greyed-out tracks in your Spotify playlists, matches each one
to a playable version of the same recording, and swaps them in after you approve. It has no
backend, and each user connects with their own Spotify client ID.

**Status:** early development. Setup and Spotify login work; scanning and repair do not exist yet. The design and build
order are in [docs/technical-plan.md](docs/technical-plan.md). The first version (v1) will run
locally and include a setup guide; its scope is in the plan.

## Run it locally

You need Node.js 24 or later.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. Use that address and not `localhost`: Spotify only accepts the
loopback IP as a local redirect URI.

## Scripts

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

## License

[MIT](LICENSE)
