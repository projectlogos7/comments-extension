# Pinpoint server

Fastify 5 + PostgreSQL. One process serves the REST API, the WebSocket, signed file downloads, the share viewer (`/share/:token`) and the built web app (`/app/`).

## Run locally

```bash
npm install
DEV_LOGIN=1 npm run dev -w server        # http://localhost:8787, embedded Postgres (PGlite) in server/data
```

Without `DATABASE_URL` the server uses [PGlite](https://pglite.dev) (Postgres compiled to WASM) stored in `DATA_DIR/pglite`, so no database install is needed for development. With `DATA_DIR=:memory:` everything is in memory (tests). For production, set `DATABASE_URL` to a real PostgreSQL 14+ database.

Production build: `npm run build -w server` bundles to `server/dist/index.js` (dependencies stay external); run with `node server/dist/index.js`. `npm run migrate -w server` applies migrations without starting the server (migrations also run on boot).

Tests: `npx vitest run server` (each test file boots an in-memory app; WebSocket tests listen on a random port).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen address |
| `PUBLIC_URL` | `http://localhost:$PORT` | External base URL used in links, emails, OAuth callbacks and signed file URLs |
| `DATABASE_URL` | — | PostgreSQL connection string. Absent → PGlite |
| `PG_POOL_SIZE` | `10` | pg pool size |
| `DATA_DIR` | `server/data` | PGlite data and local file storage. `:memory:` for ephemeral |
| `JWT_SECRET` | dev value | **Required in production** (`NODE_ENV=production`). Signs access tokens, OAuth state, download tokens and file URLs |
| `SMTP_URL` | — | e.g. `smtps://user:pass@smtp.example.com`. Absent → emails are logged and kept in memory (`GET /dev/mailbox` with `DEV_LOGIN=1`) |
| `MAIL_FROM` | `Pinpoint <no-reply@pinpoint.local>` | Sender |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Google sign in. Redirect URI: `PUBLIC_URL/api/v1/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT` | — / — / `common` | Microsoft sign in. Redirect URI: `PUBLIC_URL/api/v1/auth/microsoft/callback` |
| `STORAGE` | `local` | `local` (under `DATA_DIR/files`) or `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | S3 or S3-compatible storage (objects written with SSE-AES256). Put a CDN in front of the server's `/files/` route if needed |
| `DEV_LOGIN` | off | `1` enables `POST /auth/dev-login`, `devLink` in email sign-in responses and `/dev/mailbox`. Never enable in production |
| `EXTENSION_IDS` | — | Comma-separated extension ids the share viewer may talk to (`externally_connectable`) |
| `JOBS` | on | `0` disables background jobs |
| `LOG` / `LOG_LEVEL` | on / `info` | Logging (the `Authorization` header is redacted) |
| `WEB_DIR` | `server/public/app` | Built web app served at `/app/` with SPA fallback |

## Architecture

```
src/
  app.ts            buildApp(): plugins, security headers, error format, routes, static web app
  index.ts          entry point
  config.ts         env → Config
  db.ts             Db interface over pg Pool or PGlite; transactions; LISTEN/NOTIFY
  migrations.ts     versioned SQL migrations (applied on boot)
  context.ts        principals (JWT user or API key), role checks, guest scope, thread access
  model.ts          row → API shape (Thread, Comment, Member…), batch loaders, signed URLs
  storage.ts        local disk / S3 storage + HMAC-signed file URLs
  mail.ts, bus.ts   mailer (SMTP or dev outbox), in-process event bus (+ pg NOTIFY fan-out)
  share-page.ts     server-rendered share viewer
  routes/           auth+me, workspaces, threads+comments, files, share, notifications, views, export, integrations, telemetry, ws
  services/         auth, membership, threads (query builder, patching), notify (+digests), events, webhooks, integrations, pdf, activity, jobs
```

- **Data**: thread anchors, anchor history, workspace privacy and notification preferences are `jsonb`. `pages` has a per-page sequence for pin numbers. Comments and page titles have generated `tsvector` columns with GIN indexes for search.
- **Security**: every role check runs on the server; workspaces and threads a caller cannot see return 404. Refresh tokens and API keys are stored as SHA-256 hashes; refresh tokens rotate with reuse detection. Comment bodies are only ever rendered through `renderBody` (escape first). Uploaded images are checked by magic number. File URLs are signed and expire (1 h in API responses, 7 days on share pages, 30 days in exports). DOM snapshots are served with `Content-Security-Policy: sandbox`. The share page uses a nonce CSP, `noindex`, `no-referrer`, and never renders members-only content server-side.
- **Real time**: events go to an in-process bus; with real Postgres they are also published with `NOTIFY pinpoint_events`, so several instances can sit behind a load balancer (WebSockets need sticky sessions or any instance works since every instance receives every event).
- **Jobs** (hourly, single-flight): purge comments soft-deleted >30 days, remove files of deleted threads, apply per-workspace snapshot retention, drop orphan attachments, delete queued files from storage, expire tokens, trim telemetry (180 days), send daily digests (at most one per user per 24 h).
- **Offline/idempotency**: thread and comment creation accept a `clientId`; retries return the original record.

## Deploying

1. Provision PostgreSQL and (optionally) an S3 bucket.
2. Set `NODE_ENV=production`, `PUBLIC_URL`, `JWT_SECRET` (32+ random bytes), `DATABASE_URL`, `SMTP_URL`, OAuth credentials, `EXTENSION_IDS`.
3. `npm ci && npm run build` (builds web app, extension and server), then `node server/dist/index.js` behind a TLS-terminating proxy that forwards WebSocket upgrades on `/api/v1/ws`.
4. Health check: `GET /api/v1/health`.
