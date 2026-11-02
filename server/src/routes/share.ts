import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, threadTitle, type ShareInfo } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { guestScope, isUuid, requireAuth, requireRole, resolvePrincipal, threadAccess } from '../context';
import { randomToken } from '../crypto';
import { forbidden, notFound, unauthorized } from '../errors';
import { iso, loadThreadDetails, shareUrl, toPage } from '../model';
import { logActivity } from '../services/activity';
import { renderNotFoundPage, renderSharePage, renderThreadsHtml, shareDescription, type ShareRender } from '../share-page';
import crypto from 'node:crypto';

const SHARE_SNAPSHOT_TTL = 7 * 24 * 3600;

function toShareInfo(ctx: AppCtx, r: any): ShareInfo {
  return { token: r.token, url: shareUrl(ctx, r.token), kind: r.kind, createdAt: iso(r.created_at) };
}

async function ensureShare(ctx: AppCtx, ws: string, kind: 'thread' | 'page', id: string, userId: string) {
  const col = kind === 'thread' ? 'thread_id' : 'page_id';
  const { rows } = await ctx.db.query(`SELECT * FROM share_links WHERE kind = $1 AND ${col} = $2 AND revoked_at IS NULL`, [kind, id]);
  if (rows[0]) return rows[0];
  const { rows: ins } = await ctx.db.query(
    `INSERT INTO share_links (workspace_id, kind, ${col}, token, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ws, kind, id, randomToken(24), userId],
  );
  return ins[0];
}

type Resolved = { status: 'ok'; view: ShareRender; anonymous: boolean } | { status: 'gone' } | { status: 'auth' } | { status: 'forbidden' };

/** Resolve a share token for the request's principal, enforcing the workspace link setting (FR-4.8). */
async function resolveShare(ctx: AppCtx, req: FastifyRequest, token: string): Promise<Resolved> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { status: 'gone' };
  const { rows } = await ctx.db.query(
    `SELECT s.*, w.name AS ws_name, w.link_sharing FROM share_links s JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.token = $1 AND s.revoked_at IS NULL`,
    [token],
  );
  const s = rows[0];
  if (!s) return { status: 'gone' };
  const anonymous = s.link_sharing === 'anyone';
  const p = await resolvePrincipal(ctx, req);
  let viewer: string | null = null;
  let threadFilter: ((t: { id: string; page_id: string; created_by: string }) => boolean) | null = null;
  if (p) {
    const { roleIn } = await import('../context');
    const role = await roleIn(ctx, p, s.workspace_id);
    if (role) {
      viewer = p.userId;
      if (role === 'guest' && !anonymous) {
        const g = await guestScope(ctx, s.workspace_id, p.userId);
        threadFilter = (t) => g.threadIds.includes(t.id) || g.pageIds.includes(t.page_id) || t.created_by === p.userId;
      }
    } else if (!anonymous) return { status: 'forbidden' };
  } else if (!anonymous) return { status: 'auth' };

  let threadRows: any[];
  let pageId: string;
  if (s.kind === 'thread') {
    const r = await ctx.db.query('SELECT id, page_id, created_by FROM threads WHERE id = $1 AND deleted_at IS NULL', [s.thread_id]);
    if (!r.rows[0]) return { status: 'gone' };
    threadRows = r.rows;
    pageId = r.rows[0].page_id;
  } else {
    const r = await ctx.db.query('SELECT id, page_id, created_by FROM threads WHERE page_id = $1 AND deleted_at IS NULL ORDER BY order_y, order_x, number', [s.page_id]);
    threadRows = r.rows;
    pageId = s.page_id;
  }
  if (threadFilter) {
    threadRows = threadRows.filter(threadFilter);
    if (!threadRows.length) return { status: 'forbidden' };
  }
  const { rows: pages } = await ctx.db.query('SELECT * FROM pages WHERE id = $1', [pageId]);
  if (!pages[0]) return { status: 'gone' };
  const threads = await loadThreadDetails(ctx, threadRows.map((t) => t.id), viewer, { snapshotTtl: SHARE_SNAPSHOT_TTL });
  if (s.kind === 'page') {
    // page order: page comments first, then top-to-bottom
    threads.sort((a, b) => (a.scope === 'page' ? 0 : 1) - (b.scope === 'page' ? 0 : 1));
  }
  return { status: 'ok', anonymous, view: { kind: s.kind, workspaceName: s.ws_name, page: toPage(pages[0]), threads } };
}

export function registerShareRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.post<{ Params: { id: string } }>('/api/v1/threads/:id/share', async (req) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    if (!can(role, 'createShareLink')) throw forbidden();
    const s = await ensureShare(ctx, thread.workspace_id, 'thread', thread.id, p.userId);
    await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'share.created' });
    return toShareInfo(ctx, s);
  });

  app.delete<{ Params: { id: string } }>('/api/v1/threads/:id/share', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    if (!can(role, 'createShareLink')) throw forbidden();
    const { rowCount } = await ctx.db.query(`UPDATE share_links SET revoked_at = now() WHERE kind = 'thread' AND thread_id = $1 AND revoked_at IS NULL`, [thread.id]);
    if (rowCount) await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'share.revoked' });
    return reply.code(204).send();
  });

  async function pageAccess(req: FastifyRequest, id: string) {
    if (!isUuid(id)) throw notFound('Page');
    const p = await requireAuth(ctx, req);
    const { rows } = await ctx.db.query('SELECT * FROM pages WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Page');
    await requireRole(ctx, p, rows[0].workspace_id, 'createShareLink');
    return { p, page: rows[0] };
  }

  app.post<{ Params: { id: string } }>('/api/v1/pages/:id/share', async (req) => {
    const { p, page } = await pageAccess(req, req.params.id);
    return toShareInfo(ctx, await ensureShare(ctx, page.workspace_id, 'page', page.id, p.userId));
  });

  app.delete<{ Params: { id: string } }>('/api/v1/pages/:id/share', async (req, reply) => {
    const { page } = await pageAccess(req, req.params.id);
    await ctx.db.query(`UPDATE share_links SET revoked_at = now() WHERE kind = 'page' AND page_id = $1 AND revoked_at IS NULL`, [page.id]);
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>('/api/v1/share/:token', async (req) => {
    const r = await resolveShare(ctx, req, req.params.token);
    if (r.status === 'gone') throw notFound('Share link');
    if (r.status === 'auth') throw unauthorized('Sign in to view this link');
    if (r.status === 'forbidden') throw forbidden('This link is limited to workspace members');
    return r.view;
  });

  app.get<{ Params: { token: string } }>('/share/:token/content', async (req, reply) => {
    const r = await resolveShare(ctx, req, req.params.token);
    if (r.status === 'gone') return reply.code(404).type('text/plain').send('Not found');
    if (r.status === 'auth') return reply.code(401).type('text/plain').send('Sign in required');
    if (r.status === 'forbidden') return reply.code(403).type('text/plain').send('Forbidden');
    reply.header('cache-control', 'private, no-store');
    return reply.type('text/html; charset=utf-8').send(renderThreadsHtml(r.view, { extensionIds: ctx.cfg.extensionIds }));
  });

  app.get<{ Params: { token: string } }>('/share/:token', async (req, reply) => {
    // Anonymous resolution only: the page itself never depends on cookies, so it is safe to cache privately.
    req.principal = null;
    const r = await resolveShare(ctx, req, req.params.token);
    const nonce = crypto.randomBytes(16).toString('base64');
    reply.header(
      'content-security-policy',
      `default-src 'self'; img-src 'self' data: https: http:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'private, no-store');
    reply.type('text/html; charset=utf-8');
    if (r.status === 'gone') return reply.code(404).send(renderNotFoundPage());
    const providers = { google: !!ctx.cfg.google, microsoft: !!ctx.cfg.microsoft };
    const url = shareUrl(ctx, req.params.token);
    if (r.status === 'ok') {
      const first = r.view.threads[0];
      const area = first?.snapshots.find((s) => s.kind === 'area') ?? first?.snapshots[0];
      return reply.send(
        renderSharePage({
          nonce,
          title: r.view.kind === 'thread' && first ? `#${first.number} ${threadTitle(first)}` : r.view.page.title || r.view.page.normalizedUrl,
          description: shareDescription(first, r.view.threads.length, r.view.kind),
          ogImage: area && area.contentType.startsWith('image/') ? area.url : null,
          url,
          publicUrl: ctx.cfg.publicUrl,
          extensionIds: ctx.cfg.extensionIds,
          contentHtml: renderThreadsHtml(r.view, { extensionIds: ctx.cfg.extensionIds }),
          token: req.params.token,
          providers,
        }),
      );
    }
    // Members-only link: generic metadata (never leak content), content fetched with the viewer's session.
    return reply.send(
      renderSharePage({
        nonce,
        title: 'Pinpoint thread',
        description: 'A Pinpoint comment thread shared with workspace members.',
        ogImage: null,
        url,
        publicUrl: ctx.cfg.publicUrl,
        extensionIds: ctx.cfg.extensionIds,
        contentHtml: null,
        token: req.params.token,
        providers,
      }),
    );
  });
}
