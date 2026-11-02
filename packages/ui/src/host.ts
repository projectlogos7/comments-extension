// Host adapter: the same UI components run in the web app (direct ApiClient + WebSocket)
// and in the extension (API proxied through the service worker, events via runtime messages).

import type { AnchorStatus, ApiClient, ExportFormat, ListThreadsQuery, Me, Thread } from '@pinpoint/shared';

type AsyncMethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => Promise<any> ? K : never;
}[keyof T];

/** Every async method of ApiClient except the raw request helper and blob export. */
export type ApiMethod = Exclude<AsyncMethodKeys<ApiClient>, 'request' | 'exportBlob'>;
export type ApiLike = Pick<ApiClient, ApiMethod>;

/** Normalized live events delivered to UI components. */
export type UiEvent =
  | { kind: 'auth.changed' }
  | { kind: 'threads.changed'; workspaceId: string; threadId?: string; pageId?: string }
  | { kind: 'unread.changed' }
  | { kind: 'thread.selected'; threadId: string; tabId?: number }
  | { kind: 'page.anchors'; tabId: number; url: string; anchors: AnchorStatus[] }
  | { kind: 'page.changed' }
  | { kind: 'sync.status'; pendingWrites: number; online: boolean };

export interface Session {
  me: Me | null;
  activeWorkspaceId: string | null;
}

export interface CurrentPage {
  tabId: number;
  url: string;
  title: string;
  allowed: boolean;
  hasPermission: boolean;
  active: boolean;
  pinsVisible: boolean;
  anchors: AnchorStatus[];
}

export interface ExportRequest {
  format: ExportFormat;
  query: ListThreadsQuery & { ids?: string[] };
  filename: string;
}

export interface UiHost {
  isExtension: boolean;
  api: ApiLike;
  /** Absolute base URL of the server (used to build share links for exports). */
  serverUrl: string;
  getSession(): Session;
  /** Re-fetch /me and update the session. */
  refreshSession(): Promise<Session>;
  setActiveWorkspace(workspaceId: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (e: UiEvent) => void): () => void;
  /** Navigate to the live page and highlight the thread (FR-4.6, FR-5.8). */
  openThread(thread: Thread, opts?: { newTab?: boolean }): void;
  /** Scroll to and highlight the thread on the current page (extension side panel). */
  focusOnPage?(threadId: string): void;
  /** Ask the current tab's content script to re-attach a detached thread. */
  reattach?(threadId: string): void;
  /**
   * Post a reply with optional image attachments. Web: upload each file then addComment.
   * Extension: BgRequest comment.create with data URLs (queued offline by the background).
   */
  postReply(workspaceId: string, threadId: string, body: string, files: File[]): Promise<void>;
  copy(text: string): Promise<void>;
  exportThreads(workspaceId: string, req: ExportRequest): Promise<void>;
  getDraft(key: string): Promise<string | null>;
  setDraft(key: string, value: string | null): Promise<void>;
  /** In-app navigation (hash routes) — e.g. to a thread page. */
  navigate(route: string): void;
  /** URL of a route in the full app (web app or extension app page). */
  appUrl(route: string): string;
}

export function shareUrlFor(serverUrl: string, token: string | null | undefined): string | null {
  return token ? `${serverUrl.replace(/\/$/, '')}/share/${token}` : null;
}

/** Public web-app URL of a route (for links shared with other people, e.g. invites). */
export function webAppUrl(serverUrl: string, route: string): string {
  return `${serverUrl.replace(/\/$/, '')}/app/#${route.startsWith('/') ? route : '/' + route}`;
}
