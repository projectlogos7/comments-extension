import type { FastifyInstance } from 'fastify';
import { can, type IntegrationKind, type WebhookEvent } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { isUuid, requireAuth, requireRole, threadAccess } from '../context';
import { randomToken, sha256 } from '../crypto';
import { badRequest, forbidden, notFound } from '../errors';
import { iso, loadThreadDetail } from '../model';
import { chatSummary, createTicket, getIntegration, INTEGRATION_KINDS, mergeSettings, postChatMessage, toIntegration } from '../services/integrations';
import { parse, z } from '../validate';

const WEBHOOK_EVENTS: WebhookEvent[] = ['thread.created', 'thread.updated', 'thread.deleted', 'comment.created', 'comment.updated', 'comment.deleted'];

export function registerIntegrationRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/integrations', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    const { rows } = await ctx.db.query('SELECT * FROM integrations WHERE workspace_id = $1', [req.params.ws]);
    return INTEGRATION_KINDS.map((k) => toIntegration(k, rows.find((r) => r.kind === k)));
  });

  app.put<{ Params: { ws: string; kind: string } }>('/api/v1/workspaces/:ws/integrations/:kind', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    const kind = req.params.kind as IntegrationKind;
    if (!INTEGRATION_KINDS.includes(kind)) throw notFound('Integration');
    const body = parse(z.object({ enabled: z.boolean(), settings: z.record(z.string().max(2000)).default({}) }), req.body);
    const prev = await getIntegration(ctx, req.params.ws, kind);
    const settings = mergeSettings(kind, prev?.settings ?? {}, body.settings, body.enabled);
    const { rows } = await ctx.db.query(
      `INSERT INTO integrations (workspace_id, kind, enabled, settings) VALUES ($1,$2,$3,$4)
       ON CONFLICT (workspace_id, kind) DO UPDATE SET enabled = EXCLUDED.enabled, settings = EXCLUDED.settings, updated_at = now() RETURNING *`,
      [req.params.ws, kind, body.enabled, JSON.stringify(settings)],
    );
    return toIntegration(kind, rows[0]);
  });

  app.post<{ Params: { id: string } }>('/api/v1/threads/:id/tickets', async (req) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    if (!can(role, 'export')) throw forbidden();
    const { kind } = parse(z.object({ kind: z.enum(['linear', 'jira', 'github']) }), req.body);
    const detail = await loadThreadDetail(ctx, thread.id, p.userId);
    const t = await createTicket(ctx, kind, detail);
    const { rows } = await ctx.db.query('INSERT INTO tickets (thread_id, kind, url, external_id) VALUES ($1,$2,$3,$4) RETURNING *', [thread.id, kind, t.url, t.externalId]);
    return { kind, url: rows[0].url, externalId: rows[0].external_id, createdAt: iso(rows[0].created_at) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/threads/:id/post', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    if (!can(role, 'export')) throw forbidden();
    const { kind } = parse(z.object({ kind: z.enum(['slack', 'teams']) }), req.body);
    const detail = await loadThreadDetail(ctx, thread.id, p.userId);
    await postChatMessage(ctx, thread.workspace_id, kind, chatSummary(ctx, detail), { required: true });
    return reply.code(204).send();
  });

  // ---------- API keys (FR-6.7) ----------
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/api-keys', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    const { rows } = await ctx.db.query('SELECT * FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC', [req.params.ws]);
    return rows.map(toKey);
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/api-keys', async (req) => {
    const p = await requireAuth(ctx, req);
    if (p.kind !== 'user') throw forbidden('API keys cannot create API keys');
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);
    const key = `pk_${prefix}_${randomToken(24)}`;
    const { rows } = await ctx.db.query('INSERT INTO api_keys (workspace_id, name, prefix, key_hash, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [
      req.params.ws,
      name,
      prefix,
      sha256(key),
      p.userId,
    ]);
    return { ...toKey(rows[0]), key };
  });

  app.delete<{ Params: { ws: string; id: string } }>('/api/v1/workspaces/:ws/api-keys/:id', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    if (!isUuid(req.params.id)) throw notFound('API key');
    await ctx.db.query('DELETE FROM api_keys WHERE id = $1 AND workspace_id = $2', [req.params.id, req.params.ws]);
    return reply.code(204).send();
  });

  // ---------- webhooks ----------
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/webhooks', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    const { rows } = await ctx.db.query('SELECT * FROM webhooks WHERE workspace_id = $1 ORDER BY created_at DESC', [req.params.ws]);
    return rows.map((r) => toHook(r));
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/webhooks', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    const body = parse(z.object({ url: z.string().url().max(2000), events: z.array(z.enum(WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]])).min(1) }), req.body);
    const u = new URL(body.url);
    if (u.protocol !== 'https:' && !(ctx.cfg.devLogin && u.protocol === 'http:')) throw badRequest('Webhook URL must use https', 'validation_error');
    const secret = 'whsec_' + randomToken(24);
    const { rows } = await ctx.db.query('INSERT INTO webhooks (workspace_id, url, events, secret) VALUES ($1,$2,$3,$4) RETURNING *', [
      req.params.ws,
      body.url,
      JSON.stringify([...new Set(body.events)]),
      secret,
    ]);
    return toHook(rows[0], true);
  });

  app.delete<{ Params: { ws: string; id: string } }>('/api/v1/workspaces/:ws/webhooks/:id', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageIntegrations');
    if (!isUuid(req.params.id)) throw notFound('Webhook');
    await ctx.db.query('DELETE FROM webhooks WHERE id = $1 AND workspace_id = $2', [req.params.id, req.params.ws]);
    return reply.code(204).send();
  });
}

function toKey(r: any) {
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, prefix: `pk_${r.prefix}_…`, createdAt: iso(r.created_at), lastUsedAt: r.last_used_at ? iso(r.last_used_at) : null };
}

function toHook(r: any, withSecret = false) {
  return { id: r.id, workspaceId: r.workspace_id, url: r.url, events: r.events, active: r.active, createdAt: iso(r.created_at), ...(withSecret ? { secret: r.secret } : {}) };
}
