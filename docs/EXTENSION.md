# Pinpoint browser extension

One Manifest V3 package for Chrome, Edge, Brave, Opera and Arc (Chromium 116+).

## Build and load

```bash
npm install
node extension/build.mjs            # → extension/dist
node extension/build.mjs --watch    # rebuild on change (inline source maps)
node extension/build.mjs --zip      # → extension/pinpoint-extension.zip for store upload
```

`PINPOINT_SERVER_ORIGINS` (comma separated, default `http://localhost:8787`) sets the server origins
that get host access at install and may message the extension (`externally_connectable`, used by
the share viewer's "Open on live page"). Build once per environment, for example
`PINPOINT_SERVER_ORIGINS=https://pinpoint.example.com node extension/build.mjs --zip`.

Load unpacked: open `chrome://extensions` (or `edge://extensions`, `brave://extensions`), turn on
Developer mode, choose **Load unpacked** and pick `extension/dist`. In the popup, open
**Advanced** to point the extension at another server; with a server started with `DEV_LOGIN=1`
you can sign in there without OAuth.

## Parts

| Part | Source | Runs in | Job |
| --- | --- | --- | --- |
| Service worker | `src/background/` | extension | Session and token refresh, API proxy, screenshots, offline queue, content-script registration, WebSocket, badge, notifications, context menu, shortcut |
| Content script | `src/content/` | page (isolated world), top frame | Overlay, selection, anchors, pins, composer, thread card, copy, capture helpers |
| Page-world helper | `src/pageworld/` | page (main world), on demand | Reads React/Vue/Angular/Svelte internals to name the component |
| Popup | `src/popup/` | extension page | Sign in, workspace switcher, start comment mode, pins, site access, sync status |
| Side panel, All comments, Settings | `src/sidepanel/`, `src/app/` | extension pages | Built from `packages/ui` (shared with the web app) |

Contexts talk through the protocol in `packages/shared/src/messages.ts` (`BgRequest`, `TabCommand`,
`ContentMessage`, `ExtEvent`). Extension-internal extras live in `src/lib/local-messages.ts`:

- `content.anchors` — the content script reports each thread's anchor state (`attached`, `detached`, `page`) and page order; the background stores it per tab in `chrome.storage.session['pp.tabAnchors']` and re-broadcasts it as the `page.anchors` event.
- `content.injectPageworld` — inject `pageworld.js` into the caller's frame in the main world.
- `content.ready`, `content.threadSelected` — the latter stores `{ threadId, tabId }` in `chrome.storage.session['pp.focusThread']` and broadcasts `thread.selected` so the side panel opens that thread.

The generic `{ type: 'api', method, args }` request calls any `ApiClient` method except
`request`, `refresh`, `logout`, `devLogin`, `wsUrl` and `exportBlob`. Blobs cannot cross the
message boundary: pass `{ __dataUrl: 'data:…' }` for a Blob argument, or `{ …, blob: 'data:…' }`
for `uploadSnapshot`'s input. Bulk export goes through `export.download` (uses `chrome.downloads`).

## In-page UI

Everything the extension draws lives in one shadow root (`src/content/host.ts`, styles in `src/content/styles.ts`).

- **Composer** (`ui/composer.tsx`). This is a compact card beside the selection, with the scope switch (Area / Section / Page), the text box and **Comment**.
  - Type, priority, assignee, "Show on" and the snapshot options sit under **Options**.
  - Drag the card by its header. Double-click the header to put it back beside the selection. The card stays fully on screen when it grows or the window shrinks.
- **Thread card** (`ui/card.tsx`). Clicking a pin opens it. It uses the same style and is also draggable. It has Resolve and a **⋯** menu with the copy-as options, share link, side panel and re-attach. Each comment has its own edit/delete menu.
- **Mentions** (`ui/editor.tsx`). Text boxes always show `@Ana Lopez`. Mentions are stored as `@[Ana Lopez](userId)` tokens:
  - typing uses `activeMentionQuery` and `insertMention` from `@pinpoint/shared`;
  - saving uses `encodeMentions`;
  - editing an existing comment uses `decodeMentions`.
  - The picker shows initials, name and email, and is driven by ↑/↓, Enter or Tab, and Esc.
- **Dropdowns** (`ui/popover.tsx`). Every menu (mention picker, type/priority/assignee/"Show on", ⋯ menus) is a floating `position: fixed` popover.
  - It is placed against its trigger, flipping above or below and shifting to stay in the viewport.
  - It overlays the card instead of being clipped by it or pushing the layout.
  - Native `<select>`s are replaced by an accessible listbox/menu with keyboard navigation.
- **Esc** (`ui/layers.ts`). Every open layer registers on one stack, and a capture-phase `keydown` listener on `window` closes only the topmost one. The order is dropdown → blur editor → composer or thread card → in-page panel. Comment mode handles its own Esc.
  - It works with focus in a text box and stops the page from also seeing the key.
  - Closing the composer keeps the draft (FR-2.12).

## Keyboard shortcut (Alt+Shift+C)

The shortcut toggles comment mode, through the same path as the context menu:

1. The command grants `activeTab`, so the content script is injected on an allowed site even without the optional host permission.
2. If Pinpoint can't start, the reason is shown on the page and the popup opens with the fix. The possible reasons are:
   - not signed in;
   - no workspace;
   - the site isn't enabled;
   - a browser page.
   Before this change these failures were swallowed, and the shortcut seemed to do nothing.
3. If Chrome did not assign the shortcut (another extension already uses it), the keystroke reaches the page. The content script then handles Alt+Shift+C itself, matching on `event.code` because macOS Option changes `event.key`. The popup also shows **Set shortcut**, which opens `chrome://extensions/shortcuts`.
4. **Fixed: content script came back inert after an extension reload or update.** The re-injected script found the old instance's `__pinpointContent` flag and exited, so commands got no answer. Now a new instance only defers to an old one that is still connected, and orphaned instances remove their UI.

## Popup

The popup offers one main action, **Comment on this page** (with the current shortcut shown), plus Page comment and Hide pins.

- **Site not enabled yet:**
  - Admins get one button: **Enable Pinpoint on &lt;host&gt;**. It requests host access inside the click and adds the host to the workspace's allowed sites.
  - Members are told to ask an admin.
- **Admins** also get **Invite teammates**: emails, comma separated, plus **Copy invite link**. The link reuses the existing invite token and only creates one if none exists.
- **First run:** sign in, then a single "Name your workspace" step.

## Anchoring (FR-1.10 – FR-1.12)

`src/content/anchor/` is pure DOM code with unit tests (`extension/test/anchor.test.ts`).

- **Selectors** prefer `data-testid`/`data-test`/`data-cy`/`data-qa`, then non-generated ids,
  `aria-label`, `name`, role, other stable attributes and stable classes. Generated class names
  (CSS-in-JS `css-*`/`sc-*`/`jsx-*`, CSS-module hashes, Tailwind variants and arbitrary values,
  hex/digit tokens) and generated ids (React `useId`, Radix, Headless UI, UUIDs) are rejected.
  Every candidate is verified to match exactly one element.
- Each anchor also stores an XPath, a structural `:nth-child` path, a text fingerprint, the
  selection rectangle relative to the element and to the document, the viewport, the component,
  a trimmed HTML snippet and a JS path. Section anchors store the landmark and heading text;
  text-range anchors store the quote with 32 characters of context on each side.
- **Resolution** gathers candidates from every signal (selectors, XPath, structural path,
  section heading, same-tag text search), scores each one (source, text similarity, tag, size,
  position, agreement between signals) and attaches above 0.55. Below that the thread is
  `detached`: it stays in the list with its snapshot and offers **Re-attach**. After 10 seconds
  of consistent failure on a visible page the content script also stores `detached: true` on
  the thread; a later high-confidence match clears it.
- Open shadow DOM and same-origin iframes are supported (`shadowHosts`, `frames`). In a
  cross-origin iframe the iframe element itself is selected.

## Permissions

| Permission | Why |
| --- | --- |
| `optional_host_permissions: <all_urls>` | Requested per allowed site from the popup ("Grant access to …"), never at install. The content script is registered only for allowed sites we hold access for. |
| `host_permissions` for localhost, 127.0.0.1 and the server | Local development works out of the box (FR-7.3); the service worker can reach the API. |
| `activeTab`, `scripting` | Inject on demand and capture the visible tab when the user starts comment mode from the toolbar, shortcut or context menu. |
| `tabs` | Find a tab that already shows a thread's page, read the active tab's URL for the popup. |
| `storage`, `unlimitedStorage` | Session, drafts and the offline queue (which can hold snapshots). |
| `sidePanel` | The comments panel. Where the API is missing, an in-page panel (an iframe of `sidepanel.html` inside our shadow root) is used. |
| `contextMenus` | "Comment here" and "Comment on this page". |
| `alarms` | Poll for unread mentions, flush the offline queue, reconnect the socket. |
| `notifications` | System notifications for new mentions and assignments. |
| `identity` | Google and Microsoft sign in through `launchWebAuthFlow`. |
| `downloads` | Save bulk exports. |

No `debugger` permission: screenshots use `tabs.captureVisibleTab`, and full-page snapshots
scroll and stitch (fixed and sticky elements appear in the first frame only; captures are
rate-limited to two per second and capped at 16,000 device pixels tall). Chrome only allows
`captureVisibleTab` with `activeTab` or access to all sites, so a comment started from the
selected-text button or a re-attach saves without a snapshot unless the user has granted access
to all sites; the composer says so.

## Privacy

- The content script stays inert unless the page's host is on the active workspace's allowed
  list (localhost always counts). Nothing is read or sent from other sites.
- Page content leaves the browser only when a thread is saved: the comment, the anchor and the
  snapshots the author chose. Workspace privacy settings are enforced in the composer and again
  in the service worker (no full-page or DOM snapshots when disabled; blur review forced when
  required). Blurred regions are pixelated before upload.
- DOM snapshots strip scripts, event handlers, form values and `javascript:` URLs.
- Sign out clears tokens, the cached user, drafts and the offline queue.
- All injected UI is in a shadow root on a 0×0 fixed host element, so it never changes the
  page's layout and site CSS cannot reach it. Keyboard and pointer events inside it do not
  propagate to the page.

## Sign in

- Google / Microsoft: `chrome.identity.launchWebAuthFlow` opens
  `{server}/api/v1/auth/{provider}/start?redirect=https://<extension-id>.chromiumapp.org/auth`;
  the server redirects back with `#accessToken=…&refreshToken=…&expiresIn=…`.
- Email link: the link ends at `{server}/app/extension-auth#accessToken=…`; the service worker
  watches for that URL, stores the tokens and closes the tab. In development the server returns
  the link directly (`devLink`) and the extension opens it.
- Access tokens are refreshed a minute before they expire (single flight); a rejected refresh
  signs the user out.

## Deep links

`?pinpoint_thread=<id>` on any allowed page focuses that thread after load and is removed with
`history.replaceState`. URL normalization treats the parameter as tracking, so it never changes
which page a URL maps to. The share viewer can also call
`chrome.runtime.sendMessage(EXTENSION_ID, { type: 'thread.openOnPage', threadId, url })`
(or `{ type: 'ping' }` to detect the extension) from the server origin.

## Store packaging

1. Set the production server origin and run `PINPOINT_SERVER_ORIGINS=https://… node extension/build.mjs --zip`.
2. Upload `extension/pinpoint-extension.zip` to the Chrome Web Store and Edge Add-ons. Opera
   and other Chromium stores accept the same package.
3. Single purpose: "annotate web pages with team comments". Justify each permission with the
   table above, and link the privacy policy. No remote code is loaded (the CSP is `script-src 'self'`).
4. After the store assigns the extension id, add it to the server's `EXTENSION_IDS` so the share
   viewer can offer "Open on live page".

## Tests

```bash
npx vitest run extension
```

Covers selector generation and generated-name rejection, XPath round-trips, resolution after
attribute changes, moves and text edits, detachment, multi-select, sections (detection and
reordering), text ranges, free rectangles, shadow DOM, the `pinpoint_thread` parameter, data
URLs and DOM snapshot sanitizing.
