// Live updates and notifications. The service worker holds a WebSocket while it is awake (Chrome
// keeps workers with active WebSockets alive), reconnects with backoff, and an alarm polls for
// unread counts when the socket is down (PRD §13 "Live updates"; FR-2.11, FR-5.9, FR-7.4).
import { STORAGE_KEYS, type ExtEvent, type Notification as PpNotification, type RealtimeEvent, type UnreadCounts } from '@pinpoint/shared';
import { accessToken, api, getActiveWorkspaceId } from './session';

let socket: WebSocket | null = null;
let backoff = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let subscribedWs: string | null = null;
let broadcaster: (e: ExtEvent) => void = () => undefined;
let keepAlive: ReturnType<typeof setInterval> | null = null;

export function setBroadcaster(fn: (e: ExtEvent) => void) {
  broadcaster = fn;
}

export function socketOpen() {
  return socket?.readyState === WebSocket.OPEN;
}

export async function connect() {
  const token = await accessToken();
  const ws = await getActiveWorkspaceId();
  if (!token || !ws) return disconnect();
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    if (subscribedWs !== ws && socket.readyState === WebSocket.OPEN) subscribe(ws);
    return;
  }
  const client = await api();
  let s: WebSocket;
  try {
    s = new WebSocket(client.wsUrl(token));
  } catch {
    return scheduleReconnect();
  }
  socket = s;
  s.onopen = () => {
    backoff = 1000;
    subscribe(ws);
    if (keepAlive) clearInterval(keepAlive);
    // Traffic every 20s keeps the service worker (and proxies) from idling the connection.
    keepAlive = setInterval(() => {
      if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'ping' }));
    }, 20_000);
  };
  s.onmessage = (m) => {
    let msg: { type?: string; event?: RealtimeEvent } | RealtimeEvent;
    try {
      msg = JSON.parse(String(m.data));
    } catch {
      return;
    }
    const ev = ('event' in msg && msg.event ? msg.event : (msg as RealtimeEvent)) as RealtimeEvent;
    if (!ev?.kind) return;
    handleEvent(ev);
  };
  s.onclose = () => {
    if (socket === s) socket = null;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    subscribedWs = null;
    scheduleReconnect();
  };
  s.onerror = () => s.close();
}

function subscribe(ws: string) {
  socket?.send(JSON.stringify({ type: 'subscribe', workspaceId: ws }));
  subscribedWs = ws;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

export function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const s = socket;
  socket = null;
  subscribedWs = null;
  s?.close();
}

export function reconnectSoon() {
  disconnect();
  backoff = 1000;
  void connect();
}

function handleEvent(ev: RealtimeEvent) {
  if (ev.kind === 'notification.created') {
    void refreshBadge(true);
    return;
  }
  if (ev.kind === 'workspace.updated') {
    broadcaster({ type: 'threads.changed', workspaceId: ev.workspaceId });
    void onWorkspaceUpdated?.();
    return;
  }
  broadcaster({ type: 'threads.changed', workspaceId: ev.workspaceId, threadId: ev.threadId, pageId: ev.pageId });
}

let onWorkspaceUpdated: (() => Promise<void>) | null = null;
export function setWorkspaceUpdatedHandler(fn: () => Promise<void>) {
  onWorkspaceUpdated = fn;
}

let lastCounts: UnreadCounts = { mentions: 0, notifications: 0 };

/** Update the toolbar badge with unread mentions and raise system notifications for new ones. */
export async function refreshBadge(notify = true): Promise<UnreadCounts> {
  const ws = await getActiveWorkspaceId();
  if (!ws || !(await accessToken())) {
    await chrome.action.setBadgeText({ text: '' });
    return { mentions: 0, notifications: 0 };
  }
  const client = await api();
  const counts = await client.unreadCounts(ws);
  lastCounts = counts;
  await chrome.action.setBadgeBackgroundColor({ color: '#5B5BD6' });
  try {
    await chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
  } catch {
    /* older Chromium */
  }
  await chrome.action.setBadgeText({ text: counts.mentions > 0 ? (counts.mentions > 99 ? '99+' : String(counts.mentions)) : '' });
  await chrome.action.setTitle({ title: counts.mentions ? `Pinpoint — ${counts.mentions} unread mention${counts.mentions === 1 ? '' : 's'}` : 'Pinpoint' });
  broadcaster({ type: 'unread.changed', counts });
  if (notify) await notifyNew(ws);
  return counts;
}

export function lastUnread() {
  return lastCounts;
}

const notificationTargets = new Map<string, { threadId: string; url: string }>();

async function notifyNew(ws: string) {
  const client = await api();
  const list: PpNotification[] = await client.notifications({ workspaceId: ws, unread: true, limit: 10 });
  const seenKey = STORAGE_KEYS.lastSeenNotification;
  const lastSeen = ((await chrome.storage.local.get(seenKey))[seenKey] as string | undefined) ?? '';
  const fresh = list.filter((n) => n.createdAt > lastSeen && (n.event === 'mention' || n.event === 'assignment'));
  if (list.length) await chrome.storage.local.set({ [seenKey]: list.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), lastSeen) });
  if (!lastSeen) return; // first run: do not flood with old items
  for (const n of fresh.slice(0, 3)) {
    const id = `pp-${n.id}`;
    notificationTargets.set(id, { threadId: n.threadId, url: n.pageUrl });
    try {
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: n.title,
        message: n.excerpt || n.pageUrl,
        contextMessage: n.actor?.name,
        priority: 1,
      });
    } catch {
      /* notifications blocked */
    }
  }
}

export function notificationTarget(id: string) {
  return notificationTargets.get(id) ?? null;
}
