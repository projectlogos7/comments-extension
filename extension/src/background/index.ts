// Pinpoint service worker: session, API proxy, capture, offline queue, injection, live updates.
import {
  ApiError,
  STORAGE_KEYS,
  normalizeUrl,
  uid,
  type BgRequest,
  type BgResponse,
  type ContentMessage,
  type ExtEvent,
  type PageInfo,
  type SnapshotRequest,
  type TabCommand,
} from '@pinpoint/shared';
import { FOCUS_THREAD_KEY, LOCAL_TYPES, TAB_ANCHORS_KEY, type LocalRequest } from '../lib/local-messages';
import { blobToDataUrl, dataUrlToBlob } from '../lib/dataurl';
import { withThreadParam } from '../lib/thread-param';
import {
  activeWorkspace,
  api,
  authState,
  completeSignIn,
  getActiveWorkspaceId,
  getServerUrl,
  loadMe,
  setActiveWorkspace,
  setAuthChangedHandler,
  setServerUrl,
  signOut,
  tokensFromRedirect,
  accessToken,
} from './session';
import { applyBlur, captureFullPage, captureVisible, cropArea, imageSize } from './capture';
import { enqueue, flush, isOnline, onItemSynced, onQueueStatus, pendingCount, type PreparedSnapshot } from './queue';
import { ensureInjected, hasHostPermission, injectIntoOpenTabs, isUrlAllowed, missingOrigins, syncContentScripts } from './content-scripts';
import { connect, disconnect, notificationTarget, reconnectSoon, refreshBadge, setBroadcaster, setWorkspaceUpdatedHandler } from './realtime';

const VERSION = chrome.runtime.getManifest().version;

// ---------------------------------------------------------------- broadcasting
async function broadcast(event: ExtEvent) {
  chrome.runtime.sendMessage(event).catch(() => undefined);
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) {
    if (t.id == null) continue;
    const msg: ContentMessage = { type: 'event', event };
    chrome.tabs.sendMessage(t.id, msg, { frameId: 0 }).catch(() => undefined);
  }
}
setBroadcaster((e) => void broadcast(e));

async function broadcastAuth() {
  await broadcast({ type: 'auth.changed', state: await authState({ pendingWrites: await pendingCount(), online: isOnline() }) });
}
setAuthChangedHandler(() => {
  disconnect();
  void broadcastAuth();
  void chrome.action.setBadgeText({ text: '' });
});

onQueueStatus((pendingWrites, online) => void broadcast({ type: 'sync.status', pendingWrites, online }));
onItemSynced((item, result) => {
  if (item.kind === 'thread.create' || item.kind === 'comment.create' || item.kind === 'snapshot.upload') {
    const threadId = item.kind === 'thread.create' ? ((result as { id?: string; threadId?: string }).id ?? (result as { threadId?: string }).threadId) : item.threadId;
    const ws = item.kind === 'snapshot.upload' ? undefined : item.workspaceId;
    void (async () => broadcast({ type: 'threads.changed', workspaceId: ws ?? (await getActiveWorkspaceId()) ?? '', threadId }))();
  }
});

// ---------------------------------------------------------------- lifecycle
async function afterSignIn() {
  await syncContentScripts().catch(() => undefined);
  void connect();
  void refreshBadge(false).catch(() => undefined);
  await broadcastAuth();
  void injectIntoOpenTabs();
  void flush();
}

setWorkspaceUpdatedHandler(async () => {
  await loadMe().catch(() => undefined);
  await syncContentScripts().catch(() => undefined);
  await broadcastAuth();
});

function setupMenusAndAlarms() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pp-comment-here', title: 'Comment here', contexts: ['page', 'selection', 'image', 'link', 'video'] });
    chrome.contextMenus.create({ id: 'pp-page-comment', title: 'Comment on this page', contexts: ['page'] });
  });
  chrome.alarms.create('pp-poll', { periodInMinutes: 1 });
  chrome.alarms.create('pp-drafts-prune', { periodInMinutes: 60 * 24 });
}

chrome.runtime.onInstalled.addListener(async () => {
  setupMenusAndAlarms();
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
  if (await accessToken()) await afterSignIn();
});

chrome.runtime.onStartup.addListener(async () => {
  setupMenusAndAlarms();
  if (await accessToken()) {
    await loadMe().catch(() => undefined);
    await afterSignIn();
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'pp-poll') {
    if (!(await accessToken())) return;
    void flush();
    void connect();
    await refreshBadge(true).catch(() => undefined);
  } else if (a.name === 'pp-drafts-prune') {
    await pruneDrafts();
  }
});

self.addEventListener('online', () => {
  void flush();
  reconnectSoon();
});

chrome.permissions.onAdded.addListener(async () => {
  await syncContentScripts().catch(() => undefined);
  void injectIntoOpenTabs();
});
chrome.permissions.onRemoved.addListener(() => void syncContentScripts().catch(() => undefined));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = ((await chrome.storage.session.get(TAB_ANCHORS_KEY))[TAB_ANCHORS_KEY] ?? {}) as Record<string, unknown>;
  if (s[tabId]) {
    delete s[tabId];
    await chrome.storage.session.set({ [TAB_ANCHORS_KEY]: s });
  }
});

// Email-link sign in ends on {server}/app/extension-auth#accessToken=...; read it and close the tab.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const server = await getServerUrl();
  if (!info.url.startsWith(`${server}/app/extension-auth`)) return;
  const tokens = tokensFromRedirect(info.url);
  if (!tokens) return;
  await completeSignIn(tokens);
  await afterSignIn();
  chrome.tabs.remove(tabId).catch(() => undefined);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-comment-mode') return;
  const t = tab ?? (await activeTab());
  if (t?.id != null) await runTabCommand(t.id, { kind: 'commentMode.toggle' }).catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id == null) return;
  const command: TabCommand = info.menuItemId === 'pp-page-comment' ? { kind: 'pageComment.start' } : { kind: 'commentMode.start' };
  await runTabCommand(tab.id, command).catch(() => undefined);
});

chrome.notifications?.onClicked.addListener(async (id) => {
  const target = notificationTarget(id);
  if (target) await openOnPage(target.threadId, target.url, true);
  chrome.notifications.clear(id);
});

// ---------------------------------------------------------------- helpers
async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

async function resolveTabId(tabId: number | undefined, sender?: chrome.runtime.MessageSender): Promise<number> {
  if (tabId != null) return tabId;
  if (sender?.tab?.id != null) return sender.tab.id;
  const t = await activeTab();
  if (t?.id == null) throw Object.assign(new Error('No active tab'), { code: 'no_tab' });
  return t.id;
}

const INJECTING_COMMANDS = new Set(['commentMode.start', 'commentMode.toggle', 'pageComment.start', 'panel.toggle', 'thread.focus', 'thread.reattach', 'copy', 'pins.toggle']);

async function runTabCommand(tabId: number, command: TabCommand): Promise<unknown> {
  if (INJECTING_COMMANDS.has(command.kind)) {
    const ok = await ensureInjected(tabId);
    if (!ok) {
      const tab = await chrome.tabs.get(tabId);
      const allowed = await isUrlAllowed(tab.url);
      throw Object.assign(new Error(allowed ? 'Pinpoint needs access to this site. Open the Pinpoint popup and grant access.' : 'This site is not on your workspace’s allowed list.'), {
        code: allowed ? 'permission_required' : 'site_not_allowed',
      });
    }
  }
  const msg: ContentMessage = { type: 'command', command };
  const res = (await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })) as BgResponse | undefined;
  if (res && 'ok' in res) {
    if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
    return res.data;
  }
  return res;
}


async function openOnPage(threadId: string, url: string, newTab = false) {
  const target = normalizeUrl(url).url;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const existing = tabs.find((t) => {
    try {
      return t.url && normalizeUrl(t.url).url === target;
    } catch {
      return false;
    }
  });
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    await runTabCommand(existing.id, { kind: 'thread.focus', threadId }).catch(() => undefined);
    return { tabId: existing.id };
  }
  const dest = withThreadParam(url, threadId);
  const current = newTab ? undefined : await activeTab();
  const tab = current?.id != null && /^https?:/.test(current.url ?? '') ? await chrome.tabs.update(current.id, { url: dest }) : await chrome.tabs.create({ url: dest });
  return { tabId: tab?.id };
}

async function prepareSnapshots(req: SnapshotRequest, tab: chrome.tabs.Tab | undefined): Promise<PreparedSnapshot[]> {
  const ws = await activeWorkspace();
  const privacy = ws?.privacy;
  const out: PreparedSnapshot[] = [];
  const cssW = req.context.viewport.w || 1;
  if (req.viewportDataUrl) {
    const size = await imageSize(req.viewportDataUrl);
    if (req.areaRect && req.areaRect.w > 0 && req.areaRect.h > 0) {
      const area = await cropArea(req.viewportDataUrl, req.areaRect, cssW);
      out.push({ kind: 'area', dataUrl: area.dataUrl, width: area.width, height: area.height, context: req.context });
    }
    out.push({ kind: 'viewport', dataUrl: req.viewportDataUrl, width: size.width, height: size.height, context: req.context });
  }
  if (req.fullPage && privacy?.allowFullPage !== false && tab?.id != null && tab.windowId != null) {
    try {
      const fp = await captureFullPage(tab.id, tab.windowId, req.blurRegions ?? []);
      out.push({ kind: 'fullpage', dataUrl: fp.dataUrl, width: fp.width, height: fp.height, context: req.context });
    } catch (e) {
      console.warn('[pinpoint] full-page capture failed', e);
    }
  }
  if (req.domSnapshot && privacy?.allowDom !== false) {
    out.push({ kind: 'dom', dataUrl: await blobToDataUrl(new Blob([req.domSnapshot], { type: 'text/html' })), context: req.context });
  }
  return out;
}

// ---------------------------------------------------------------- drafts (FR-2.12)
type Drafts = Record<string, { value: string; at: number }>;
async function readDrafts(): Promise<Drafts> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.drafts))[STORAGE_KEYS.drafts] as Drafts | undefined) ?? {};
}
async function pruneDrafts() {
  const d = await readDrafts();
  const cutoff = Date.now() - 30 * 86400_000;
  for (const k of Object.keys(d)) if (d[k].at < cutoff) delete d[k];
  await chrome.storage.local.set({ [STORAGE_KEYS.drafts]: d });
}

// ---------------------------------------------------------------- API proxy
const API_DENY = new Set(['constructor', 'request', 'refresh', 'logout', 'devLogin', 'wsUrl', 'exportBlob']);

function reviveArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (a && typeof a === 'object' && '__dataUrl' in (a as Record<string, unknown>)) return dataUrlToBlob(String((a as { __dataUrl: string }).__dataUrl));
    if (a && typeof a === 'object' && 'blob' in (a as Record<string, unknown>) && typeof (a as { blob: unknown }).blob === 'string') {
      return { ...(a as object), blob: dataUrlToBlob((a as { blob: string }).blob) };
    }
    return a;
  });
}

async function callApi(method: string, args: unknown[]) {
  const client = await api();
  const fn = (client as unknown as Record<string, unknown>)[method];
  if (API_DENY.has(method) || typeof fn !== 'function') throw Object.assign(new Error(`Unknown API method ${method}`), { code: 'bad_method' });
  return (fn as (...a: unknown[]) => unknown).apply(client, reviveArgs(args));
}

// ---------------------------------------------------------------- request handling
async function handle(req: BgRequest | LocalRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (req.type) {
    case 'auth.state':
      return authState({ pendingWrites: await pendingCount(), online: isOnline() });
    case 'auth.signIn': {
      const client = await api();
      const redirect = chrome.identity.getRedirectURL('auth');
      const result = await chrome.identity.launchWebAuthFlow({ url: client.oauthStartUrl(req.provider, redirect), interactive: true });
      const tokens = result ? tokensFromRedirect(result) : null;
      if (!tokens) throw Object.assign(new Error('Sign in was cancelled or failed'), { code: 'auth_failed' });
      await completeSignIn(tokens);
      await afterSignIn();
      return authState({ pendingWrites: await pendingCount(), online: isOnline() });
    }
    case 'auth.emailSignIn': {
      const client = await api();
      const server = await getServerUrl();
      const r = await client.emailSignIn(req.email, `${server}/app/extension-auth`);
      if (r.devLink) await chrome.tabs.create({ url: r.devLink });
      return r;
    }
    case 'auth.devSignIn': {
      const client = await api();
      const tokens = await client.devLogin(req.email, req.name);
      await completeSignIn(tokens);
      await afterSignIn();
      return authState({ pendingWrites: await pendingCount(), online: isOnline() });
    }
    case 'auth.signOut':
      disconnect();
      await signOut();
      await syncContentScripts().catch(() => undefined);
      await chrome.action.setBadgeText({ text: '' });
      await broadcastAuth();
      return null;
    case 'settings.setServerUrl':
      disconnect();
      await setServerUrl(req.serverUrl);
      await broadcastAuth();
      return null;
    case 'workspace.setActive':
      await setActiveWorkspace(req.workspaceId);
      await chrome.storage.local.remove(STORAGE_KEYS.lastSeenNotification);
      await syncContentScripts().catch(() => undefined);
      reconnectSoon();
      void refreshBadge(false).catch(() => undefined);
      await broadcastAuth();
      void injectIntoOpenTabs();
      return null;
    case 'workspace.refresh':
      await loadMe();
      await syncContentScripts().catch(() => undefined);
      await broadcastAuth();
      return authState({ pendingWrites: await pendingCount(), online: isOnline() });
    case 'api':
      return callApi(req.method, req.args ?? []);
    case 'capture.visible': {
      const tabId = await resolveTabId(req.tabId, sender);
      const tab = await chrome.tabs.get(tabId);
      return captureVisible(tab.windowId);
    }
    case 'thread.create': {
      const ws = await getActiveWorkspaceId();
      if (!ws) throw Object.assign(new Error('No active workspace'), { code: 'no_workspace' });
      const tab = sender.tab ?? (await activeTab());
      const snapshots = await prepareSnapshots(req.snapshot, tab);
      const id = req.input.clientId ?? uid('c_');
      return enqueue({
        id,
        kind: 'thread.create',
        workspaceId: ws,
        input: { ...req.input, clientId: id },
        attachments: req.attachments ?? [],
        snapshots,
        createdAt: Date.now(),
        attempts: 0,
      });
    }
    case 'comment.create': {
      const ws = await getActiveWorkspaceId();
      const id = uid('c_');
      return enqueue({ id, kind: 'comment.create', workspaceId: ws ?? '', threadId: req.threadId, body: req.body, attachments: req.attachments ?? [], createdAt: Date.now(), attempts: 0 });
    }
    case 'snapshot.retake': {
      const tab = sender.tab ?? (await activeTab());
      const snapshots = await prepareSnapshots(req.snapshot, tab);
      return enqueue({ id: uid('s_'), kind: 'snapshot.upload', threadId: req.threadId, snapshots, createdAt: Date.now(), attempts: 0 });
    }
    case 'tab.command': {
      const tabId = await resolveTabId(req.tabId, sender);
      return runTabCommand(tabId, req.command);
    }
    case 'thread.openOnPage':
      return openOnPage(req.threadId, req.url, req.newTab);
    case 'sidepanel.open': {
      const tabId = await resolveTabId(req.tabId, sender);
      if (req.threadId) {
        await chrome.storage.session.set({ [FOCUS_THREAD_KEY]: { threadId: req.threadId, tabId, at: Date.now() } });
        void broadcast({ type: 'thread.selected', tabId, threadId: req.threadId });
      }
      try {
        if (!chrome.sidePanel?.open) throw new Error('no side panel');
        await chrome.sidePanel.open({ tabId });
        return { mode: 'sidepanel' };
      } catch {
        await runTabCommand(tabId, { kind: 'panel.toggle' });
        return { mode: 'inpage' };
      }
    }
    case 'permissions.sync': {
      const r = await syncContentScripts();
      void injectIntoOpenTabs();
      return { ...r, missing: await missingOrigins() };
    }
    case 'export.download': {
      const ws = await getActiveWorkspaceId();
      if (!ws) throw Object.assign(new Error('No active workspace'), { code: 'no_workspace' });
      const client = await api();
      const blob = await client.exportBlob(ws, req.format, req.query as never);
      const url = await blobToDataUrl(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const id = await chrome.downloads.download({ url, filename: `pinpoint-export-${stamp}.${req.format}`, saveAs: false });
      return { downloadId: id };
    }
    case 'drafts.get': {
      const d = await readDrafts();
      return d[req.key]?.value ?? null;
    }
    case 'drafts.set': {
      const d = await readDrafts();
      if (req.value == null || req.value === '') delete d[req.key];
      else d[req.key] = { value: req.value, at: Date.now() };
      await chrome.storage.local.set({ [STORAGE_KEYS.drafts]: d });
      return null;
    }
    case 'page.info': {
      const tabId = await resolveTabId(req.tabId, sender);
      const tab = await chrome.tabs.get(tabId);
      const base: PageInfo = {
        tabId,
        url: tab.url ?? '',
        title: tab.title ?? '',
        allowed: await isUrlAllowed(tab.url),
        hasPermission: await hasHostPermission(tab.url),
        active: false,
        pinsVisible: true,
        anchors: [],
      };
      try {
        const info = (await chrome.tabs.sendMessage(tabId, { type: 'page.info' } satisfies ContentMessage, { frameId: 0 })) as BgResponse<Partial<PageInfo>> | undefined;
        if (info && 'ok' in info && info.ok) return { ...base, ...info.data, tabId, hasPermission: base.hasPermission, active: true };
      } catch {
        /* not injected */
      }
      return base;
    }
    case 'badge.refresh':
      return refreshBadge(false);

    // ----- extension-internal (content script) -----
    case 'content.anchors': {
      const tabId = sender.tab?.id;
      if (tabId == null) return null;
      const s = ((await chrome.storage.session.get(TAB_ANCHORS_KEY))[TAB_ANCHORS_KEY] ?? {}) as Record<string, unknown>;
      s[tabId] = { url: req.url, anchors: req.anchors };
      await chrome.storage.session.set({ [TAB_ANCHORS_KEY]: s });
      chrome.runtime.sendMessage({ type: 'page.anchors', tabId, url: req.url, anchors: req.anchors } satisfies ExtEvent).catch(() => undefined);
      return null;
    }
    case 'content.injectPageworld': {
      const tabId = sender.tab?.id;
      if (tabId == null) return false;
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, world: 'MAIN', files: ['pageworld.js'] });
      return true;
    }
    case 'content.ready':
      if (req.allowed) void connect();
      return null;
    case 'content.threadSelected': {
      const tabId = sender.tab?.id;
      if (tabId == null) return null;
      await chrome.storage.session.set({ [FOCUS_THREAD_KEY]: { threadId: req.threadId, tabId, at: Date.now() } });
      chrome.runtime.sendMessage({ type: 'thread.selected', tabId, threadId: req.threadId } satisfies ExtEvent).catch(() => undefined);
      return null;
    }
  }
  throw Object.assign(new Error(`Unknown request ${(req as { type: string }).type}`), { code: 'bad_request' });
}

function toError(e: unknown): BgResponse<never> {
  if (e instanceof ApiError) return { ok: false, error: { code: e.code, message: e.message, status: e.status } };
  const err = e as { code?: string; message?: string };
  const offline = e instanceof TypeError && /fetch/i.test(String(err.message));
  return { ok: false, error: { code: err.code ?? (offline ? 'offline' : 'error'), message: offline ? 'Cannot reach the Pinpoint server' : err.message ?? String(e) } };
}

const REQUEST_TYPES = new Set([
  'auth.state', 'auth.signIn', 'auth.emailSignIn', 'auth.devSignIn', 'auth.signOut', 'settings.setServerUrl', 'workspace.setActive', 'workspace.refresh',
  'api', 'capture.visible', 'thread.create', 'comment.create', 'snapshot.retake', 'tab.command', 'thread.openOnPage', 'sidepanel.open', 'permissions.sync',
  'export.download', 'drafts.get', 'drafts.set', 'page.info', 'badge.refresh',
]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  if (!REQUEST_TYPES.has(msg.type) && !LOCAL_TYPES.has(msg.type)) return false; // ExtEvents echo etc.
  handle(msg as BgRequest, sender).then(
    (data) => sendResponse({ ok: true, data: data ?? null } satisfies BgResponse),
    (e) => sendResponse(toError(e)),
  );
  return true;
});

// Messages from the Pinpoint web app (share viewer "Open on live page", FR-4.6).
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  (async () => {
    const server = await getServerUrl();
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '');
    if (origin !== server) return { ok: false, error: { code: 'forbidden', message: 'Unknown origin' } };
    if (msg?.type === 'ping') {
      const s = await authState({ pendingWrites: 0, online: isOnline() });
      return { ok: true, data: { version: VERSION, signedIn: s.signedIn } };
    }
    if (msg?.type === 'thread.openOnPage' && typeof msg.threadId === 'string' && typeof msg.url === 'string' && /^https?:/.test(msg.url)) {
      return { ok: true, data: await openOnPage(msg.threadId, msg.url, true) };
    }
    return { ok: false, error: { code: 'bad_request', message: 'Unknown request' } };
  })().then(sendResponse, (e) => sendResponse(toError(e)));
  return true;
});

// Keep the socket up whenever the worker wakes with a session.
void (async () => {
  if (await accessToken()) {
    void connect();
    void flush();
  }
})();
