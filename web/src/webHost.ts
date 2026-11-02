import { ApiClient, type AuthTokens, type Me, type RealtimeEvent } from '@pinpoint/shared';
import { copyToClipboard, liveThreadUrl, localDrafts, type Session, type UiEvent, type UiHost } from '@pinpoint/ui';

// Shared with the server-rendered share viewer so sessions carry across.
const TOKENS_KEY = 'pinpoint.auth';
const WS_KEY = 'pp.web.activeWorkspace';

interface StoredTokens extends AuthTokens {
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/** Map a server realtime event to UI events. */
export function realtimeToUiEvents(e: RealtimeEvent): UiEvent[] {
  switch (e.kind) {
    case 'notification.created':
      return [{ kind: 'unread.changed' }];
    case 'workspace.updated':
      return [{ kind: 'auth.changed' }];
    default:
      return [{ kind: 'threads.changed', workspaceId: e.workspaceId, threadId: e.threadId, pageId: e.pageId }];
  }
}

export class WebHost implements UiHost {
  isExtension = false;
  api: ApiClient;
  serverUrl: string;
  private tokens: StoredTokens | null = load<StoredTokens>(TOKENS_KEY);
  private session: Session = { me: null, activeWorkspaceId: load<string>(WS_KEY) };
  private listeners = new Set<(e: UiEvent) => void>();
  private ws: WebSocket | null = null;
  private wsRetry = 0;
  private wsTimer: number | undefined;
  private refreshing: Promise<boolean> | null = null;

  constructor(serverUrl = location.origin) {
    this.serverUrl = serverUrl;
    this.api = new ApiClient({
      baseUrl: serverUrl,
      getToken: () => this.accessToken(),
      onUnauthorized: () => this.refresh(),
    });
  }

  get signedIn() {
    return !!this.tokens;
  }

  setTokens(t: AuthTokens | null) {
    this.tokens = t ? { ...t, expiresAt: Date.now() + t.expiresIn * 1000 } : null;
    save(TOKENS_KEY, this.tokens);
    if (!t) {
      this.session = { me: null, activeWorkspaceId: this.session.activeWorkspaceId };
      this.closeSocket();
    }
  }

  private async accessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (this.tokens.expiresAt - Date.now() < 30_000) await this.refresh();
    return this.tokens?.accessToken ?? null;
  }

  /** Rotate the refresh token; signs out on failure. */
  refresh(): Promise<boolean> {
    if (!this.tokens) return Promise.resolve(false);
    if (!this.refreshing) {
      const rt = this.tokens.refreshToken;
      this.refreshing = this.api
        .refresh(rt)
        .then((t) => {
          this.setTokens(t);
          return true;
        })
        .catch(() => {
          this.setTokens(null);
          this.emit({ kind: 'auth.changed' });
          return false;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  getSession(): Session {
    return this.session;
  }

  async refreshSession(): Promise<Session> {
    const me: Me = await this.api.me();
    const ids = me.memberships.map((m) => m.workspace.id);
    const active = this.session.activeWorkspaceId && ids.includes(this.session.activeWorkspaceId) ? this.session.activeWorkspaceId : ids[0] ?? null;
    this.session = { me, activeWorkspaceId: active };
    save(WS_KEY, active);
    this.emit({ kind: 'auth.changed' });
    this.connectSocket();
    return this.session;
  }

  async setActiveWorkspace(workspaceId: string) {
    this.session = { ...this.session, activeWorkspaceId: workspaceId };
    save(WS_KEY, workspaceId);
    this.emit({ kind: 'auth.changed' });
    this.subscribeWorkspace();
  }

  async signOut() {
    const rt = this.tokens?.refreshToken;
    if (rt) await this.api.logout(rt).catch(() => {});
    this.setTokens(null);
    this.emit({ kind: 'auth.changed' });
    location.hash = '#/login';
  }

  subscribe(listener: (e: UiEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(e: UiEvent) {
    for (const l of [...this.listeners]) l(e);
  }

  // ---------- live updates (FR-2.11) ----------
  private connectSocket() {
    if (this.ws || !this.tokens || typeof WebSocket === 'undefined') return;
    this.accessToken().then((token) => {
      if (!token || this.ws) return;
      const ws = new WebSocket(this.api.wsUrl(token));
      this.ws = ws;
      ws.onopen = () => {
        this.wsRetry = 0;
        this.subscribeWorkspace();
      };
      ws.onmessage = (m) => {
        try {
          const data = JSON.parse(String(m.data));
          const ev: RealtimeEvent | undefined = data?.event ?? (data?.kind ? data : undefined);
          if (!ev) return;
          if (ev.kind === 'workspace.updated') {
            this.refreshSession().catch(() => {});
            return;
          }
          for (const u of realtimeToUiEvents(ev)) this.emit(u);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        this.ws = null;
        if (!this.tokens) return;
        const delay = Math.min(30_000, 1000 * 2 ** this.wsRetry++);
        clearTimeout(this.wsTimer);
        this.wsTimer = setTimeout(() => this.connectSocket(), delay) as unknown as number;
      };
    });
  }

  private subscribeWorkspace() {
    if (this.ws?.readyState === WebSocket.OPEN && this.session.activeWorkspaceId) {
      this.ws.send(JSON.stringify({ type: 'subscribe', workspaceId: this.session.activeWorkspaceId }));
    }
  }

  private closeSocket() {
    clearTimeout(this.wsTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  // ---------- actions ----------
  openThread(thread: { id: string; page: { normalizedUrl: string } }, opts?: { newTab?: boolean }) {
    const url = liveThreadUrl(thread.page.normalizedUrl, thread.id);
    if (opts?.newTab === false) location.href = url;
    else window.open(url, '_blank', 'noopener');
  }

  async postReply(workspaceId: string, threadId: string, body: string, files: File[]) {
    const attachmentIds: string[] = [];
    for (const f of files) attachmentIds.push((await this.api.uploadAttachment(workspaceId, f, f.name)).id);
    await this.api.addComment(threadId, { body, attachmentIds, clientId: crypto.randomUUID?.() });
  }

  copy(text: string) {
    return copyToClipboard(text);
  }

  async exportThreads(workspaceId: string, req: { format: 'md' | 'csv' | 'json' | 'pdf'; query: Record<string, unknown>; filename: string }) {
    const { token } = await this.api.exportToken(workspaceId);
    const url = this.api.exportUrl(workspaceId, req.format, token, req.query);
    const a = document.createElement('a');
    a.href = url;
    a.download = req.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  getDraft(key: string) {
    return localDrafts.get(key);
  }
  setDraft(key: string, value: string | null) {
    return localDrafts.set(key, value);
  }

  navigate(route: string) {
    location.hash = route.startsWith('#') ? route : `#${route.startsWith('/') ? route : '/' + route}`;
  }

  appUrl(route: string) {
    return `${this.serverUrl}/app/#${route.startsWith('/') ? route : '/' + route}`;
  }
}
