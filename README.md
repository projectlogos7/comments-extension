# Pinpoint

Pinpoint is a team page-annotation tool for Chrome and other Chromium browsers (Edge, Brave, Opera, Arc). Select any part of a live page, comment on it, mention a teammate, and keep every comment in one shared, searchable place. Developers can copy the element's selector, path or component straight from the comment.

This repository holds the full product described in the PRD:

| Part | Path | What it is |
| --- | --- | --- |
| Shared contract | `packages/shared` | Domain types, URL normalization/matching, comment formatting, role matrix, export formatters, typed REST client, extension message protocol |
| Shared UI | `packages/ui` | Preact components used by both the web app and the extension (thread list, filters, thread view, inbox, export, settings) |
| Backend | `server` | Fastify + Postgres (or embedded PGlite) API, WebSocket live updates, snapshots storage, share viewer, notifications, exports, integrations |
| Web app | `web` | All comments, inbox, threads, settings and sign-in, served by the server at `/app/` |
| Extension | `extension` | Manifest V3 extension: comment mode overlay, anchoring, pins, composer, snapshots, side panel, popup |

## Quick start (local)

Requires Node 20.11+.

```bash
npm install
```

```bash
npm run build
```

```bash
DEV_LOGIN=1 npm run dev
```

The server runs at http://localhost:8787. It uses an embedded Postgres (PGlite) in `server/data`, unless `DATABASE_URL` is set. With `DEV_LOGIN=1` you can sign in with any email; sign-in links are printed to the console and kept in the dev mailbox at `/dev/mailbox`.

Load the extension:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `extension/dist`.
3. Open the Pinpoint popup and sign in. Create a workspace, then add your sites under **Settings → Allowed sites**. Localhost always works.
4. Press **Alt+Shift+C** on an allowed page to start commenting.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | All unit and API tests (vitest) |
| `npm run typecheck` | TypeScript across every package |
| `npm run build` | Web app → `server/public/app`, extension → `extension/dist`, server → `server/dist` |
| `npm run zip -w extension` | Store package at `extension/pinpoint-extension.zip` |
| `docker compose up` | Server + Postgres 17 (copy `.env.example` to `.env` first) |

## Configuration

See `.env.example` and `docs/SERVER.md`. Set `PINPOINT_SERVER_ORIGINS` when building the extension for a server other than `http://localhost:8787`. Put the published extension ID in the server's `EXTENSION_IDS` so the share viewer can offer **Open on live page**.

## Documentation

- `docs/API.md`: every REST route, WebSocket events, webhooks and the public API
- `docs/SERVER.md`: server architecture, configuration, jobs, storage, deployment
- `docs/EXTENSION.md`: extension architecture, permissions rationale, anchoring, packaging
- `docs/WEB.md`: web app and shared UI host architecture

## Known limitations

- Google/Microsoft sign-in, Jira, Microsoft Teams and S3 storage have not been tested against the real services. GitHub, Linear and Slack were tested against mocked HTTP only.
- Chrome only allows screen capture after a user gesture (`activeTab`) or with access to all sites. Comments started from the selected-text button, and re-attaching a thread, save without a snapshot unless the user grants access to all sites.
- Rate limits (per user / API key, configurable with `RATE_LIMIT_*`, see `docs/SERVER.md`) are kept in memory per server instance.
- Firefox and Safari are out of scope, as the PRD says.
