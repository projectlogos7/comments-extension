import {
  DEFAULT_PRIVACY,
  defaultNotificationPrefs,
  type Attachment,
  type Comment,
  type Member,
  type NotificationPrefs,
  type Page,
  type Reaction,
  type Snapshot,
  type Thread,
  type ThreadDetail,
  type User,
  type Workspace,
} from '@pinpoint/shared';
import type { AppCtx } from './context';
import { signFileUrl } from './storage';

export const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : d == null ? (null as any) : new Date(d as string).toISOString());
export const isoOrNull = (d: unknown): string | null => (d == null ? null : iso(d));

export function toUser(r: any): User {
  return {
    id: r.id,
    email: r.deleted_at ? '' : r.email,
    name: r.deleted_at ? 'Deleted user' : r.name || r.email?.split('@')[0] || 'User',
    avatarUrl: r.deleted_at ? null : r.avatar_url ?? null,
  };
}

const UNKNOWN_USER: User = { id: '', email: '', name: 'Unknown', avatarUrl: null };

export function toWorkspace(r: any, includeInviteToken = false): Workspace {
  return {
    id: r.id,
    name: r.name,
    allowedSites: r.allowed_sites ?? [],
    linkSharing: r.link_sharing,
    emailDomain: r.email_domain ?? null,
    privacy: { ...DEFAULT_PRIVACY, ...(r.privacy ?? {}) },
    ...(includeInviteToken ? { inviteToken: r.invite_token ?? null } : {}),
    createdAt: iso(r.created_at),
  };
}

export function mergePrefs(p: any): NotificationPrefs {
  const d = defaultNotificationPrefs();
  if (!p || typeof p !== 'object') return d;
  const events = { ...d.events };
  for (const k of Object.keys(events) as (keyof typeof events)[]) events[k] = { ...events[k], ...(p.events?.[k] ?? {}) };
  return { events, emailMode: p.emailMode === 'digest' ? 'digest' : 'immediate' };
}

export function toMember(r: any, user: User): Member {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    user,
    role: r.role,
    notificationPrefs: mergePrefs(r.notification_prefs),
    createdAt: iso(r.created_at),
  };
}

export async function loadMembers(app: AppCtx, workspaceId: string): Promise<Member[]> {
  const { rows } = await app.db.query(
    `SELECT m.*, u.id AS u_id, u.email, u.name, u.avatar_url, u.deleted_at AS u_deleted
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at`,
    [workspaceId],
  );
  return rows.map((r) => toMember(r, toUser({ id: r.u_id, email: r.email, name: r.name, avatar_url: r.avatar_url, deleted_at: r.u_deleted })));
}

export async function loadMember(app: AppCtx, memberId: string): Promise<Member | null> {
  const { rows } = await app.db.query(
    `SELECT m.*, u.id AS u_id, u.email, u.name, u.avatar_url, u.deleted_at AS u_deleted
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
    [memberId],
  );
  const r = rows[0];
  return r ? toMember(r, toUser({ id: r.u_id, email: r.email, name: r.name, avatar_url: r.avatar_url, deleted_at: r.u_deleted })) : null;
}

export function toPage(r: any): Page {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    site: r.site,
    normalizedUrl: r.normalized_url,
    path: r.path,
    title: r.title,
    lastSeenAt: iso(r.last_seen_at),
  };
}

export async function usersById(app: AppCtx, ids: (string | null | undefined)[]): Promise<Map<string, User>> {
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  const m = new Map<string, User>();
  if (!uniq.length) return m;
  const { rows } = await app.db.query('SELECT * FROM users WHERE id = ANY($1::uuid[])', [uniq]);
  for (const r of rows) m.set(r.id, toUser(r));
  return m;
}

export function toSnapshot(app: AppCtx, r: any, ttl = 3600): Snapshot {
  return {
    id: r.id,
    threadId: r.thread_id,
    kind: r.kind,
    url: signFileUrl(app.cfg, r.storage_key, ttl),
    contentType: r.content_type,
    width: r.width ?? null,
    height: r.height ?? null,
    context: r.context,
    capturedAt: iso(r.captured_at),
    replacedAt: isoOrNull(r.replaced_at),
  };
}

export function toAttachment(app: AppCtx, r: any): Attachment {
  return { id: r.id, url: signFileUrl(app.cfg, r.storage_key), name: r.name, contentType: r.content_type, size: r.size };
}

/** Load comments with authors, attachments and reactions. */
export async function loadComments(app: AppCtx, where: { threadIds?: string[]; commentIds?: string[] }): Promise<Comment[]> {
  let rows: any[];
  if (where.commentIds) rows = (await app.db.query('SELECT * FROM comments WHERE id = ANY($1::uuid[]) ORDER BY created_at, id', [where.commentIds])).rows;
  else rows = (await app.db.query('SELECT * FROM comments WHERE thread_id = ANY($1::uuid[]) ORDER BY created_at, id', [where.threadIds ?? []])).rows;
  return hydrateComments(app, rows);
}

export async function hydrateComments(app: AppCtx, rows: any[]): Promise<Comment[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [users, atts, reacts] = await Promise.all([
    usersById(app, rows.map((r) => r.author_id)),
    app.db.query('SELECT * FROM attachments WHERE comment_id = ANY($1::uuid[]) ORDER BY created_at', [ids]),
    app.db.query('SELECT comment_id, emoji, user_id FROM reactions WHERE comment_id = ANY($1::uuid[]) ORDER BY created_at', [ids]),
  ]);
  const attBy = new Map<string, Attachment[]>();
  for (const a of atts.rows) {
    const arr = attBy.get(a.comment_id) ?? [];
    arr.push(toAttachment(app, a));
    attBy.set(a.comment_id, arr);
  }
  const reactBy = new Map<string, Reaction[]>();
  for (const r of reacts.rows) {
    const arr = reactBy.get(r.comment_id) ?? [];
    let e = arr.find((x) => x.emoji === r.emoji);
    if (!e) arr.push((e = { emoji: r.emoji, userIds: [] }));
    e.userIds.push(r.user_id);
    reactBy.set(r.comment_id, arr);
  }
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    authorId: r.author_id,
    author: users.get(r.author_id) ?? { ...UNKNOWN_USER, id: r.author_id },
    body: r.deleted_at ? '' : r.body,
    mentions: r.deleted_at ? [] : r.mentions ?? [],
    attachments: r.deleted_at ? [] : attBy.get(r.id) ?? [],
    reactions: r.deleted_at ? [] : reactBy.get(r.id) ?? [],
    createdAt: iso(r.created_at),
    editedAt: isoOrNull(r.edited_at),
    deletedAt: isoOrNull(r.deleted_at),
  }));
}

/** Load threads by id (preserving order), shaped for the API, from the viewer's perspective. */
export async function loadThreads(app: AppCtx, ids: string[], viewerId: string | null, opts: { snapshotTtl?: number } = {}): Promise<Thread[]> {
  if (!ids.length) return [];
  const { rows: trows } = await app.db.query('SELECT * FROM threads WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [ids]);
  if (!trows.length) return [];
  const tids = trows.map((t) => t.id);
  const pageIds = [...new Set(trows.map((t) => t.page_id))];
  const [pages, firsts, counts, snaps, reads, shares] = await Promise.all([
    app.db.query('SELECT * FROM pages WHERE id = ANY($1::uuid[])', [pageIds]),
    app.db.query(
      `SELECT DISTINCT ON (thread_id) * FROM comments WHERE thread_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY thread_id, created_at, id`,
      [tids],
    ),
    app.db.query<{ thread_id: string; n: string }>(
      'SELECT thread_id, count(*)::int AS n FROM comments WHERE thread_id = ANY($1::uuid[]) AND deleted_at IS NULL GROUP BY thread_id',
      [tids],
    ),
    app.db.query('SELECT * FROM snapshots WHERE thread_id = ANY($1::uuid[]) AND replaced_at IS NULL ORDER BY captured_at', [tids]),
    viewerId
      ? app.db.query('SELECT thread_id, read_at FROM thread_reads WHERE thread_id = ANY($1::uuid[]) AND user_id = $2', [tids, viewerId])
      : Promise.resolve({ rows: [] as any[] }),
    app.db.query(`SELECT thread_id, token FROM share_links WHERE kind = 'thread' AND thread_id = ANY($1::uuid[]) AND revoked_at IS NULL`, [tids]),
  ]);
  const pageBy = new Map(pages.rows.map((p) => [p.id, toPage(p)]));
  const firstComments = await hydrateComments(app, firsts.rows);
  const firstBy = new Map(firstComments.map((c) => [c.threadId, c]));
  const countBy = new Map(counts.rows.map((c) => [c.thread_id, Number(c.n)]));
  const snapBy = new Map<string, Snapshot[]>();
  for (const s of snaps.rows) {
    const arr = snapBy.get(s.thread_id) ?? [];
    arr.push(toSnapshot(app, s, opts.snapshotTtl));
    snapBy.set(s.thread_id, arr);
  }
  const readBy = new Map(reads.rows.map((r: any) => [r.thread_id, new Date(r.read_at).getTime()]));
  const shareBy = new Map(shares.rows.map((s) => [s.thread_id, s.token]));
  const users = await usersById(app, trows.flatMap((t) => [t.created_by, t.assignee_id]));
  const byId = new Map<string, Thread>();
  for (const t of trows) {
    const read = readBy.get(t.id);
    byId.set(t.id, {
      id: t.id,
      workspaceId: t.workspace_id,
      pageId: t.page_id,
      page: pageBy.get(t.page_id)!,
      number: t.number,
      scope: t.scope,
      urlMatch: t.url_match,
      anchor: t.anchor,
      anchorHistory: t.anchor_history ?? [],
      status: t.status,
      assigneeId: t.assignee_id ?? null,
      assignee: t.assignee_id ? users.get(t.assignee_id) ?? null : null,
      type: t.type ?? null,
      priority: t.priority ?? null,
      detached: t.detached,
      createdBy: t.created_by,
      author: users.get(t.created_by) ?? { ...UNKNOWN_USER, id: t.created_by },
      createdAt: iso(t.created_at),
      resolvedBy: t.resolved_by ?? null,
      resolvedAt: isoOrNull(t.resolved_at),
      lastActivityAt: iso(t.last_activity_at),
      commentCount: countBy.get(t.id) ?? 0,
      firstComment: firstBy.get(t.id) ?? null,
      snapshots: snapBy.get(t.id) ?? [],
      unread: viewerId ? read === undefined || read < new Date(t.last_activity_at).getTime() : false,
      shareToken: shareBy.get(t.id) ?? null,
    });
  }
  return ids.map((id) => byId.get(id)).filter(Boolean) as Thread[];
}

export async function loadThreadDetails(app: AppCtx, ids: string[], viewerId: string | null, opts: { snapshotTtl?: number } = {}): Promise<ThreadDetail[]> {
  const threads = await loadThreads(app, ids, viewerId, opts);
  if (!threads.length) return [];
  const tids = threads.map((t) => t.id);
  const [comments, snaps] = await Promise.all([
    loadComments(app, { threadIds: tids }),
    app.db.query('SELECT * FROM snapshots WHERE thread_id = ANY($1::uuid[]) ORDER BY captured_at', [tids]),
  ]);
  return threads.map((t) => ({
    ...t,
    comments: comments.filter((c) => c.threadId === t.id),
    snapshotHistory: snaps.rows.filter((s) => s.thread_id === t.id).map((s) => toSnapshot(app, s, opts.snapshotTtl)),
  }));
}

export async function loadThreadDetail(app: AppCtx, id: string, viewerId: string | null): Promise<ThreadDetail> {
  const [t] = await loadThreadDetails(app, [id], viewerId);
  return t;
}

export function threadWebUrl(app: AppCtx, threadId: string): string {
  return `${app.cfg.publicUrl}/app/#/thread/${threadId}`;
}

export function shareUrl(app: AppCtx, token: string): string {
  return `${app.cfg.publicUrl}/share/${token}`;
}

/** Live-page link that makes the extension focus the thread (FR-4.6). */
export function livePageUrl(pageUrl: string, threadId: string): string {
  try {
    const u = new URL(pageUrl);
    u.searchParams.set('pinpoint_thread', threadId);
    return u.toString();
  } catch {
    return pageUrl;
  }
}
