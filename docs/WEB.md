# Web app, side panel and shared UI

The web app, the extension side panel and the extension's "All comments" page all render the same Preact components from `packages/ui`. Each surface supplies a **host adapter** (`UiHost`, see `packages/ui/src/host.ts`), and the components only ever talk to that host.

```
packages/ui/src
  host.ts            UiHost / ApiLike / UiEvent contract
  context.tsx        UiProvider (session, toasts, confirm dialog), useMembers, useAsync, useRole…
  router.ts          tiny hash router (useHashRoute, navigate)
  clipboard.ts       clipboard + localStorage drafts + live-page link helper
  styles.css         the single stylesheet (light/dark, accent #5B5BD6, reduced motion)
  components/
    common.tsx       primitives: Icon, Avatar, badges, Empty, Skeleton, Toggle (switch), and the overlay system —
                     useLayer (Esc closes the topmost layer), Portal, Popover, Menu, Select, Modal, Drawer
    AppShell.tsx     top bar (workspace switcher, nav, Invite button, account menu), AppRoutes,
                     3-step Onboarding, InviteAccept (auto-joins after sign-in), useUnreadCounts
    Invite.tsx       EmailChips, InvitePanel (emails → role → send, invite link copy/reset/turn off,
                     pending invites with resend/cancel), InviteDialog, InviteButton
    Share.tsx        ShareDialog (copy link, who can open it, turn off link, page link), copyThreadLink
    AllComments.tsx  cross-page list (FR-5.3) with filters, saved views, bulk bar, export, thread drawer
    ThreadList.tsx   site → page grouping, rows with status/scope/type/priority/assignee/unread/detached
    FiltersBar.tsx   status, author, assignee/unassigned, mentions me, scope, type, priority, site, page,
                     date range, unread, detached, full-text search, sort (FR-5.4–5.6)
    BulkBar.tsx      resolve / reopen / assign / type / priority / export / delete (FR-5.7)
    SavedViews.tsx   named, optionally shared filter sets (FR-5.10)
    ThreadView.tsx   conversation, replies, mentions, reactions, edit/delete/restore, resolve, assign,
                     type/priority, snapshots + history + context, Copy as…, share links, tickets,
                     chat posts, activity log, open on live page / snapshot for detached threads
    Composer.tsx     reply box: @mention picker, bold/italic/code/link, image paste/drag (≤5 MB), drafts
    Inbox.tsx        notifications (unread / mentions / all), mark read (FR-5.9, FR-7.4)
    ExportDialog.tsx Markdown / CSV / JSON / PDF for selection, current filter, a page or a site (FR-6.3–6.5)
    Settings.tsx     workspace (name, allowed sites, link sharing, email domain, privacy controls, delete),
                     members (roles, remove/leave, email invites, invite link, guest links),
                     notification preferences (event × channel, immediate/digest), integrations
                     (Slack, Teams, Linear, Jira, GitHub), API keys, webhooks, account (profile,
                     analytics opt-out, GDPR export, delete account, sign out)
    copy.ts          "Copy as" text (selector, XPath, JS path, component, HTML, Markdown, AI prompt)
```

Role checks use `can()` from `@pinpoint/shared` to hide actions; the server enforces them.

## Interaction rules

- **Overlays never clip and never push layout.** Every dropdown (filters, assignee/type/priority, copy-as, workspace switcher, saved views, bulk actions, mention picker) is a `Popover` rendered into `#pp-layer-root` at the end of `<body>`, `position: fixed`, placed below its trigger and flipped above / shifted sideways to stay in the viewport. Clicking outside closes it; clicks inside a popover opened *from* it (a select inside "More filters") do not.
- **Esc closes the topmost layer only**: menu or select → dialog → thread drawer (→ side panel thread). Focus returns to whatever opened the layer. Implemented by one capture-phase `keydown` listener and a stack (`useLayer`).
- **Mentions read as names.** The reply box shows `@Bo Chen`; `encodeMentions` turns that into `@[Bo Chen](userId)` when sending, and `decodeMentions` reverses it when editing (helpers in `@pinpoint/shared/mentions`). The picker shows avatar, name and email, filters as you type, and is keyboard driven (↑ ↓ Enter/Tab, Esc).
- **Invite in one place.** "Invite" in the header (owners/admins) opens a dialog: type or paste addresses (they become chips; invalid or off-domain ones are flagged), pick a role, Send. Below: copy the invite link (created on first use; reset/turn off under "Manage"), and the pending invites with Resend / Cancel. The same panel is step 2 of onboarding and the top of Settings → People.
- **Share in one click.** "Copy link" on a thread creates the link if needed, copies it and opens the Share dialog, which says who can open it (members / anyone with the link — admins can switch it there) and offers "Turn off link" and "Copy link to all comments on this page".
- **Live updates are debounced**: list, inbox and unread counts reload at most once per ~300–500 ms burst of realtime events.
- **Rate limits** surface as a single calm toast ("Slow down a moment…") after the client's automatic retry.

## Host contract

| Member | Web (`web/src/webHost.ts`) | Extension (`extension/src/app/extHost.ts`) |
| --- | --- | --- |
| `api` | `ApiClient` against `location.origin` | Proxy: each call becomes `BgRequest {type:'api', method, args}` |
| session | tokens in `localStorage`, refresh-token rotation on 401 | `auth.state` / `workspace.refresh` / `auth.changed` events |
| `subscribe` | own WebSocket (`api.wsUrl`) with backoff; sends `{type:'subscribe', workspaceId}` | `chrome.runtime.onMessage` `ExtEvent`s, tab switches → `page.changed` |
| `openThread` | opens `pageUrl?pinpoint_thread=<id>` in a new tab | `thread.openOnPage` |
| `focusOnPage`, `reattach` | — | `tab.command` `thread.focus` / `thread.reattach` |
| `postReply` | `uploadAttachment` per file, then `addComment` | `comment.create` with data-URL attachments (offline queue) |
| `exportThreads` | `exportToken` + `exportUrl` download | `export.download` |
| drafts | `localStorage` | `drafts.get` / `drafts.set` |

Live events are normalized to `UiEvent` (`threads.changed`, `unread.changed`, `thread.selected`, `page.anchors`, `page.changed`, `sync.status`, `auth.changed`).

## Web app

Built with `npm run build -w web` (`web/build.mjs`, esbuild) into `server/public/app/` (`index.html`, `app.js`, `app.css`). The server must serve it under `/app/` with an SPA fallback to `index.html` for any `/app/*` path, because sign-in lands on real paths:

- `/app/auth-callback#accessToken=…&refreshToken=…&expiresIn=…` — the `redirect` passed to OAuth and email sign-in. Tokens are stored and the user returns to the page they asked for.
- `/app/extension-auth#…` — a redirect target the extension may use; the page only says "Signed in — you can close this tab" (the background reads the fragment).

Hash routes: `#/login` (`?next=/share/<token>` returns to a share page after sign-in), `#/onboarding`, `#/invite/<token>`, `#/all` (default, `?thread=<id>` opens the thread drawer), `#/thread/<id>`, `#/inbox`, `#/settings/<workspace|sites|members|notifications|integrations|developer|account>`.

Signed-out invite links show "Join <workspace> on Pinpoint" with the sign-in options; the token is remembered (`sessionStorage["pp.pendingInvite"]`) and accepted automatically right after sign-in. The web app stores its session in `localStorage["pinpoint.auth"]`, the same key the server-rendered share viewer uses, so signing in once works for both.

The login page offers Google, Microsoft and an email link. A "Developer sign in" section calls `POST /auth/dev-login` and hides itself when the server answers 404/403. If `emailSignIn` returns `devLink`, it is shown for local development.

## Extension pages

- `extension/src/sidepanel/` → `sidepanel.html`, `sidepanel.js`, `sidepanel.css`. Shows threads for the active tab (`page.info` + `threadsForUrl`), page comments first, anchored threads in page order (from `AnchorStatus.order`), then detached threads with "Re-attach". Includes the Comment / Page comment / pins buttons, quick filters (status, mine, scope), an Inbox tab with an unread count, sign-in and "grant access" states, and an offline/sync status line. It follows tab switches and opens a thread when the page sends `thread.selected`. `?embedded=1&tabId=N` pins it to one tab for the in-page fallback iframe.
- `extension/src/app/` → `app.html`, `app.js`, `app.css`. Same routes as the web app (`#/all`, `#/thread/<id>`, `#/inbox`, `#/settings/…`, `#/onboarding`, `#/invite/<token>`).

The extension build (owned by `extension/build.mjs`) bundles `src/sidepanel/index.tsx` → `dist/sidepanel.js` (+ `.css`) and `src/app/index.tsx` → `dist/app.js` (+ `.css`), and copies the two HTML files to `dist/`.

## Tests

`npx vitest run packages/ui` covers grouping, filters (through the overlay selects), ThreadView actions (load, resolve, copy, reply, guest permissions), mentions (`@Name` in the box, token on send, decode on edit), popover placement, Esc layering and focus return, keyboard selection, email chips, the rate-limit message, export queries, copy formats, side-panel ordering and both host adapters.
