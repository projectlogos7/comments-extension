import type { FastifyInstance } from 'fastify';
import { can, threadsToCsv, threadsToJson, threadsToMarkdown, type ThreadSort } from '@pinpoint/shared';
import type { AppCtx, Principal } from '../context';
import { requireAuth, requireRole, resolvePrincipal } from '../context';
import { signJwt, verifyJwt } from '../crypto';
import { badRequest, forbidden, unauthorized } from '../errors';
import { loadThreadDetails, shareUrl, threadWebUrl } from '../model';
import { renderPdf } from '../services/pdf';
import { buildThreadQuery, queryThreadIds } from '../services/threads';

const MAX_EXPORT = 2000;

export function registerExportRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/export-token', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'export');
    const token = signJwt({ typ: 'download', ws: req.params.ws, sub: p.userId, ak: p.kind === 'apikey' ? p.keyId : undefined }, ctx.cfg.jwtSecret, 300);
    return { token };
  });

  app.get<{ Params: { ws: string }; Querystring: Record<string, string> }>('/api/v1/workspaces/:ws/export', async (req, reply) => {
    const { format, dt, ids, sort, cursor: _c, limit: _l, ...filters } = req.query;
    let p: Principal | null = await resolvePrincipal(ctx, req);
    if (!p && dt) {
      const d = verifyJwt<{ typ: string; ws: string; sub: string; ak?: string }>(dt, ctx.cfg.jwtSecret);
      if (d && d.typ === 'download' && d.ws === req.params.ws)
        p = d.ak ? { kind: 'apikey', userId: d.sub, workspaceId: d.ws, keyId: d.ak } : { kind: 'user', userId: d.sub };
    }
    if (!p) throw unauthorized();
    const role = await requireRole(ctx, p, req.params.ws, 'export');
    if (!can(role, 'export')) throw forbidden();
    if (!['md', 'csv', 'json', 'pdf'].includes(format)) throw badRequest('format must be md, csv, json or pdf', 'validation_error');
    const q = await buildThreadQuery(ctx, p, role, req.params.ws, filters, (sort as ThreadSort) || 'page');
    if (ids) {
      const list = ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_EXPORT);
      q.params.push(list);
      q.where += ` AND t.id = ANY($${q.params.length}::uuid[])`;
    }
    const { ids: threadIds } = await queryThreadIds(ctx, q, MAX_EXPORT, 0);
    const threads = await loadThreadDetails(ctx, threadIds, p.userId, { snapshotTtl: 30 * 86400 });
    const link = (t: { id: string; shareToken: string | null }) => (t.shareToken ? shareUrl(ctx, t.shareToken) : threadWebUrl(ctx, t.id));
    const ectx = { shareUrl: link };
    const { rows: ws } = await ctx.db.query('SELECT name FROM workspaces WHERE id = $1', [req.params.ws]);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `pinpoint-${ws[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'}-${stamp}`;
    reply.header('cache-control', 'no-store');
    switch (format) {
      case 'md':
        reply.header('content-disposition', `attachment; filename="${base}.md"`);
        return reply.type('text/markdown; charset=utf-8').send(threadsToMarkdown(threads, ectx, `${ws[0].name} — Pinpoint export`));
      case 'csv':
        reply.header('content-disposition', `attachment; filename="${base}.csv"`);
        return reply.type('text/csv; charset=utf-8').send('﻿' + threadsToCsv(threads, ectx));
      case 'json':
        reply.header('content-disposition', `attachment; filename="${base}.json"`);
        return reply.type('application/json; charset=utf-8').send(threadsToJson(threads, ectx));
      default: {
        const snapIds = threads.flatMap((t) => t.snapshots.map((s) => s.id));
        const { rows } = snapIds.length
          ? await ctx.db.query('SELECT id, storage_key FROM snapshots WHERE id = ANY($1::uuid[])', [snapIds])
          : { rows: [] as any[] };
        const keyBy = new Map(rows.map((r) => [r.id, r.storage_key]));
        const pdf = await renderPdf({
          title: `${ws[0].name} feedback report`,
          workspaceName: ws[0].name,
          threads,
          linkFor: link,
          image: async (id) => {
            const key = keyBy.get(id);
            return key ? (await ctx.storage.get(key))?.body ?? null : null;
          },
        });
        reply.header('content-disposition', `attachment; filename="${base}.pdf"`);
        return reply.type('application/pdf').send(pdf);
      }
    }
  });
}
