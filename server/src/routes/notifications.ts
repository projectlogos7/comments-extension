import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context';
import { requireUser, isUuid } from '../context';
import { usersById } from '../model';
import { toNotification } from '../services/notify';
import { parse, z } from '../validate';

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.get<{ Querystring: { workspaceId?: string; unread?: string; limit?: string } }>('/api/v1/notifications', async (req) => {
    const userId = await requireUser(ctx, req);
    const params: unknown[] = [userId];
    let sql = 'SELECT * FROM notifications WHERE user_id = $1 AND in_app = true';
    if (req.query.workspaceId && isUuid(req.query.workspaceId)) {
      params.push(req.query.workspaceId);
      sql += ` AND workspace_id = $${params.length}`;
    }
    if (req.query.unread === 'true' || req.query.unread === '1') sql += ' AND read_at IS NULL';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
    const { rows } = await ctx.db.query(sql, params);
    const users = await usersById(ctx, rows.map((r) => r.actor_id));
    return rows.map((r) => toNotification(r, users.get(r.actor_id)));
  });

  app.get<{ Querystring: { workspaceId?: string } }>('/api/v1/notifications/counts', async (req) => {
    const userId = await requireUser(ctx, req);
    const params: unknown[] = [userId];
    let extra = '';
    if (req.query.workspaceId && isUuid(req.query.workspaceId)) {
      params.push(req.query.workspaceId);
      extra = ' AND workspace_id = $2';
    }
    const { rows } = await ctx.db.query(
      `SELECT count(*) FILTER (WHERE event = 'mention')::int AS mentions, count(*)::int AS notifications
       FROM notifications WHERE user_id = $1 AND in_app = true AND read_at IS NULL${extra}`,
      params,
    );
    return { mentions: rows[0].mentions, notifications: rows[0].notifications };
  });

  app.post('/api/v1/notifications/read', async (req, reply) => {
    const userId = await requireUser(ctx, req);
    const body = parse(
      z.object({ ids: z.array(z.string().uuid()).max(500).optional(), all: z.boolean().optional(), threadId: z.string().uuid().optional() }),
      req.body,
    );
    if (body.all) await ctx.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
    if (body.ids?.length) await ctx.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL', [userId, body.ids]);
    if (body.threadId) await ctx.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND thread_id = $2 AND read_at IS NULL', [userId, body.threadId]);
    return reply.code(204).send();
  });
}
