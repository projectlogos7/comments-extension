// Message protocol between extension contexts:
//   content script  <->  service worker (background)  <->  side panel / popup / extension pages
//
// Requests to the background go through chrome.runtime.sendMessage(BgRequest) and resolve with
// BgResponse<T> = { ok: true, data } | { ok: false, error: { code, message, status? } }.
// The background pushes ExtEvent objects to every extension page (runtime.sendMessage) and to
// content scripts (tabs.sendMessage) so UIs can refresh.

import type { CreateThreadInput } from './api';
import type { Me, Rect, SnapshotContext, Thread, UnreadCounts } from './types';

export type ApiMethodName = string; // a method name of ApiClient

export interface AuthState {
  signedIn: boolean;
  me: Me | null;
  activeWorkspaceId: string | null;
  serverUrl: string;
  /** Number of queued offline writes not yet synced. */
  pendingWrites: number;
  online: boolean;
}

export interface SnapshotRequest {
  /** Viewport capture (data URL, PNG) taken right after selection, with the overlay hidden; may already be blurred. */
  viewportDataUrl?: string;
  /** Selection rect in viewport CSS px at capture time, used to crop the area snapshot. */
  areaRect?: Rect | null;
  /** Take a full-page scroll-and-stitch capture (FR-4.2). */
  fullPage: boolean;
  /** Regions (document CSS px) to blur in the full-page capture. */
  blurRegions?: Rect[];
  /** Sanitized outer HTML + computed styles of the element (FR-4.11), as an HTML document string. */
  domSnapshot?: string;
  context: SnapshotContext;
}

export type BgRequest =
  | { type: 'auth.state' }
  | { type: 'auth.signIn'; provider: 'google' | 'microsoft' }
  | { type: 'auth.emailSignIn'; email: string }
  | { type: 'auth.devSignIn'; email: string; name?: string }
  | { type: 'auth.signOut' }
  | { type: 'settings.setServerUrl'; serverUrl: string }
  | { type: 'workspace.setActive'; workspaceId: string }
  | { type: 'workspace.refresh' }
  /** Generic proxy: calls ApiClient[method](...args) with the session token. */
  | { type: 'api'; method: ApiMethodName; args: unknown[] }
  /** Capture the visible area of the sender tab (or tabId) as a PNG data URL. */
  | { type: 'capture.visible'; tabId?: number }
  /** Create a thread (queued offline if needed) and upload its snapshots in the background. */
  | { type: 'thread.create'; input: CreateThreadInput; snapshot: SnapshotRequest; attachments?: { name: string; dataUrl: string }[] }
  /** Reply with optional attachments as data URLs (queued offline if needed). */
  | { type: 'comment.create'; threadId: string; body: string; attachments?: { name: string; dataUrl: string }[] }
  | { type: 'snapshot.retake'; threadId: string; snapshot: SnapshotRequest }
  /** Ask the content script of a tab (default: active tab) to do something. */
  | { type: 'tab.command'; tabId?: number; command: TabCommand }
  /** Open a URL in a tab and focus a thread there (FR-4.6, FR-5.8). */
  | { type: 'thread.openOnPage'; threadId: string; url: string; newTab?: boolean }
  | { type: 'sidepanel.open'; tabId?: number; threadId?: string }
  /** Request optional host permission for the workspace's allowed sites (must come from a user gesture page). */
  | { type: 'permissions.sync' }
  | { type: 'export.download'; format: 'md' | 'csv' | 'json' | 'pdf'; query: Record<string, unknown> }
  | { type: 'drafts.get'; key: string }
  | { type: 'drafts.set'; key: string; value: string | null }
  | { type: 'page.info'; tabId?: number }
  | { type: 'badge.refresh' };

export type TabCommand =
  | { kind: 'commentMode.start' }
  | { kind: 'commentMode.stop' }
  | { kind: 'commentMode.toggle' }
  | { kind: 'pageComment.start' }
  | { kind: 'pins.toggle'; visible?: boolean }
  | { kind: 'thread.focus'; threadId: string }
  | { kind: 'thread.reattach'; threadId: string }
  | { kind: 'threads.reload' }
  | { kind: 'copy'; threadId: string; format: CopyFormat }
  | { kind: 'panel.toggle' };

export type CopyFormat = 'selector' | 'xpath' | 'jspath' | 'component' | 'html' | 'markdown' | 'ai';

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; status?: number } };

/** Resolution state of a thread's anchor on the current page, reported by the content script. */
export interface AnchorStatus {
  threadId: string;
  state: 'attached' | 'detached' | 'page';
  score: number;
  /** Order on the page (top-to-bottom, left-to-right) for "page order" sorting. */
  order: number;
}

export interface PageInfo {
  tabId: number;
  url: string;
  title: string;
  allowed: boolean;
  /** True when the extension has host permission for this tab's site. */
  hasPermission: boolean;
  /** Content script is injected and running. */
  active: boolean;
  pinsVisible: boolean;
  anchors: AnchorStatus[];
}

export type ExtEvent =
  | { type: 'auth.changed'; state: AuthState }
  | { type: 'threads.changed'; workspaceId: string; threadId?: string; pageId?: string }
  | { type: 'unread.changed'; counts: UnreadCounts }
  | { type: 'page.anchors'; tabId: number; url: string; anchors: AnchorStatus[] }
  | { type: 'thread.selected'; tabId: number; threadId: string }
  | { type: 'thread.created'; tabId?: number; thread: Thread }
  | { type: 'sync.status'; pendingWrites: number; online: boolean };

/** Messages from the background to a content script (chrome.tabs.sendMessage). */
export type ContentMessage =
  | { type: 'command'; command: TabCommand }
  | { type: 'event'; event: ExtEvent }
  /** Used during full-page capture: scroll to y and report back; hide/show overlay & fixed elements. */
  | { type: 'capture.prepare'; hideFixed: boolean }
  | { type: 'capture.scrollTo'; y: number }
  | { type: 'capture.restore' }
  | { type: 'capture.metrics' }
  | { type: 'page.info' };

/** Storage keys used in chrome.storage.local. */
export const STORAGE_KEYS = {
  serverUrl: 'pp.serverUrl',
  tokens: 'pp.tokens',
  me: 'pp.me',
  activeWorkspace: 'pp.activeWorkspace',
  queue: 'pp.queue',
  drafts: 'pp.drafts',
  pinsVisible: 'pp.pinsVisible',
  lastSeenNotification: 'pp.lastSeenNotification',
} as const;

export const DEFAULT_SERVER_URL = 'http://localhost:8787';

export function draftKey(parts: { workspaceId: string; url?: string; threadId?: string }): string {
  return parts.threadId ? `reply:${parts.threadId}` : `new:${parts.workspaceId}:${parts.url ?? ''}`;
}
