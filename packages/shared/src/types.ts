// Core domain types shared by the server, the extension and the web app.
// These are the wire shapes of the REST API (see api.ts and docs/API.md).

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type Scope = 'area' | 'section' | 'page';
export type UrlMatch = 'exact' | 'path' | 'site';
export type ThreadStatus = 'open' | 'resolved';
export type ThreadType = 'bug' | 'content' | 'design' | 'question' | 'other';
export type Priority = 'low' | 'medium' | 'high';
export type SnapshotKind = 'area' | 'viewport' | 'fullpage' | 'dom';
export type NotificationEvent = 'mention' | 'reply' | 'assignment' | 'resolution';
export type LinkSharing = 'members' | 'anyone';
export type ThreadSort = 'activity' | 'oldest' | 'page' | 'priority';
export type ExportFormat = 'md' | 'csv' | 'json' | 'pdf';
export type IntegrationKind = 'slack' | 'teams' | 'linear' | 'jira' | 'github';

export const THREAD_TYPES: ThreadType[] = ['bug', 'content', 'design', 'question', 'other'];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
export const SCOPES: Scope[] = ['area', 'section', 'page'];
export const NOTIFICATION_EVENTS: NotificationEvent[] = ['mention', 'reply', 'assignment', 'resolution'];

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface PrivacySettings {
  /** Allow full-page (scroll-and-stitch) snapshots. */
  allowFullPage: boolean;
  /** Allow DOM snapshots (sanitized HTML + computed styles). */
  allowDom: boolean;
  /** Force the author through the blur review step before a snapshot is saved. */
  requireBlurReview: boolean;
  /** Delete snapshot files older than this many days. null = keep forever. */
  snapshotRetentionDays: number | null;
}

export interface Workspace {
  id: string;
  name: string;
  /** Host patterns, e.g. "staging.example.com", "*.example.com". localhost is always allowed. */
  allowedSites: string[];
  linkSharing: LinkSharing;
  /** If set, only emails at this domain may join (except explicit guests). */
  emailDomain: string | null;
  privacy: PrivacySettings;
  /** Current invite-link token, only returned to admins. */
  inviteToken?: string | null;
  createdAt: string;
}

export interface ChannelPrefs {
  inApp: boolean;
  email: boolean;
  chat: boolean; // Slack / Teams
}

export interface NotificationPrefs {
  events: Record<NotificationEvent, ChannelPrefs>;
  emailMode: 'immediate' | 'digest';
}

export interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  user: User;
  role: Role;
  notificationPrefs: NotificationPrefs;
  createdAt: string;
}

export interface Membership {
  workspace: Workspace;
  member: Member;
}

export interface Page {
  id: string;
  workspaceId: string;
  /** Host, e.g. "app.example.com" or "localhost:3000". */
  site: string;
  /** Normalized full URL (see url.ts normalizeUrl). */
  normalizedUrl: string;
  /** Normalized path, e.g. "/pricing". */
  path: string;
  title: string;
  lastSeenAt: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentRef {
  framework: 'react' | 'vue' | 'angular' | 'svelte';
  name: string;
  file?: string;
  line?: number;
  /** Component ancestry, innermost first. */
  stack?: string[];
}

export interface TextRangeRef {
  /** Selected text. */
  text: string;
  /** Up to 32 characters of text before the selection, for disambiguation. */
  prefix: string;
  /** Up to 32 characters of text after the selection. */
  suffix: string;
}

export interface AnchorTarget {
  /** Selector candidates, most stable first. */
  selectors: string[];
  xpath: string;
  /** Structural path (tag:nth-child chain) used as last resort. */
  structuralPath: string;
  /** Normalized visible text of the element (trimmed, max 120 chars). */
  textFingerprint: string;
  tag: string;
  /** Selected rectangle relative to the element (fractions of its box + size in px). */
  rect: { relX: number; relY: number; w: number; h: number };
  /** Selected rectangle relative to the document at capture time (CSS px). */
  docRect: Rect;
  /** Selectors of same-origin iframes from the top document down to the element's frame. */
  frames?: string[];
  /** Selectors of open shadow hosts from the document down to the element. */
  shadowHosts?: string[];
}

export interface Anchor extends Partial<AnchorTarget> {
  scope: Scope;
  urlMatch: UrlMatch;
  viewport: { w: number; h: number; dpr: number };
  /** For free rectangles that are not tied to one element. */
  freeRect?: boolean;
  /** For multi-select (shift+click), every selected element. The combined box is in docRect. */
  targets?: AnchorTarget[];
  /** For text-range comments. */
  textRange?: TextRangeRef;
  /** For section scope: landmark/heading info so reordering inside does not break it. */
  section?: { landmark: string; heading: string };
  component?: ComponentRef;
  /** Outer HTML of the element, trimmed to 2000 chars. */
  htmlSnippet?: string;
  /** JS path, e.g. document.querySelector("...") */
  jsPath?: string;
}

export interface AnchorHistoryEntry {
  anchor: Anchor;
  scope: Scope;
  changedAt: string;
  changedBy: string;
}

export interface SnapshotContext {
  pageUrl: string;
  pageTitle: string;
  viewport: { w: number; h: number };
  dpr: number;
  browser: string;
  os: string;
  scroll: { x: number; y: number };
  capturedAt: string;
}

export interface Snapshot {
  id: string;
  threadId: string;
  kind: SnapshotKind;
  /** Signed, time-limited URL for the file. */
  url: string;
  contentType: string;
  width: number | null;
  height: number | null;
  context: SnapshotContext;
  capturedAt: string;
  /** Set when a newer snapshot of the same kind replaced this one (kept as history). */
  replacedAt: string | null;
}

export interface Attachment {
  id: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Comment {
  id: string;
  threadId: string;
  authorId: string;
  author: User;
  /** Markdown-lite source: **bold**, *italic*, `code`, [text](url), @[Name](userId) mentions. */
  body: string;
  mentions: string[];
  attachments: Attachment[];
  reactions: Reaction[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface Thread {
  id: string;
  workspaceId: string;
  pageId: string;
  page: Page;
  /** Per-page sequence number, shown on pins. */
  number: number;
  scope: Scope;
  urlMatch: UrlMatch;
  anchor: Anchor;
  anchorHistory: AnchorHistoryEntry[];
  status: ThreadStatus;
  assigneeId: string | null;
  assignee: User | null;
  type: ThreadType | null;
  priority: Priority | null;
  detached: boolean;
  createdBy: string;
  author: User;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  lastActivityAt: string;
  commentCount: number;
  firstComment: Comment | null;
  /** Latest (non-replaced) snapshots. */
  snapshots: Snapshot[];
  unread: boolean;
  /** Present when a share link exists and the caller can see it. */
  shareToken: string | null;
}

export interface ThreadDetail extends Thread {
  comments: Comment[];
  /** All snapshots including replaced ones. */
  snapshotHistory: Snapshot[];
}

export interface Notification {
  id: string;
  workspaceId: string;
  event: NotificationEvent;
  threadId: string;
  commentId: string | null;
  actor: User;
  /** Short summary shown in the inbox. */
  title: string;
  excerpt: string;
  pageUrl: string;
  read: boolean;
  createdAt: string;
}

export type ActivityAction =
  | 'thread.created'
  | 'thread.resolved'
  | 'thread.reopened'
  | 'thread.assigned'
  | 'thread.updated'
  | 'thread.deleted'
  | 'thread.scope_changed'
  | 'thread.reattached'
  | 'comment.created'
  | 'comment.edited'
  | 'comment.deleted'
  | 'comment.restored'
  | 'snapshot.replaced'
  | 'share.created'
  | 'share.revoked';

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  threadId: string | null;
  actor: User | null;
  action: ActivityAction;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ThreadFilters {
  status?: ThreadStatus;
  authorId?: string;
  assigneeId?: string;
  /** 'none' filters unassigned threads. */
  unassigned?: boolean;
  mentionsMe?: boolean;
  scope?: Scope;
  type?: ThreadType;
  priority?: Priority;
  site?: string;
  pageId?: string;
  /** ISO date (inclusive) on createdAt. */
  from?: string;
  to?: string;
  /** Full-text search across comments, replies and page titles. */
  q?: string;
  unread?: boolean;
  detached?: boolean;
}

export interface SavedView {
  id: string;
  workspaceId: string;
  name: string;
  filters: ThreadFilters;
  sort: ThreadSort;
  shared: boolean;
  createdBy: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  createdAt: string;
  acceptedAt: string | null;
}

export interface GuestGrant {
  id: string;
  workspaceId: string;
  token: string;
  threadIds: string[];
  pageIds: string[];
  createdAt: string;
  revokedAt: string | null;
}

export interface ShareInfo {
  token: string;
  url: string;
  kind: 'thread' | 'page';
  createdAt: string;
}

export interface ApiKey {
  id: string;
  workspaceId: string;
  name: string;
  /** Only returned once at creation. */
  key?: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type WebhookEvent =
  | 'thread.created'
  | 'thread.updated'
  | 'thread.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted';

export interface Webhook {
  id: string;
  workspaceId: string;
  url: string;
  events: WebhookEvent[];
  /** Only returned at creation. Used for the X-Pinpoint-Signature HMAC-SHA256 header. */
  secret?: string;
  active: boolean;
  createdAt: string;
}

export interface IntegrationConfig {
  kind: IntegrationKind;
  enabled: boolean;
  /**
   * slack/teams: { webhookUrl }
   * linear: { apiKey, teamId }
   * jira: { baseUrl, email, apiToken, projectKey, issueType? }
   * github: { token, owner, repo }
   * Secret values are masked ("••••") when read back.
   */
  settings: Record<string, string>;
}

export interface TicketLink {
  kind: IntegrationKind;
  url: string;
  externalId: string;
  createdAt: string;
}

/** Real-time events pushed over the WebSocket and to webhooks. */
export interface RealtimeEvent {
  kind:
    | 'thread.created'
    | 'thread.updated'
    | 'thread.deleted'
    | 'comment.created'
    | 'comment.updated'
    | 'comment.deleted'
    | 'notification.created'
    | 'workspace.updated';
  workspaceId: string;
  threadId?: string;
  pageId?: string;
  /** For notification.created, only delivered to this user. */
  userId?: string;
  at: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until accessToken expires. */
  expiresIn: number;
}

export interface Me {
  user: User;
  memberships: Membership[];
  analyticsOptOut: boolean;
}

export interface UnreadCounts {
  mentions: number;
  notifications: number;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  allowFullPage: true,
  allowDom: true,
  requireBlurReview: false,
  snapshotRetentionDays: null,
};

export function defaultNotificationPrefs(): NotificationPrefs {
  const on: ChannelPrefs = { inApp: true, email: true, chat: true };
  return {
    events: {
      mention: { ...on },
      reply: { inApp: true, email: true, chat: false },
      assignment: { ...on },
      resolution: { inApp: true, email: false, chat: false },
    },
    emailMode: 'immediate',
  };
}
