// UiHost for extension pages (side panel, All comments page). Every API call is proxied through the
// service worker, which owns the session tokens, the offline queue and the WebSocket.

import type { AuthState, BgRequest, BgResponse, ExtEvent, PageInfo, TabCommand, Thread } from '@pinpoint/shared';
import { ApiError } from '@pinpoint/shared';
import { copyToClipboard, type ApiLike, type ExportRequest, type Session, type UiEvent, type UiHost } from '@pinpoint/ui';

export async function bg<T>(req: BgRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as BgResponse<T> | undefined;
  if (!res) throw new ApiError(0, 'no_response', 'The extension background did not respond');
  if (!res.ok) throw new ApiError(res.error.status ?? 0, res.error.code, res.error.message);
  return res.data;
}

/** ApiLike whose every method becomes a {type:'api', method, args} message. */
export function createApiProxy(send: <T>(req: BgRequest) => Promise<T> = bg): ApiLike {
  return new Proxy({} as ApiLike, {
    get(_t, method) {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args: unknown[]) => send({ type: 'api', method, args });
    },
  });
}

/** Translate a background ExtEvent into UI events. Returns [] for messages that are not events. */
export function extEventToUi(msg: unknown): UiEvent[] {
  const e = msg as ExtEvent;
  switch (e?.type) {
    case 'auth.changed':
      return [{ kind: 'auth.changed' }];
    case 'threads.changed':
      return [{ kind: 'threads.changed', workspaceId: e.workspaceId, threadId: e.threadId, pageId: e.pageId }];
    case 'thread.created':
      return [{ kind: 'threads.changed', workspaceId: e.thread.workspaceId, threadId: e.thread.id, pageId: e.thread.pageId }];
    case 'unread.changed':
      return [{ kind: 'unread.changed' }];
    case 'page.anchors':
      return [{ kind: 'page.anchors', tabId: e.tabId, url: e.url, anchors: e.anchors }];
    case 'thread.selected':
      return [{ kind: 'thread.selected', threadId: e.threadId, tabId: e.tabId }];
    case 'sync.status':
      return [{ kind: 'sync.status', pendingWrites: e.pendingWrites, online: e.online }];
    default:
      return [];
  }
}

function readFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export class ExtensionHost implements UiHost {
  isExtension = true;
  api: ApiLike = createApiProxy();
  serverUrl: string;
  state: AuthState;
  /** Tab the side panel works on (null in the full app page). */
  tabId: number | null = null;
  private listeners = new Set<(e: UiEvent) => void>();

  constructor(state: AuthState) {
    this.state = state;
    this.serverUrl = state.serverUrl;
    chrome.runtime.onMessage.addListener((msg: unknown) => {
      const e = msg as ExtEvent;
      if (e?.type === 'auth.changed') {
        this.state = e.state;
        this.serverUrl = e.state.serverUrl;
      }
      if (e?.type === 'sync.status') this.state = { ...this.state, pendingWrites: e.pendingWrites, online: e.online };
      for (const u of extEventToUi(msg)) this.emit(u);
      return false;
    });
    chrome.tabs?.onActivated?.addListener(() => this.emit({ kind: 'page.changed' }));
    chrome.tabs?.onUpdated?.addListener((tabId, info) => {
      if ((info.status === 'complete' || info.url) && (this.tabId === null || tabId === this.tabId)) this.emit({ kind: 'page.changed' });
    });
  }

  static async create(): Promise<ExtensionHost> {
    const cached = await bg<AuthState>({ type: 'auth.state' });
    if (!cached.signedIn) return new ExtensionHost(cached);
    // Re-check memberships so a team joined elsewhere shows up instead of an empty state.
    const fresh = await bg<AuthState | undefined>({ type: 'workspace.refresh' }).catch(() => undefined);
    return new ExtensionHost(fresh && 'signedIn' in fresh ? fresh : cached);
  }

  emit(e: UiEvent) {
    for (const l of [...this.listeners]) l(e);
  }

  getSession(): Session {
    return { me: this.state.me, activeWorkspaceId: this.state.activeWorkspaceId };
  }

  async refreshSession(): Promise<Session> {
    const s = await bg<AuthState | undefined>({ type: 'workspace.refresh' });
    this.state = s && 'signedIn' in s ? s : await bg<AuthState>({ type: 'auth.state' });
    this.emit({ kind: 'auth.changed' });
    return this.getSession();
  }

  async setActiveWorkspace(workspaceId: string) {
    await bg({ type: 'workspace.setActive', workspaceId });
    this.state = { ...this.state, activeWorkspaceId: workspaceId };
    this.emit({ kind: 'auth.changed' });
  }

  async signOut() {
    await bg({ type: 'auth.signOut' });
    this.state = { ...this.state, signedIn: false, me: null };
    this.emit({ kind: 'auth.changed' });
  }

  subscribe(listener: (e: UiEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  openThread(thread: Thread, opts?: { newTab?: boolean }) {
    bg({ type: 'thread.openOnPage', threadId: thread.id, url: thread.page.normalizedUrl, newTab: opts?.newTab }).catch(() => {});
  }

  tabCommand(command: TabCommand) {
    return bg({ type: 'tab.command', tabId: this.tabId ?? undefined, command });
  }

  focusOnPage = (threadId: string) => {
    this.tabCommand({ kind: 'thread.focus', threadId }).catch(() => {});
  };

  reattach = (threadId: string) => {
    this.tabCommand({ kind: 'thread.reattach', threadId }).catch(() => {});
  };

  async pageInfo(): Promise<PageInfo | null> {
    try {
      return await bg<PageInfo>({ type: 'page.info', tabId: this.tabId ?? undefined });
    } catch {
      return null;
    }
  }

  async postReply(_workspaceId: string, threadId: string, body: string, files: File[]) {
    const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: await readFile(f) })));
    await bg({ type: 'comment.create', threadId, body, attachments });
  }

  copy(text: string) {
    return copyToClipboard(text);
  }

  async exportThreads(_workspaceId: string, req: ExportRequest) {
    await bg({ type: 'export.download', format: req.format, query: req.query as Record<string, unknown> });
  }

  getDraft(key: string) {
    return bg<string | null>({ type: 'drafts.get', key });
  }

  setDraft(key: string, value: string | null) {
    return bg<void>({ type: 'drafts.set', key, value });
  }

  navigate(route: string) {
    const r = route.startsWith('/') ? route : '/' + route;
    if (location.pathname.endsWith('app.html')) location.hash = '#' + r;
    else chrome.tabs.create({ url: this.appUrl(r) });
  }

  appUrl(route: string) {
    return chrome.runtime.getURL('app.html') + '#' + (route.startsWith('/') ? route : '/' + route);
  }
}
