import { can, extractMentions, type Role, type ThreadFilters, type ThreadSort } from '@pinpoint/shared';
import type { AppCtx, Principal } from '../context';
import { guestScope } from '../context';
import { badRequest, forbidden } from '../errors';
import { logActivity } from './activity';
import { emitChange } from './events';
import { notify } from './notify';

export interface ThreadQuery {
  where: string;
  params: unknown[];
  order: string;
}

const bool = (v: unknown) => v === true || v === 'true' || v === '1';

/** Build the WHERE/ORDER for listing threads (alias t = threads, p = pages). */
export async function buildThreadQuery(
  ctx: AppCtx,
  principal: Principal,
  role: Role,
  workspaceId: string,
  f: ThreadFilters & Record<string, unknown>,
  sort: ThreadSort = 'activity',
): Promise<ThreadQuery> {
  const params: unknown[] = [workspaceId];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const w: string[] = ['t.workspace_id = $1', 't.deleted_at IS NULL'];
  const viewer = principal.userId;
  if (role === 'guest') {
    const g = await guestScope(ctx, workspaceId, viewer);
    w.push(`(t.id = ANY(${add(g.threadIds)}::uuid[]) OR t.page_id = ANY(${add(g.pageIds)}::uuid[]) OR t.created_by = ${add(viewer)})`);
  }
  const uuidRe = /^[0-9a-f-]{36}$/i;
  if (f.status === 'open' || f.status === 'resolved') w.push(`t.status = ${add(f.status)}`);
  if (typeof f.authorId === 'string' && uuidRe.test(f.authorId)) w.push(`t.created_by = ${add(f.authorId)}`);
  if (typeof f.assigneeId === 'string' && uuidRe.test(f.assigneeId)) w.push(`t.assignee_id = ${add(f.assigneeId)}`);
  if (bool(f.unassigned)) w.push('t.assignee_id IS NULL');
  if (bool(f.mentionsMe))
    w.push(`EXISTS (SELECT 1 FROM comments mc WHERE mc.thread_id = t.id AND mc.deleted_at IS NULL AND mc.mentions @> ${add(JSON.stringify([viewer]))}::jsonb)`);
  if (typeof f.scope === 'string' && ['area', 'section', 'page'].includes(f.scope)) w.push(`t.scope = ${add(f.scope)}`);
  if (typeof f.type === 'string' && f.type) w.push(`t.type = ${add(f.type)}`);
  if (typeof f.priority === 'string' && f.priority) w.push(`t.priority = ${add(f.priority)}`);
  if (typeof f.site === 'string' && f.site) w.push(`p.site = ${add(f.site.toLowerCase().replace(/^www\./, ''))}`);
  if (typeof f.pageId === 'string' && uuidRe.test(f.pageId)) w.push(`t.page_id = ${add(f.pageId)}`);
  const date = (s: unknown) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : null);
  const from = date(f.from);
  const to = date(f.to);
  if (from) w.push(`t.created_at >= ${add(from)}::timestamptz`);
  if (to) w.push(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `t.created_at < (${add(to)}::date + 1)` : `t.created_at <= ${add(to)}::timestamptz`);
  if (bool(f.detached)) w.push('t.detached = true');
  if (bool(f.unread))
    w.push(`NOT EXISTS (SELECT 1 FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = ${add(viewer)} AND r.read_at >= t.last_activity_at)`);
  if (typeof f.q === 'string' && f.q.trim()) {
    const q = f.q.trim().slice(0, 200);
    const tsq = add(q);
    const like = add(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    w.push(`(
      p.search @@ websearch_to_tsquery('english', ${tsq}) OR p.title ILIKE ${like} OR p.normalized_url ILIKE ${like}
      OR EXISTS (SELECT 1 FROM comments sc WHERE sc.thread_id = t.id AND sc.deleted_at IS NULL
                 AND (sc.search @@ websearch_to_tsquery('english', ${tsq}) OR sc.body ILIKE ${like})))`);
  }
  const orders: Record<ThreadSort, string> = {
    activity: 't.last_activity_at DESC, t.id',
    oldest: 't.created_at ASC, t.id',
    page: `p.normalized_url ASC, CASE WHEN t.scope = 'page' THEN 0 ELSE 1 END, t.order_y ASC, t.order_x ASC, t.number ASC`,
    priority: `CASE t.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, t.last_activity_at DESC, t.id`,
  };
  return { where: w.join(' AND '), params, order: orders[sort] ?? orders.activity };
}

export async function queryThreadIds(ctx: AppCtx, q: ThreadQuery, limit: number, offset: number): Promise<{ ids: string[]; total: number }> {
  const [{ rows }, { rows: c }] = await Promise.all([
    ctx.db.query<{ id: string }>(
      `SELECT t.id FROM threads t JOIN pages p ON p.id = t.page_id WHERE ${q.where} ORDER BY ${q.order} LIMIT ${limit} OFFSET ${offset}`,
      q.params,
    ),
    ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM threads t JOIN pages p ON p.id = t.page_id WHERE ${q.where}`, q.params),
  ]);
  return { ids: rows.map((r) => r.id), total: c[0].n };
}

/** Workspace member user ids among `ids`. */
export async function memberUserIds(ctx: AppCtx, workspaceId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await ctx.db.query<{ user_id: string }>('SELECT user_id FROM members WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])', [
    workspaceId,
    ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
  ]);
  return rows.map((r) => r.user_id);
}

export async function mentionsIn(ctx: AppCtx, workspaceId: string, body: string): Promise<string[]> {
  return memberUserIds(ctx, workspaceId, extractMentions(body));
}

export function anchorOrder(anchor: any): { y: number; x: number } {
  const r = anchor?.docRect ?? anchor?.targets?.[0]?.docRect;
  return { y: Number(r?.y) || 0, x: Number(r?.x) || 0 };
}

export interface ThreadPatch {
  status?: 'open' | 'resolved';
  assigneeId?: string | null;
  type?: string | null;
  priority?: string | null;
  scope?: 'area' | 'section' | 'page';
  anchor?: any;
  urlMatch?: 'exact' | 'path' | 'site';
  detached?: boolean;
}

/** Apply a patch to a thread with permission checks, history, activity, notifications and events. */
export async function applyThreadPatch(ctx: AppCtx, p: Principal, role: Role, t: any, patch: ThreadPatch): Promise<void> {
  const actor = p.userId;
  const own = t.created_by === actor;
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  let touched = false;
  const after: (() => Promise<void>)[] = [];

  if (patch.status && patch.status !== t.status) {
    if (!(can(role, 'resolveAny') || (own && can(role, 'resolveOwn')))) throw forbidden('You can only resolve your own threads');
    set('status', patch.status);
    if (patch.status === 'resolved') {
      set('resolved_by', actor);
      set('resolved_at', new Date().toISOString());
    } else {
      set('resolved_by', null);
      set('resolved_at', null);
    }
    touched = true;
    after.push(async () => {
      await logActivity(ctx, { workspaceId: t.workspace_id, threadId: t.id, actorId: actor, action: patch.status === 'resolved' ? 'thread.resolved' : 'thread.reopened' });
      if (patch.status === 'resolved')
        await notify(ctx, { event: 'resolution', workspaceId: t.workspace_id, threadId: t.id, actorId: actor, recipientIds: [t.created_by] });
    });
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== t.assignee_id) {
    if (!can(role, 'assign')) throw forbidden();
    if (patch.assigneeId) {
      const { rows } = await ctx.db.query(`SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2`, [t.workspace_id, patch.assigneeId]);
      if (!rows[0]) throw badRequest('Assignee must be a workspace member', 'validation_error');
    }
    set('assignee_id', patch.assigneeId);
    touched = true;
    after.push(async () => {
      await logActivity(ctx, { workspaceId: t.workspace_id, threadId: t.id, actorId: actor, action: 'thread.assigned', detail: { assigneeId: patch.assigneeId } });
      if (patch.assigneeId)
        await notify(ctx, { event: 'assignment', workspaceId: t.workspace_id, threadId: t.id, actorId: actor, recipientIds: [patch.assigneeId] });
    });
  }
  const meta: Record<string, unknown> = {};
  if (patch.type !== undefined && patch.type !== t.type) {
    if (role === 'guest' && !own) throw forbidden();
    set('type', patch.type);
    meta.type = patch.type;
  }
  if (patch.priority !== undefined && patch.priority !== t.priority) {
    if (role === 'guest' && !own) throw forbidden();
    set('priority', patch.priority);
    meta.priority = patch.priority;
  }
  if (patch.urlMatch && patch.urlMatch !== t.url_match) {
    if (role === 'guest' && !own) throw forbidden();
    set('url_match', patch.urlMatch);
    meta.urlMatch = patch.urlMatch;
  }
  if (Object.keys(meta).length) {
    touched = true;
    after.push(() => logActivity(ctx, { workspaceId: t.workspace_id, threadId: t.id, actorId: actor, action: 'thread.updated', detail: meta }));
  }
  const scopeChanged = patch.scope && patch.scope !== t.scope;
  if (scopeChanged || patch.anchor) {
    if (role === 'guest' && !own) throw forbidden();
    const history = [...(t.anchor_history ?? []), { anchor: t.anchor, scope: t.scope, changedAt: new Date().toISOString(), changedBy: actor }];
    set('anchor_history', JSON.stringify(history.slice(-50)));
    const nextScope = patch.scope ?? t.scope;
    const nextAnchor = { ...(patch.anchor ?? t.anchor), scope: nextScope, urlMatch: patch.urlMatch ?? patch.anchor?.urlMatch ?? t.url_match };
    set('anchor', JSON.stringify(nextAnchor));
    set('scope', nextScope);
    const o = anchorOrder(nextAnchor);
    set('order_y', o.y);
    set('order_x', o.x);
    if (patch.detached === undefined) set('detached', false);
    touched = true;
    after.push(() =>
      logActivity(ctx, {
        workspaceId: t.workspace_id,
        threadId: t.id,
        actorId: actor,
        action: scopeChanged ? 'thread.scope_changed' : 'thread.reattached',
        detail: scopeChanged ? { from: t.scope, to: nextScope } : {},
      }),
    );
  }
  if (patch.detached !== undefined && patch.detached !== t.detached) {
    if (role === 'guest' && !own) throw forbidden();
    set('detached', patch.detached);
  }
  if (!sets.length) return;
  if (touched) sets.push('last_activity_at = now()');
  params.push(t.id);
  await ctx.db.query(`UPDATE threads SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (touched) await markRead(ctx, t.id, actor);
  for (const fn of after) await fn();
  await emitChange(ctx, 'thread.updated', { workspaceId: t.workspace_id, threadId: t.id, pageId: t.page_id });
}

export async function markRead(ctx: AppCtx, threadId: string, userId: string) {
  await ctx.db.query(
    `INSERT INTO thread_reads (thread_id, user_id, read_at) VALUES ($1, $2, now())
     ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = now()`,
    [threadId, userId],
  );
}

export async function softDeleteThread(ctx: AppCtx, p: Principal, role: Role, t: any) {
  if (!(t.created_by === p.userId || can(role, 'deleteAny'))) throw forbidden('You can only delete your own threads');
  await ctx.db.query('UPDATE threads SET deleted_at = now() WHERE id = $1', [t.id]);
  await ctx.db.query(`UPDATE share_links SET revoked_at = now() WHERE thread_id = $1 AND revoked_at IS NULL`, [t.id]);
  await logActivity(ctx, { workspaceId: t.workspace_id, threadId: t.id, actorId: p.userId, action: 'thread.deleted' });
  await emitChange(ctx, 'thread.deleted', { workspaceId: t.workspace_id, threadId: t.id, pageId: t.page_id });
}

/** Participants of a thread: creator, assignee and everyone who commented. */
export async function participants(ctx: AppCtx, t: any): Promise<string[]> {
  const { rows } = await ctx.db.query<{ author_id: string }>('SELECT DISTINCT author_id FROM comments WHERE thread_id = $1 AND deleted_at IS NULL', [t.id]);
  return [...new Set([t.created_by, t.assignee_id, ...rows.map((r) => r.author_id)].filter(Boolean))];
}
