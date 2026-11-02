import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context';
import { isUuid, requireAuth, requireRole } from '../context';
import { forbidden, notFound } from '../errors';
import { iso } from '../model';
import { parse, z } from '../validate';
import { can } from '@pinpoint/shared';

const sort = z.enum(['activity', 'oldest', 'page', 'priority']);
const filters = z.record(z.union([z.string().max(300), z.boolean(), z.number()])).refine((f) => Object.keys(f).length <= 30);

function toView(r: any) {
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, filters: r.filters, sort: r.sort, shared: r.shared, createdBy: r.created_by, createdAt: iso(r.created_at) };
}

export function registerViewRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/views', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws);
    const { rows } = await ctx.db.query('SELECT * FROM saved_views WHERE workspace_id = $1 AND (shared = true OR created_by = $2) ORDER BY name', [
      req.params.ws,
      p.userId,
    ]);
    return rows.map(toView);
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/views', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    const body = parse(z.object({ name: z.string().trim().min(1).max(100), filters: filters.default({}), sort: sort.default('activity'), shared: z.boolean().default(false) }), req.body);
    if (body.shared && role === 'guest') throw forbidden();
    const { rows } = await ctx.db.query('INSERT INTO saved_views (workspace_id, name, filters, sort, shared, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [
      req.params.ws,
      body.name,
      JSON.stringify(body.filters),
      body.sort,
      body.shared,
      p.userId,
    ]);
    return toView(rows[0]);
  });

  async function own(req: any, ws: string, id: string) {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, ws);
    if (!isUuid(id)) throw notFound('View');
    const { rows } = await ctx.db.query('SELECT * FROM saved_views WHERE id = $1 AND workspace_id = $2', [id, ws]);
    const v = rows[0];
    if (!v || (!v.shared && v.created_by !== p.userId)) throw notFound('View');
    if (v.created_by !== p.userId && !can(role, 'deleteAny')) throw forbidden('Only the creator or an admin can change this view');
    return v;
  }

  app.patch<{ Params: { ws: string; id: string } }>('/api/v1/workspaces/:ws/views/:id', async (req) => {
    const v = await own(req, req.params.ws, req.params.id);
    const body = parse(z.object({ name: z.string().trim().min(1).max(100).optional(), filters: filters.optional(), sort: sort.optional(), shared: z.boolean().optional() }), req.body);
    const { rows } = await ctx.db.query('UPDATE saved_views SET name = $1, filters = $2, sort = $3, shared = $4 WHERE id = $5 RETURNING *', [
      body.name ?? v.name,
      JSON.stringify(body.filters ?? v.filters),
      body.sort ?? v.sort,
      body.shared ?? v.shared,
      v.id,
    ]);
    return toView(rows[0]);
  });

  app.delete<{ Params: { ws: string; id: string } }>('/api/v1/workspaces/:ws/views/:id', async (req, reply) => {
    const v = await own(req, req.params.ws, req.params.id);
    await ctx.db.query('DELETE FROM saved_views WHERE id = $1', [v.id]);
    return reply.code(204).send();
  });
}
