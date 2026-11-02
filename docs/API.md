# Pinpoint REST API (v1)

Base path: `{PUBLIC_URL}/api/v1`. The typed client in `packages/shared/src/api.ts` maps one-to-one to these routes and is the source of truth for request and response shapes (`packages/shared/src/types.ts`).

## Conventions

- **Auth**: `Authorization: Bearer <accessToken>` (user session, 15 min JWT) or `Bearer pk_…` (workspace API key; acts as an admin of that one workspace; cannot call `/me` or create API keys).
- **Errors**: non-2xx bodies are `{ "error": { "code": string, "message": string } }`. Common codes: `unauthorized` (401), `forbidden` (403), `not_found` (404; also returned for workspaces/threads you cannot see), `validation_error` (400), `conflict`/`last_owner`/`transfer_ownership` (409), `file_too_large` (413), `rate_limited` (429).
- **Ids** are UUIDs. Timestamps are ISO 8601 UTC.
- **Pagination**: `GET …/threads` returns `{ items, total, nextCursor }`; pass `cursor` back.
- **Rate limits** (configurable, see SERVER.md): 1200 req/min per signed-in user or API key, 120 req/min per IP for anonymous requests, `POST /auth/email` 5/min per IP, invite resend 10/min, telemetry 60/min, errors 30/min. Responses carry `X-RateLimit-*`; a 429 carries `Retry-After` and error code `rate_limited`. File downloads, web-app assets, health/config and WebSocket upgrades are not counted.
- Role checks follow `packages/shared/src/permissions.ts` and are enforced on the server.

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/providers` | `{ google, microsoft, email, dev }` — which sign-in methods are configured |
| GET | `/auth/{google\|microsoft}/start?redirect=` | Starts OAuth. `redirect` must be `https://<extension-id>.chromiumapp.org/…` or under `PUBLIC_URL`. Ends at `redirect#accessToken=…&refreshToken=…&expiresIn=…` |
| GET | `/auth/{provider}/callback` | OAuth callback (configure this URL at the IdP) |
| POST | `/auth/email` | `{ email, redirect }` → `{ sent: true, devLink? }`. Sends a 15-minute single-use link (`devLink` only with `DEV_LOGIN=1`) |
| GET | `/auth/email/verify?token=` | Link target; redirects like OAuth |
| POST | `/auth/refresh` | `{ refreshToken }` → `AuthTokens`. Rotating; reusing an old refresh token revokes all of the user's sessions |
| POST | `/auth/logout` | `{ refreshToken }` → 204 |
| POST | `/auth/dev-login` | `{ email, name? }` → `AuthTokens`. Only with `DEV_LOGIN=1` |
| GET | `/me` | `Me` (user, memberships, analyticsOptOut) |
| PATCH | `/me` | `{ name?, avatarUrl?, analyticsOptOut? }` → `Me` |
| GET | `/me/export` | GDPR export of every record about the user (JSON download) |
| DELETE | `/me` | Deletes the account (409 `transfer_ownership` if sole owner of a shared workspace). Comments stay, attributed to "Deleted user" |

Signing in with a verified email automatically accepts pending email invitations for that address.

## Workspaces, members, invites

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| POST | `/workspaces` | any user | `{ name }` → `Membership`; creator is owner |
| GET | `/workspaces/:ws` | member | `inviteToken` only for admins/owners |
| PATCH | `/workspaces/:ws` | admin | `{ name?, allowedSites?, linkSharing?, emailDomain?, privacy? }`. Sites are normalized (`https://www.x.com/a` → `x.com`; `*.x.com` allowed) |
| DELETE | `/workspaces/:ws` | owner | Deletes everything; files queued for removal |
| GET | `/workspaces/:ws/members` | member | `Member[]` |
| PATCH | `/workspaces/:ws/members/:id` | admin | `{ role }`; admins cannot touch owners; the last owner cannot be demoted |
| DELETE | `/workspaces/:ws/members/:id` | admin, or self (leave) | |
| PUT | `/workspaces/:ws/me/preferences` | member | `NotificationPrefs` → `Member` |
| GET/POST | `/workspaces/:ws/invites` | admin | POST `{ emails[], role }` → `Invite[]`, emails a link `PUBLIC_URL/app/#/invite/<token>`. Addresses that already belong to members are skipped. If any non-guest address is outside `emailDomain`, nothing is sent and the 400 `domain_restricted` message names the addresses |
| POST | `/workspaces/:ws/invites/:id/resend` | admin | email the same invitation link again → `Invite` (404 once accepted or revoked) |
| DELETE | `/workspaces/:ws/invites/:id` | admin | revoke |
| POST/DELETE | `/workspaces/:ws/invite-link` | admin | rotate → `{ token, url }` / disable |
| GET | `/invites/:token` | public | `{ workspaceName, role, kind: email\|link\|guest }` |
| POST | `/invites/:token/accept` | user | → `Membership`. Email invites must be accepted by the invited address; accepting an already-used email invite again returns the membership (sign-in auto-accepts pending invites first), or 410 `invite_used` if the person is no longer a member. Link joins honour the domain restriction (403 `domain_restricted` with a plain-words message); guest links create a guest membership |
| GET/POST | `/workspaces/:ws/guest-links` | admin | POST `{ threadIds?, pageIds? }` → `GuestGrant & { url }` (FR-7.7) |
| DELETE | `/workspaces/:ws/guest-links/:id` | admin | revoke; guests lose access immediately |
| GET | `/workspaces/:ws/activity?threadId=` | member (guests: only for a visible thread) | `ActivityEntry[]` (FR-7.8) |

Token prefixes: `inv_` email invite, `lnk_` invite link, `gst_` guest link.

## Pages and threads

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/workspaces/:ws/threads/for-url?url=` | `{ page, threads }` — threads whose `urlMatch` (exact/path/site) matches the URL; tracking params ignored |
| GET | `/workspaces/:ws/threads` | Filters: `status, authorId, assigneeId, unassigned, mentionsMe, scope, type, priority, site, pageId, from, to, q, unread, detached`; `sort=activity\|oldest\|page\|priority`; `limit` (≤200), `cursor` |
| GET | `/workspaces/:ws/pages?site=` | Pages with `threadCount`, `openCount` |
| POST | `/workspaces/:ws/threads` | `CreateThreadInput` → `ThreadDetail`. `clientId` makes retries idempotent. Mentions (`@[Name](userId)`) count only for workspace members |
| GET | `/threads/:id` | `ThreadDetail` (comments, snapshot history) |
| PATCH | `/threads/:id` | `UpdateThreadInput`. Changing `scope`/`anchor` appends the old anchor to `anchorHistory` and clears `detached` |
| DELETE | `/threads/:id` | author or admin; soft delete, files removed by the next job run |
| POST | `/workspaces/:ws/threads/bulk` | `{ ids, action: resolve\|reopen\|assign\|type\|priority\|delete, assigneeId?, type?, priority? }` → `{ updated }` |
| POST | `/threads/:id/read` | marks the thread and its notifications read |
| POST | `/threads/:id/comments` | `{ body, attachmentIds?, clientId? }` → `Comment`; notifies mentions and participants |
| PATCH | `/comments/:id` | author only; previous body kept in `comment_history`; newly added mentions notified |
| DELETE | `/comments/:id` | author or admin; soft delete |
| POST | `/comments/:id/restore` | within 30 days |
| POST | `/comments/:id/reactions` | `{ emoji }` toggles |

Full-text search (`q`) covers comment and reply bodies (Postgres `websearch_to_tsquery`, English stemming, plus substring match), page titles and URLs.

## Files

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/threads/:id/snapshots` | multipart: `kind` (area\|viewport\|fullpage\|dom), `context` (JSON `SnapshotContext`), `width?`, `height?`, `file`. Images are verified by magic number (PNG/JPEG/WebP), ≤25 MB; DOM snapshots ≤5 MB. Author or admin only. A new snapshot of the same kind replaces the old one (`replacedAt`), which stays in `snapshotHistory`. Rejected with 403 when the workspace disables full-page/DOM snapshots |
| POST | `/workspaces/:ws/attachments` | multipart `file` (PNG/JPEG/GIF/WebP, ≤5 MB) → `Attachment`; link with `attachmentIds` on a comment |
| GET | `/files/<key>?exp=&sig=` | (outside `/api/v1`) HMAC-signed, time-limited URLs as returned in API responses. DOM snapshots are served with a `sandbox` CSP |

## Sharing

| Method | Path | Notes |
| --- | --- | --- |
| POST/DELETE | `/threads/:id/share` | create (idempotent) → `ShareInfo` / revoke |
| POST/DELETE | `/pages/:id/share` | page link listing every thread on the page |
| GET | `/share/:token` | `SharedView`. Anonymous when the workspace `linkSharing` is `anyone`; otherwise requires a member session (401/403) |

Web viewer (outside `/api/v1`):

- `GET /share/:token` — server-rendered page. For `anyone` links the content, Open Graph and Twitter card tags (with a 7-day signed snapshot image) are rendered inline. For members-only links the page shows only generic metadata and a sign-in box (Google/Microsoft/email, redirecting back to the same URL), then loads the content with the stored session from `localStorage["pinpoint.auth"]` (`{ accessToken, refreshToken, expiresAt }`).
- `GET /share/:token/content` — the same content as an HTML fragment (bearer auth).
- Signed-out visitors of a members-only link get "Sign in to Pinpoint", which goes to `/app/#/login?next=/share/<token>`; after signing in, the web app sends them straight back (only `/share/<token>` paths are accepted as `next`). A signed-in non-member sees "You don't have access". A revoked link renders "This link was turned off" (404).
- Each thread has "Open on live page" (page URL + `?pinpoint_thread=<id>`) and "Reply in Pinpoint" (`/app/#/all?thread=<id>`).
- "Open page" links append `?pinpoint_thread=<threadId>` to the page URL. When `EXTENSION_IDS` is set, the viewer pings each extension with `chrome.runtime.sendMessage(id, {type:'ping'})` and, if one answers, offers "Open on live page", which sends `{type:'thread.openOnPage', threadId, url}`.

## Notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notifications?workspaceId=&unread=&limit=` | in-app inbox |
| GET | `/notifications/counts?workspaceId=` | `{ mentions, notifications }` unread |
| POST | `/notifications/read` | `{ ids? , all?, threadId? }` |

Events: `mention`, `reply` (to the thread author, assignee and previous commenters), `assignment`, `resolution` (to the author). Each member chooses in-app/email/chat per event and `immediate` or daily `digest` email. Emails link to the live page (`?pinpoint_thread=`) and to `PUBLIC_URL/app/#/thread/<id>`. Chat (Slack/Teams incoming webhooks) is sent for mentions and assignments when the workspace integration is enabled.

## Saved views and export

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/workspaces/:ws/views` | private views plus shared ones |
| PATCH/DELETE | `/workspaces/:ws/views/:id` | creator or admin |
| POST | `/workspaces/:ws/export-token` | `{ token }`, valid 5 minutes, for download links |
| GET | `/workspaces/:ws/export?format=md\|csv\|json\|pdf&dt=<token>` | Same filters and `sort` as the thread list, or `ids=a,b,c`. Up to 2000 threads. Guests are refused. Each thread carries its share link, or `PUBLIC_URL/app/#/thread/<id>` when it has none. PDF groups threads by page with area snapshots |

## Integrations, API keys and webhooks (admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/workspaces/:ws/integrations` | all five kinds; secrets masked as `••••abcd` |
| PUT | `/workspaces/:ws/integrations/:kind` | `{ enabled, settings }`. Sending a masked value keeps the stored secret. Settings: slack/teams `webhookUrl`; linear `apiKey, teamId`; jira `baseUrl, email, apiToken, projectKey, issueType?`; github `token, owner, repo, labels?` |
| POST | `/threads/:id/tickets` | `{ kind: linear\|jira\|github }` → `TicketLink` (title, comments, selector, component, share and live links, snapshot image) |
| GET | `/threads/:id/tickets` | linked tickets |
| POST | `/threads/:id/post` | `{ kind: slack\|teams }` posts a summary |
| GET/POST/DELETE | `/workspaces/:ws/api-keys[/:id]` | key returned once: `pk_<prefix>_<secret>` |
| GET/POST/DELETE | `/workspaces/:ws/webhooks[/:id]` | `{ url (https), events[] }`; `secret` returned once |

Webhook delivery: `POST` JSON `{ event, workspaceId, at, data: { threadId, thread?, comment? } }` with headers `X-Pinpoint-Timestamp` and `X-Pinpoint-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`. Retries after 2 s, 10 s and 60 s.

## Real time

`GET /ws?token=<accessToken or API key>` (WebSocket). Send `{"type":"subscribe","workspaceId":"…"}`; receive `{"type":"subscribed"}` then `{"type":"event","event": RealtimeEvent}`. `notification.created` goes only to its recipient. `{"type":"ping"}` → `{"type":"pong"}`; the server also pings every 30 s. Invalid tokens close with code 4401.

## Telemetry

- `POST /telemetry` `{ events: [{ name, props? }] }` — name `[a-z0-9_.:-]{1,64}`, props are flat primitives (≤20). No user id is stored; ignored for users who opted out.
- `POST /errors` `{ message, stack?, context, version }` — URLs and long quoted strings are scrubbed.

## Misc

- `GET /health` → `{ ok, db, version }`
- `GET /config` → `{ publicUrl, providers, extensionIds }`
- `GET /dev/mailbox` (outside `/api/v1`, `DEV_LOGIN=1` only) — emails captured when no SMTP is configured.
