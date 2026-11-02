// Typed REST client. This file IS the API contract between the clients and the server:
// every method maps 1:1 to a server route (see docs/API.md). Base path: {baseUrl}/api/v1
//
// Errors: non-2xx responses have JSON body { error: { code: string, message: string } }.
// Auth: "Authorization: Bearer <accessToken>" (user session) or "Bearer pk_..." (workspace API key).

import type {
  ActivityEntry,
  Anchor,
  ApiKey,
  Attachment,
  AuthTokens,
  Comment,
  ExportFormat,
  GuestGrant,
  IntegrationConfig,
  IntegrationKind,
  Invite,
  LinkSharing,
  Me,
  Member,
  Membership,
  Notification,
  NotificationPrefs,
  Page,
  Paginated,
  Priority,
  PrivacySettings,
  Role,
  SavedView,
  Scope,
  ShareInfo,
  Snapshot,
  SnapshotContext,
  SnapshotKind,
  Thread,
  ThreadDetail,
  ThreadFilters,
  ThreadSort,
  ThreadStatus,
  ThreadType,
  TicketLink,
  UnreadCounts,
  UrlMatch,
  Webhook,
  WebhookEvent,
  Workspace,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateThreadInput {
  /** Raw page URL; the server normalizes it and finds/creates the Page. */
  url: string;
  title: string;
  scope: Scope;
  urlMatch: UrlMatch;
  anchor: Anchor;
  body: string;
  attachmentIds?: string[];
  type?: ThreadType | null;
  priority?: Priority | null;
  assigneeId?: string | null;
  /** Client-generated id for idempotent retries from the offline queue. */
  clientId?: string;
}

export interface UpdateThreadInput {
  status?: ThreadStatus;
  assigneeId?: string | null;
  type?: ThreadType | null;
  priority?: Priority | null;
  /** Changing scope/anchor keeps the previous anchor in anchorHistory (FR-3.5). */
  scope?: Scope;
  anchor?: Anchor;
  urlMatch?: UrlMatch;
  detached?: boolean;
}

export type BulkAction =
  | { action: 'resolve' }
  | { action: 'reopen' }
  | { action: 'assign'; assigneeId: string | null }
  | { action: 'type'; type: ThreadType | null }
  | { action: 'priority'; priority: Priority | null }
  | { action: 'delete' };

export interface ListThreadsQuery extends ThreadFilters {
  sort?: ThreadSort;
  cursor?: string;
  limit?: number;
}

export interface UpdateWorkspaceInput {
  name?: string;
  allowedSites?: string[];
  linkSharing?: LinkSharing;
  emailDomain?: string | null;
  privacy?: Partial<PrivacySettings>;
}

export interface UploadSnapshotInput {
  kind: SnapshotKind;
  context: SnapshotContext;
  width?: number;
  height?: number;
  blob: Blob;
}

export interface SharedView {
  kind: 'thread' | 'page';
  workspaceName: string;
  page: Page;
  threads: ThreadDetail[];
}

export type TokenProvider = () => Promise<string | null> | string | null;

export interface ApiClientOptions {
  baseUrl: string;
  getToken: TokenProvider;
  /** Called on 401 so the host can refresh tokens; return true to retry once. */
  onUnauthorized?: () => Promise<boolean>;
  fetch?: typeof fetch;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  get baseUrl() {
    return this.opts.baseUrl.replace(/\/$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const token = await this.opts.getToken();
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await f(`${this.baseUrl}/api/v1${path}`, { method, headers, body: payload });
    if (res.status === 401 && retry && this.opts.onUnauthorized) {
      if (await this.opts.onUnauthorized()) return this.request<T>(method, path, body, false);
    }
    if (!res.ok) {
      let code = 'http_error';
      let message = res.statusText;
      try {
        const j = await res.json();
        code = j?.error?.code ?? code;
        message = j?.error?.message ?? message;
      } catch {
        /* not json */
      }
      throw new ApiError(res.status, code, message);
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  // ---------- auth ----------
  /** URL to open (in a tab or chrome.identity.launchWebAuthFlow) for OAuth sign in. */
  oauthStartUrl(provider: 'google' | 'microsoft', redirect: string): string {
    return `${this.baseUrl}/api/v1/auth/${provider}/start${qs({ redirect })}`;
  }
  /** Sends an email sign-in link that ends at `redirect#accessToken=..&refreshToken=..&expiresIn=..`. */
  emailSignIn(email: string, redirect: string) {
    return this.request<{ sent: true; devLink?: string }>('POST', '/auth/email', { email, redirect });
  }
  refresh(refreshToken: string) {
    return this.request<AuthTokens>('POST', '/auth/refresh', { refreshToken }, false);
  }
  logout(refreshToken: string) {
    return this.request<void>('POST', '/auth/logout', { refreshToken }, false);
  }
  /** Only enabled when the server runs with DEV_LOGIN=1. */
  devLogin(email: string, name?: string) {
    return this.request<AuthTokens>('POST', '/auth/dev-login', { email, name }, false);
  }
  me() {
    return this.request<Me>('GET', '/me');
  }
  updateMe(input: { name?: string; avatarUrl?: string | null; analyticsOptOut?: boolean }) {
    return this.request<Me>('PATCH', '/me', input);
  }
  /** GDPR data export: every record about the user as JSON. */
  exportMyData() {
    return this.request<Record<string, unknown>>('GET', '/me/export');
  }
  deleteMe() {
    return this.request<void>('DELETE', '/me');
  }

  // ---------- workspaces & members ----------
  createWorkspace(name: string) {
    return this.request<Membership>('POST', '/workspaces', { name });
  }
  getWorkspace(ws: string) {
    return this.request<Workspace>('GET', `/workspaces/${ws}`);
  }
  updateWorkspace(ws: string, input: UpdateWorkspaceInput) {
    return this.request<Workspace>('PATCH', `/workspaces/${ws}`, input);
  }
  deleteWorkspace(ws: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}`);
  }
  listMembers(ws: string) {
    return this.request<Member[]>('GET', `/workspaces/${ws}/members`);
  }
  updateMember(ws: string, memberId: string, input: { role: Role }) {
    return this.request<Member>('PATCH', `/workspaces/${ws}/members/${memberId}`, input);
  }
  removeMember(ws: string, memberId: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/members/${memberId}`);
  }
  updateMyPreferences(ws: string, prefs: NotificationPrefs) {
    return this.request<Member>('PUT', `/workspaces/${ws}/me/preferences`, prefs);
  }
  listInvites(ws: string) {
    return this.request<Invite[]>('GET', `/workspaces/${ws}/invites`);
  }
  invite(ws: string, emails: string[], role: Role = 'member') {
    return this.request<Invite[]>('POST', `/workspaces/${ws}/invites`, { emails, role });
  }
  revokeInvite(ws: string, inviteId: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/invites/${inviteId}`);
  }
  rotateInviteLink(ws: string) {
    return this.request<{ token: string; url: string }>('POST', `/workspaces/${ws}/invite-link`);
  }
  disableInviteLink(ws: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/invite-link`);
  }
  /** Preview an email invite or invite-link token before accepting. */
  previewInvite(token: string) {
    return this.request<{ workspaceName: string; role: Role; kind: 'email' | 'link' | 'guest' }>('GET', `/invites/${token}`);
  }
  acceptInvite(token: string) {
    return this.request<Membership>('POST', `/invites/${token}/accept`);
  }
  listGuestGrants(ws: string) {
    return this.request<GuestGrant[]>('GET', `/workspaces/${ws}/guest-links`);
  }
  createGuestGrant(ws: string, input: { threadIds?: string[]; pageIds?: string[] }) {
    return this.request<GuestGrant & { url: string }>('POST', `/workspaces/${ws}/guest-links`, input);
  }
  revokeGuestGrant(ws: string, grantId: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/guest-links/${grantId}`);
  }

  // ---------- pages & threads ----------
  /** Threads that apply to `url` (honouring each thread's urlMatch), plus the matching page if it exists. */
  threadsForUrl(ws: string, url: string) {
    return this.request<{ page: Page | null; threads: Thread[] }>('GET', `/workspaces/${ws}/threads/for-url${qs({ url })}`);
  }
  listThreads(ws: string, query: ListThreadsQuery = {}) {
    return this.request<Paginated<Thread>>('GET', `/workspaces/${ws}/threads${qs(query as Record<string, unknown>)}`);
  }
  listPages(ws: string, site?: string) {
    return this.request<(Page & { threadCount: number; openCount: number })[]>('GET', `/workspaces/${ws}/pages${qs({ site })}`);
  }
  createThread(ws: string, input: CreateThreadInput) {
    return this.request<ThreadDetail>('POST', `/workspaces/${ws}/threads`, input);
  }
  getThread(id: string) {
    return this.request<ThreadDetail>('GET', `/threads/${id}`);
  }
  updateThread(id: string, input: UpdateThreadInput) {
    return this.request<ThreadDetail>('PATCH', `/threads/${id}`, input);
  }
  deleteThread(id: string) {
    return this.request<void>('DELETE', `/threads/${id}`);
  }
  bulk(ws: string, ids: string[], action: BulkAction) {
    return this.request<{ updated: number }>('POST', `/workspaces/${ws}/threads/bulk`, { ids, ...action });
  }
  markRead(threadId: string) {
    return this.request<void>('POST', `/threads/${threadId}/read`);
  }
  addComment(threadId: string, input: { body: string; attachmentIds?: string[]; clientId?: string }) {
    return this.request<Comment>('POST', `/threads/${threadId}/comments`, input);
  }
  editComment(commentId: string, body: string) {
    return this.request<Comment>('PATCH', `/comments/${commentId}`, { body });
  }
  deleteComment(commentId: string) {
    return this.request<void>('DELETE', `/comments/${commentId}`);
  }
  restoreComment(commentId: string) {
    return this.request<Comment>('POST', `/comments/${commentId}/restore`);
  }
  toggleReaction(commentId: string, emoji: string) {
    return this.request<Comment>('POST', `/comments/${commentId}/reactions`, { emoji });
  }
  activity(ws: string, threadId?: string) {
    return this.request<ActivityEntry[]>('GET', `/workspaces/${ws}/activity${qs({ threadId })}`);
  }

  // ---------- files ----------
  uploadSnapshot(threadId: string, input: UploadSnapshotInput) {
    const fd = new FormData();
    fd.set('kind', input.kind);
    fd.set('context', JSON.stringify(input.context));
    if (input.width) fd.set('width', String(input.width));
    if (input.height) fd.set('height', String(input.height));
    fd.set('file', input.blob, `${input.kind}.${input.blob.type.includes('html') ? 'html' : input.blob.type.includes('jpeg') ? 'jpg' : 'png'}`);
    return this.request<Snapshot>('POST', `/threads/${threadId}/snapshots`, fd);
  }
  uploadAttachment(ws: string, blob: Blob, name: string) {
    const fd = new FormData();
    fd.set('file', blob, name);
    return this.request<Attachment>('POST', `/workspaces/${ws}/attachments`, fd);
  }

  // ---------- sharing ----------
  shareThread(threadId: string) {
    return this.request<ShareInfo>('POST', `/threads/${threadId}/share`);
  }
  revokeThreadShare(threadId: string) {
    return this.request<void>('DELETE', `/threads/${threadId}/share`);
  }
  sharePage(pageId: string) {
    return this.request<ShareInfo>('POST', `/pages/${pageId}/share`);
  }
  revokePageShare(pageId: string) {
    return this.request<void>('DELETE', `/pages/${pageId}/share`);
  }
  /** Public share-link data (auth optional; required when the workspace limits links to members). */
  getShared(token: string) {
    return this.request<SharedView>('GET', `/share/${token}`);
  }

  // ---------- notifications ----------
  notifications(opts: { workspaceId?: string; unread?: boolean; limit?: number } = {}) {
    return this.request<Notification[]>('GET', `/notifications${qs(opts)}`);
  }
  unreadCounts(workspaceId?: string) {
    return this.request<UnreadCounts>('GET', `/notifications/counts${qs({ workspaceId })}`);
  }
  markNotificationsRead(input: { ids?: string[]; all?: boolean; threadId?: string }) {
    return this.request<void>('POST', '/notifications/read', input);
  }

  // ---------- views & export ----------
  listViews(ws: string) {
    return this.request<SavedView[]>('GET', `/workspaces/${ws}/views`);
  }
  createView(ws: string, input: Pick<SavedView, 'name' | 'filters' | 'sort' | 'shared'>) {
    return this.request<SavedView>('POST', `/workspaces/${ws}/views`, input);
  }
  updateView(ws: string, id: string, input: Partial<Pick<SavedView, 'name' | 'filters' | 'sort' | 'shared'>>) {
    return this.request<SavedView>('PATCH', `/workspaces/${ws}/views/${id}`, input);
  }
  deleteView(ws: string, id: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/views/${id}`);
  }
  /**
   * URL for bulk export. Either `ids` or filters. The server returns a file download
   * (Content-Disposition). Auth via the short-lived `downloadToken` from exportToken().
   */
  exportUrl(ws: string, format: ExportFormat, downloadToken: string, query: ListThreadsQuery & { ids?: string[] } = {}): string {
    const { ids, ...rest } = query;
    return `${this.baseUrl}/api/v1/workspaces/${ws}/export${qs({ ...rest, format, ids: ids?.join(','), dt: downloadToken })}`;
  }
  exportToken(ws: string) {
    return this.request<{ token: string }>('POST', `/workspaces/${ws}/export-token`);
  }
  /** Fetch an export directly (used by the extension, which can send the auth header). */
  async exportBlob(ws: string, format: ExportFormat, query: ListThreadsQuery & { ids?: string[] } = {}): Promise<Blob> {
    const { token } = await this.exportToken(ws);
    const f = this.opts.fetch ?? fetch;
    const res = await f(this.exportUrl(ws, format, token, query));
    if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Export failed');
    return res.blob();
  }

  // ---------- integrations, API keys, webhooks ----------
  listIntegrations(ws: string) {
    return this.request<IntegrationConfig[]>('GET', `/workspaces/${ws}/integrations`);
  }
  saveIntegration(ws: string, kind: IntegrationKind, input: { enabled: boolean; settings: Record<string, string> }) {
    return this.request<IntegrationConfig>('PUT', `/workspaces/${ws}/integrations/${kind}`, input);
  }
  createTicket(threadId: string, kind: Exclude<IntegrationKind, 'slack' | 'teams'>) {
    return this.request<TicketLink>('POST', `/threads/${threadId}/tickets`, { kind });
  }
  postToChat(threadId: string, kind: 'slack' | 'teams') {
    return this.request<void>('POST', `/threads/${threadId}/post`, { kind });
  }
  listTickets(threadId: string) {
    return this.request<TicketLink[]>('GET', `/threads/${threadId}/tickets`);
  }
  listApiKeys(ws: string) {
    return this.request<ApiKey[]>('GET', `/workspaces/${ws}/api-keys`);
  }
  createApiKey(ws: string, name: string) {
    return this.request<ApiKey>('POST', `/workspaces/${ws}/api-keys`, { name });
  }
  deleteApiKey(ws: string, id: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/api-keys/${id}`);
  }
  listWebhooks(ws: string) {
    return this.request<Webhook[]>('GET', `/workspaces/${ws}/webhooks`);
  }
  createWebhook(ws: string, input: { url: string; events: WebhookEvent[] }) {
    return this.request<Webhook>('POST', `/workspaces/${ws}/webhooks`, input);
  }
  deleteWebhook(ws: string, id: string) {
    return this.request<void>('DELETE', `/workspaces/${ws}/webhooks/${id}`);
  }

  // ---------- telemetry (anonymous; never page content or comment text) ----------
  track(events: { name: string; props?: Record<string, string | number | boolean> }[]) {
    return this.request<void>('POST', '/telemetry', { events });
  }
  reportError(input: { message: string; stack?: string; context: string; version: string }) {
    return this.request<void>('POST', '/errors', input);
  }

  /** WebSocket URL for real-time events. Send {"type":"subscribe","workspaceId":"..."} after open. */
  wsUrl(accessToken: string): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/api/v1/ws${qs({ token: accessToken })}`;
  }
}

/** Shape of the redirect fragment after a successful sign in: `#accessToken=..&refreshToken=..&expiresIn=..`. */
export function parseAuthFragment(url: string): AuthTokens | null {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const p = new URLSearchParams(hash);
  const accessToken = p.get('accessToken');
  const refreshToken = p.get('refreshToken');
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresIn: Number(p.get('expiresIn') ?? 900) };
}

export type { Membership };
