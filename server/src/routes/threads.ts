import type { FastifyInstance } from 'fastify';
import { can, normalizeUrl, urlMatches, type ThreadSort } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { guestScope, isUuid, requireAuth, requireRole, threadAccess } from '../context';
import { badRequest, forbidden, notFound } from '../errors';
import { iso, loadComments, loadThreadDetail, loadThreads, toPage } from '../model';
import { logActivity } from '../services/activity';
import { emitChange } from '../services/events';
import { notify } from '../services/notify';
import {
  anchorOrder,
  applyThreadPatch,
  buildThreadQuery,
  markRead,
  mentionsIn,
  participants,
  queryThreadIds,
  softDeleteThread,
} from '../services/threads';
import { parse, z } from '../validate';

const scope = z.enum(['area', 'section', 'page']);
const urlMatch = z.enum(['exact', 'path', 'site']);
const threadType = z.enum(['bug', 'content', 'design', 'question', 'other']);
const priority = z.enum(['low', 'medium', 'high']);
const anchorSchema = z
  .object({
    scope,
    urlMatch,
    viewport: z.object({ w: z.number(), h: z.number(), dpr: z.number() }),
  })
  .passthrough()
  .refine((a) => JSON.stringify(a).length <= 96 * 1024, 'anchor is too large');
const body = z.string().trim().min(1).max(20000);

export function registerThreadRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.get<{ Params: { ws: string }; Querystring: { url?: string } }>('/api/v1/workspaces/:ws/threads/for-url', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    let n;
    try {
      n = normalizeUrl(req.query.url ?? '');
    } catch {
      throw badRequest('Invalid url', 'validation_error');
    }
    const { rows: pages } = await ctx.db.query('SELECT * FROM pages WHERE workspace_id = $1 AND site = $2', [req.params.ws, n.site]);
    const pageBy = new Map(pages.map((pg) => [pg.id, pg]));
    const { rows } = await ctx.db.query(
      `SELECT t.id, t.page_id, t.url_match, t.created_by FROM threads t JOIN pages p ON p.id = t.page_id
       WHERE t.workspace_id = $1 AND p.site = $2 AND t.deleted_at IS NULL ORDER BY t.created_at`,
      [req.params.ws, n.site],
    );
    let visible = rows.filter((t) => urlMatches(pageBy.get(t.page_id).normalized_url, t.url_match, n.url));
    if (role === 'guest') {
      const g = await guestScope(ctx, req.params.ws, p.userId);
      visible = visible.filter((t) => g.threadIds.includes(t.id) || g.pageIds.includes(t.page_id) || t.created_by === p.userId);
    }
    const page = pages.find((pg) => pg.normalized_url === n.url);
    return { page: page ? toPage(page) : null, threads: await loadThreads(ctx, visible.map((t) => t.id), p.userId) };
  });

  app.get<{ Params: { ws: string }; Querystring: Record<string, string> }>('/api/v1/workspaces/:ws/threads', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    const { sort, cursor, limit: lim, ...filters } = req.query;
    const limit = Math.min(Math.max(Number(lim) || 50, 1), 200);
    const offset = cursor ? Math.max(Number(Buffer.from(cursor, 'base64url').toString()) || 0, 0) : 0;
    const q = await buildThreadQuery(ctx, p, role, req.params.ws, filters, (sort as ThreadSort) || 'activity');
    const { ids, total } = await queryThreadIds(ctx, q, limit, offset);
    const items = await loadThreads(ctx, ids, p.userId);
    const next = offset + ids.length;
    return { items, total, nextCursor: next < total ? Buffer.from(String(next)).toString('base64url') : null };
  });

  app.get<{ Params: { ws: string }; Querystring: { site?: string } }>('/api/v1/workspaces/:ws/pages', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    const params: unknown[] = [req.params.ws];
    let extra = '';
    if (req.query.site) {
      params.push(req.query.site.toLowerCase());
      extra += ` AND p.site = $${params.length}`;
    }
    let threadFilter = '';
    if (role === 'guest') {
      const g = await guestScope(ctx, req.params.ws, p.userId);
      params.push(g.threadIds, g.pageIds, p.userId);
      const n = params.length;
      threadFilter = ` AND (t.id = ANY($${n - 2}::uuid[]) OR t.page_id = ANY($${n - 1}::uuid[]) OR t.created_by = $${n})`;
    }
    const { rows } = await ctx.db.query(
      `SELECT p.*, count(t.id)::int AS thread_count, count(t.id) FILTER (WHERE t.status = 'open')::int AS open_count
       FROM pages p JOIN threads t ON t.page_id = p.id AND t.deleted_at IS NULL ${threadFilter}
       WHERE p.workspace_id = $1 ${extra}
       GROUP BY p.id ORDER BY p.site, p.path`,
      params,
    );
    return rows.map((r) => ({ ...toPage(r), threadCount: r.thread_count, openCount: r.open_count }));
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/threads', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws, 'comment');
    const input = parse(
      z.object({
        url: z.string().url().max(4000),
        title: z.string().max(500).default(''),
        scope,
        urlMatch,
        anchor: anchorSchema,
        body,
        attachmentIds: z.array(z.string().uuid()).max(10).default([]),
        type: threadType.nullable().optional(),
        priority: priority.nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        clientId: z.string().max(100).optional(),
      }),
      req.body,
    );
    const ws = req.params.ws;
    await assertAttachments(ctx, ws, p.userId, input.attachmentIds);
    if (input.clientId) {
      const { rows } = await ctx.db.query('SELECT id FROM threads WHERE workspace_id = $1 AND client_id = $2', [ws, input.clientId]);
      if (rows[0]) return loadThreadDetail(ctx, rows[0].id, p.userId);
    }
    let n;
    try {
      n = normalizeUrl(input.url);
    } catch {
      throw badRequest('Invalid url', 'validation_error');
    }
    if (!/^https?:$/.test(new URL(n.url).protocol)) throw badRequest('Only http(s) pages can be annotated', 'validation_error');
    const { rows: pageRows } = await ctx.db.query(
      `INSERT INTO pages (workspace_id, site, normalized_url, path, title) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, normalized_url) DO UPDATE SET last_seen_at = now(),
         title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE pages.title END
       RETURNING id`,
      [ws, n.site, n.url, n.path, input.title.slice(0, 500)],
    );
    const pageId = pageRows[0].id;
    if (role === 'guest') {
      const g = await guestScope(ctx, ws, p.userId);
      if (!g.pageIds.includes(pageId)) throw forbidden('Guests can only comment on pages shared with them');
    }
    if (input.assigneeId) {
      if (!can(role, 'assign')) throw forbidden();
      const { rows } = await ctx.db.query('SELECT 1 FROM members WHERE workspace_id = $1 AND user_id = $2', [ws, input.assigneeId]);
      if (!rows[0]) throw badRequest('Assignee must be a workspace member', 'validation_error');
    }
    const { rows: seq } = await ctx.db.query('UPDATE pages SET thread_seq = thread_seq + 1 WHERE id = $1 RETURNING thread_seq', [pageId]);
    const anchor = { ...input.anchor, scope: input.scope, urlMatch: input.urlMatch };
    const o = anchorOrder(anchor);
    let threadId: string;
    try {
      const { rows } = await ctx.db.query(
        `INSERT INTO threads (workspace_id, page_id, number, scope, url_match, anchor, assignee_id, type, priority, order_y, order_x, created_by, client_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [ws, pageId, seq[0].thread_seq, input.scope, input.urlMatch, JSON.stringify(anchor), input.assigneeId ?? null, input.type ?? null, input.priority ?? null, o.y, o.x, p.userId, input.clientId ?? null],
      );
      threadId = rows[0].id;
    } catch (e: any) {
      if (input.clientId && String(e?.message ?? e).includes('duplicate')) {
        const { rows } = await ctx.db.query('SELECT id FROM threads WHERE workspace_id = $1 AND client_id = $2', [ws, input.clientId]);
        return loadThreadDetail(ctx, rows[0].id, p.userId);
      }
      throw e;
    }
    const mentions = await mentionsIn(ctx, ws, input.body);
    const { rows: c } = await ctx.db.query('INSERT INTO comments (thread_id, workspace_id, author_id, body, mentions) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
      threadId,
      ws,
      p.userId,
      input.body,
      JSON.stringify(mentions),
    ]);
    await linkAttachments(ctx, ws, p.userId, c[0].id, input.attachmentIds);
    await markRead(ctx, threadId, p.userId);
    await logActivity(ctx, { workspaceId: ws, threadId, actorId: p.userId, action: 'thread.created', detail: { scope: input.scope } });
    await notify(ctx, { event: 'mention', workspaceId: ws, threadId, commentId: c[0].id, actorId: p.userId, recipientIds: mentions, body: input.body });
    if (input.assigneeId)
      await notify(ctx, { event: 'assignment', workspaceId: ws, threadId, actorId: p.userId, recipientIds: [input.assigneeId].filter((x) => !mentions.includes(x)), body: input.body });
    await emitChange(ctx, 'thread.created', { workspaceId: ws, threadId, pageId, commentId: c[0].id });
    return loadThreadDetail(ctx, threadId, p.userId);
  });

  app.get<{ Params: { id: string } }>('/api/v1/threads/:id', async (req) => {
    const p = await requireAuth(ctx, req);
    await threadAccess(ctx, p, req.params.id);
    return loadThreadDetail(ctx, req.params.id, p.userId);
  });

  app.patch<{ Params: { id: string } }>('/api/v1/threads/:id', async (req) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    const patch = parse(
      z.object({
        status: z.enum(['open', 'resolved']).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        type: threadType.nullable().optional(),
        priority: priority.nullable().optional(),
        scope: scope.optional(),
        anchor: anchorSchema.optional(),
        urlMatch: urlMatch.optional(),
        detached: z.boolean().optional(),
      }),
      req.body,
    );
    await applyThreadPatch(ctx, p, role, thread, patch);
    return loadThreadDetail(ctx, thread.id, p.userId);
  });

  app.delete<{ Params: { id: string } }>('/api/v1/threads/:id', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    await softDeleteThread(ctx, p, role, thread);
    return reply.code(204).send();
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/threads/bulk', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws, 'bulk');
    const input = parse(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        action: z.enum(['resolve', 'reopen', 'assign', 'type', 'priority', 'delete']),
        assigneeId: z.string().uuid().nullable().optional(),
        type: threadType.nullable().optional(),
        priority: priority.nullable().optional(),
      }),
      req.body,
    );
    const { rows } = await ctx.db.query('SELECT * FROM threads WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL', [
      req.params.ws,
      input.ids,
    ]);
    let updated = 0;
    for (const t of rows) {
      switch (input.action) {
        case 'resolve':
          await applyThreadPatch(ctx, p, role, t, { status: 'resolved' });
          break;
        case 'reopen':
          await applyThreadPatch(ctx, p, role, t, { status: 'open' });
          break;
        case 'assign':
          await applyThreadPatch(ctx, p, role, t, { assigneeId: input.assigneeId ?? null });
          break;
        case 'type':
          await applyThreadPatch(ctx, p, role, t, { type: input.type ?? null });
          break;
        case 'priority':
          await applyThreadPatch(ctx, p, role, t, { priority: input.priority ?? null });
          break;
        case 'delete':
          await softDeleteThread(ctx, p, role, t);
          break;
      }
      updated++;
    }
    return { updated };
  });

  app.post<{ Params: { id: string } }>('/api/v1/threads/:id/read', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    const { thread } = await threadAccess(ctx, p, req.params.id);
    await markRead(ctx, thread.id, p.userId);
    await ctx.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND thread_id = $2 AND read_at IS NULL', [p.userId, thread.id]);
    return reply.code(204).send();
  });

  // ---------- comments ----------
  app.post<{ Params: { id: string } }>('/api/v1/threads/:id/comments', async (req) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    if (!can(role, 'comment')) throw forbidden();
    const input = parse(z.object({ body, attachmentIds: z.array(z.string().uuid()).max(10).default([]), clientId: z.string().max(100).optional() }), req.body);
    if (input.clientId) {
      const { rows } = await ctx.db.query('SELECT id FROM comments WHERE thread_id = $1 AND client_id = $2', [thread.id, input.clientId]);
      if (rows[0]) return (await loadComments(ctx, { commentIds: [rows[0].id] }))[0];
    }
    await assertAttachments(ctx, thread.workspace_id, p.userId, input.attachmentIds);
    const before = await participants(ctx, thread);
    const mentions = await mentionsIn(ctx, thread.workspace_id, input.body);
    const { rows } = await ctx.db.query(
      'INSERT INTO comments (thread_id, workspace_id, author_id, body, mentions, client_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [thread.id, thread.workspace_id, p.userId, input.body, JSON.stringify(mentions), input.clientId ?? null],
    );
    const commentId = rows[0].id;
    await linkAttachments(ctx, thread.workspace_id, p.userId, commentId, input.attachmentIds);
    await ctx.db.query('UPDATE threads SET last_activity_at = now() WHERE id = $1', [thread.id]);
    await markRead(ctx, thread.id, p.userId);
    await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'comment.created', detail: { commentId } });
    const common = { workspaceId: thread.workspace_id, threadId: thread.id, commentId, actorId: p.userId, body: input.body };
    await notify(ctx, { ...common, event: 'mention', recipientIds: mentions });
    await notify(ctx, { ...common, event: 'reply', recipientIds: before.filter((u) => !mentions.includes(u)) });
    await emitChange(ctx, 'comment.created', { workspaceId: thread.workspace_id, threadId: thread.id, pageId: thread.page_id, commentId });
    return (await loadComments(ctx, { commentIds: [commentId] }))[0];
  });

  async function commentAccess(req: any, id: string) {
    if (!isUuid(id)) throw notFound('Comment');
    const p = await requireAuth(ctx, req);
    const { rows } = await ctx.db.query('SELECT * FROM comments WHERE id = $1', [id]);
    const c = rows[0];
    if (!c) throw notFound('Comment');
    const { thread, role } = await threadAccess(ctx, p, c.thread_id);
    return { p, c, thread, role };
  }

  app.patch<{ Params: { id: string } }>('/api/v1/comments/:id', async (req) => {
    const { p, c, thread } = await commentAccess(req, req.params.id);
    if (c.author_id !== p.userId) throw forbidden('You can only edit your own comments');
    if (c.deleted_at) throw badRequest('Comment is deleted');
    const input = parse(z.object({ body }), req.body);
    const mentions = await mentionsIn(ctx, thread.workspace_id, input.body);
    await ctx.db.query('INSERT INTO comment_history (comment_id, body, edited_by) VALUES ($1,$2,$3)', [c.id, c.body, p.userId]);
    await ctx.db.query('UPDATE comments SET body = $1, mentions = $2, edited_at = now() WHERE id = $3', [input.body, JSON.stringify(mentions), c.id]);
    await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'comment.edited', detail: { commentId: c.id } });
    const added = mentions.filter((m) => !(c.mentions ?? []).includes(m));
    await notify(ctx, { event: 'mention', workspaceId: thread.workspace_id, threadId: thread.id, commentId: c.id, actorId: p.userId, recipientIds: added, body: input.body });
    await emitChange(ctx, 'comment.updated', { workspaceId: thread.workspace_id, threadId: thread.id, pageId: thread.page_id, commentId: c.id });
    return (await loadComments(ctx, { commentIds: [c.id] }))[0];
  });

  app.delete<{ Params: { id: string } }>('/api/v1/comments/:id', async (req, reply) => {
    const { p, c, thread, role } = await commentAccess(req, req.params.id);
    if (c.author_id !== p.userId && !can(role, 'deleteAny')) throw forbidden('You can only delete your own comments');
    if (!c.deleted_at) {
      await ctx.db.query('UPDATE comments SET deleted_at = now() WHERE id = $1', [c.id]);
      await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'comment.deleted', detail: { commentId: c.id } });
      await emitChange(ctx, 'comment.deleted', { workspaceId: thread.workspace_id, threadId: thread.id, pageId: thread.page_id, commentId: c.id });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/v1/comments/:id/restore', async (req) => {
    const { p, c, thread, role } = await commentAccess(req, req.params.id);
    if (c.author_id !== p.userId && !can(role, 'deleteAny')) throw forbidden();
    if (c.deleted_at) {
      if (Date.now() - new Date(c.deleted_at).getTime() > 30 * 86400 * 1000) throw badRequest('Comments can only be restored within 30 days', 'restore_expired');
      await ctx.db.query('UPDATE comments SET deleted_at = NULL WHERE id = $1', [c.id]);
      await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'comment.restored', detail: { commentId: c.id } });
      await emitChange(ctx, 'comment.updated', { workspaceId: thread.workspace_id, threadId: thread.id, pageId: thread.page_id, commentId: c.id });
    }
    return (await loadComments(ctx, { commentIds: [c.id] }))[0];
  });

  app.post<{ Params: { id: string } }>('/api/v1/comments/:id/reactions', async (req) => {
    const { p, c, thread } = await commentAccess(req, req.params.id);
    if (c.deleted_at) throw badRequest('Comment is deleted');
    const { emoji } = parse(z.object({ emoji: z.string().min(1).max(16) }), req.body);
    const { rowCount } = await ctx.db.query('DELETE FROM reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3', [c.id, p.userId, emoji]);
    if (!rowCount) await ctx.db.query('INSERT INTO reactions (comment_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, p.userId, emoji]);
    await emitChange(ctx, 'comment.updated', { workspaceId: thread.workspace_id, threadId: thread.id, pageId: thread.page_id, commentId: c.id });
    return (await loadComments(ctx, { commentIds: [c.id] }))[0];
  });

  // Ticket links are read here; creation lives in integrations routes.
  app.get<{ Params: { id: string } }>('/api/v1/threads/:id/tickets', async (req) => {
    const p = await requireAuth(ctx, req);
    const { thread } = await threadAccess(ctx, p, req.params.id);
    const { rows } = await ctx.db.query('SELECT * FROM tickets WHERE thread_id = $1 ORDER BY created_at', [thread.id]);
    return rows.map((r) => ({ kind: r.kind, url: r.url, externalId: r.external_id, createdAt: iso(r.created_at) }));
  });
}

async function assertAttachments(ctx: AppCtx, ws: string, userId: string, ids: string[]) {
  if (!ids.length) return;
  const { rows } = await ctx.db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM attachments WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND uploader_id = $3 AND comment_id IS NULL',
    [ids, ws, userId],
  );
  if (rows[0].n !== new Set(ids).size) throw badRequest('Unknown or already used attachment', 'validation_error');
}

async function linkAttachments(ctx: AppCtx, ws: string, userId: string, commentId: string, ids: string[]) {
  if (!ids.length) return;
  const { rowCount } = await ctx.db.query(
    'UPDATE attachments SET comment_id = $1 WHERE id = ANY($2::uuid[]) AND workspace_id = $3 AND uploader_id = $4 AND comment_id IS NULL',
    [commentId, ids, ws, userId],
  );
  if (rowCount !== ids.length) throw badRequest('Unknown or already used attachment', 'validation_error');
}
