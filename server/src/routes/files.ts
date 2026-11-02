import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { requireAuth, requireRole, threadAccess } from '../context';
import { AppError, badRequest, forbidden, notFound } from '../errors';
import { toAttachment, toSnapshot } from '../model';
import { logActivity } from '../services/activity';
import { emitChange } from '../services/events';
import { extFromMime, verifyFileSig } from '../storage';
import { randomUUID } from 'node:crypto';

export const ATTACHMENT_MAX = 5 * 1024 * 1024;
export const SNAPSHOT_MAX = 25 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

async function readMultipart(req: FastifyRequest, maxBytes: number) {
  const fields: Record<string, string> = {};
  let file: { buffer: Buffer; mimetype: string; filename: string } | null = null;
  for await (const part of (req as any).parts({ limits: { fileSize: maxBytes, files: 1 } })) {
    if (part.type === 'file') {
      const buffer: Buffer = await part.toBuffer();
      if (part.file.truncated) throw new AppError(413, 'file_too_large', `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
      file = { buffer, mimetype: part.mimetype, filename: part.filename };
    } else fields[part.fieldname] = String(part.value);
  }
  return { fields, file };
}

/** Very small magic-number check so a renamed file cannot pose as an image. */
function sniffImage(buf: Buffer): string | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (sniffImage(buf) !== 'image/png') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function registerFileRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.post<{ Params: { id: string } }>('/api/v1/threads/:id/snapshots', async (req) => {
    const p = await requireAuth(ctx, req);
    const { thread, role } = await threadAccess(ctx, p, req.params.id);
    if (thread.created_by !== p.userId && !can(role, 'deleteAny')) throw forbidden('Only the thread author can add snapshots');
    const { fields, file } = await readMultipart(req, SNAPSHOT_MAX);
    if (!file) throw badRequest('file is required', 'validation_error');
    const kind = fields.kind;
    if (!['area', 'viewport', 'fullpage', 'dom'].includes(kind)) throw badRequest('Invalid kind', 'validation_error');
    const { rows: ws } = await ctx.db.query('SELECT privacy FROM workspaces WHERE id = $1', [thread.workspace_id]);
    const privacy = { allowFullPage: true, allowDom: true, ...(ws[0].privacy ?? {}) };
    if (kind === 'fullpage' && !privacy.allowFullPage) throw forbidden('Full-page snapshots are disabled for this workspace');
    if (kind === 'dom' && !privacy.allowDom) throw forbidden('DOM snapshots are disabled for this workspace');
    let contentType: string;
    if (kind === 'dom') {
      contentType = 'text/html; charset=utf-8';
      if (file.buffer.length > 5 * 1024 * 1024) throw new AppError(413, 'file_too_large', 'DOM snapshot too large');
    } else {
      const sniffed = sniffImage(file.buffer);
      if (!sniffed || !['image/png', 'image/jpeg', 'image/webp'].includes(sniffed)) throw badRequest('Snapshot must be a PNG, JPEG or WebP image', 'validation_error');
      contentType = sniffed;
    }
    let context: any;
    try {
      context = JSON.parse(fields.context || '{}');
    } catch {
      throw badRequest('context must be JSON', 'validation_error');
    }
    if (typeof context !== 'object' || JSON.stringify(context).length > 8000) throw badRequest('Invalid context', 'validation_error');
    const size = pngSize(file.buffer);
    const width = Number(fields.width) || size?.w || null;
    const height = Number(fields.height) || size?.h || null;
    const key = `ws/${thread.workspace_id}/snap/${randomUUID()}.${extFromMime(contentType)}`;
    await ctx.storage.put(key, file.buffer, contentType);
    const { rows: prev } = await ctx.db.query(
      'UPDATE snapshots SET replaced_at = now() WHERE thread_id = $1 AND kind = $2 AND replaced_at IS NULL RETURNING id',
      [thread.id, kind],
    );
    const { rows } = await ctx.db.query(
      `INSERT INTO snapshots (thread_id, workspace_id, kind, storage_key, content_type, width, height, context, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now())) RETURNING *`,
      [thread.id, thread.workspace_id, kind, key, contentType, width, height, JSON.stringify(context), Number.isNaN(Date.parse(context.capturedAt)) ? null : context.capturedAt],
    );
    if (prev.length) await logActivity(ctx, { workspaceId: thread.workspace_id, threadId: thread.id, actorId: p.userId, action: 'snapshot.replaced', detail: { kind } });
    await emitChange(ctx, 'thread.updated', { workspaceId: thread.workspace_id, threadId: thread.id, pageId: thread.page_id });
    return toSnapshot(ctx, rows[0]);
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/attachments', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'comment');
    const { file } = await readMultipart(req, ATTACHMENT_MAX);
    if (!file) throw badRequest('file is required', 'validation_error');
    const type = sniffImage(file.buffer);
    if (!type || !IMAGE_TYPES.includes(type)) throw badRequest('Attachments must be images (PNG, JPEG, GIF, WebP)', 'validation_error');
    const key = `ws/${req.params.ws}/att/${randomUUID()}.${extFromMime(type)}`;
    await ctx.storage.put(key, file.buffer, type);
    const { rows } = await ctx.db.query(
      'INSERT INTO attachments (workspace_id, uploader_id, storage_key, name, content_type, size) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.ws, p.userId, key, (file.filename || 'image').slice(0, 200), type, file.buffer.length],
    );
    return toAttachment(ctx, rows[0]);
  });

  app.get<{ Params: { '*': string }; Querystring: { exp?: string; sig?: string } }>('/files/*', async (req, reply) => {
    const key = req.params['*'];
    if (!key || key.includes('..') || !verifyFileSig(ctx.cfg, key, req.query.exp ?? '', req.query.sig ?? '')) throw notFound('File');
    const f = await ctx.storage.get(key);
    if (!f) throw notFound('File');
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('x-content-type-options', 'nosniff');
    if (f.contentType.includes('html')) {
      // DOM snapshots are untrusted page HTML: serve sandboxed, never executable.
      reply.header('content-security-policy', "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'");
      reply.header('content-disposition', 'inline; filename="dom-snapshot.html"');
    }
    return reply.type(f.contentType).send(f.body);
  });
}
