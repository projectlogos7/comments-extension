import type { FastifyRequest } from 'fastify';
import type { Role } from '@pinpoint/shared';
import { can, type Action } from '@pinpoint/shared';
import type { Config } from './config';
import type { Db } from './db';
import type { Storage } from './storage';
import type { Mailer } from './mail';
import type { Bus } from './bus';
import { forbidden, notFound, unauthorized } from './errors';
import { sha256, verifyJwt } from './crypto';

export interface AppCtx {
  cfg: Config;
  db: Db;
  storage: Storage;
  mailer: Mailer;
  bus: Bus;
  log: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
  /** Outgoing HTTP (webhooks, integrations). Overridable in tests. */
  fetch: typeof fetch;
}

export type Principal =
  | { kind: 'user'; userId: string }
  | { kind: 'apikey'; userId: string; workspaceId: string; keyId: string };

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal | null;
  }
}

export async function resolvePrincipal(app: AppCtx, req: FastifyRequest): Promise<Principal | null> {
  if (req.principal !== undefined) return req.principal;
  const h = req.headers.authorization ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  let p: Principal | null = null;
  if (m) p = await principalFromToken(app, m[1].trim());
  req.principal = p;
  return p;
}

export async function principalFromToken(app: AppCtx, token: string): Promise<Principal | null> {
  if (token.startsWith('pk_')) {
    const { rows } = await app.db.query<{ id: string; workspace_id: string; created_by: string }>(
      'UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 RETURNING id, workspace_id, created_by',
      [sha256(token)],
    );
    if (!rows[0]) return null;
    return { kind: 'apikey', userId: rows[0].created_by, workspaceId: rows[0].workspace_id, keyId: rows[0].id };
  }
  const payload = verifyJwt<{ sub: string; typ: string }>(token, app.cfg.jwtSecret);
  if (!payload || payload.typ !== 'access') return null;
  const { rows } = await app.db.query('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
  if (!rows[0]) return null;
  return { kind: 'user', userId: payload.sub };
}

export async function requireAuth(app: AppCtx, req: FastifyRequest): Promise<Principal> {
  const p = await resolvePrincipal(app, req);
  if (!p) throw unauthorized();
  return p;
}

/** Only real users (not API keys) — for account-level endpoints. */
export async function requireUser(app: AppCtx, req: FastifyRequest): Promise<string> {
  const p = await requireAuth(app, req);
  if (p.kind !== 'user') throw forbidden('This endpoint requires a user session');
  return p.userId;
}

export async function roleIn(app: AppCtx, p: Principal, workspaceId: string): Promise<Role | null> {
  if (p.kind === 'apikey') return p.workspaceId === workspaceId ? 'admin' : null;
  const { rows } = await app.db.query<{ role: Role }>('SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, p.userId]);
  return rows[0]?.role ?? null;
}

/** Throws 404 when not a member (do not reveal workspace existence), 403 when the role lacks `action`. */
export async function requireRole(app: AppCtx, p: Principal, workspaceId: string, action?: Action): Promise<Role> {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw notFound('Workspace');
  const role = await roleIn(app, p, workspaceId);
  if (!role) throw notFound('Workspace');
  if (action && !can(role, action)) throw forbidden();
  return role;
}

export interface GuestScope {
  threadIds: string[];
  pageIds: string[];
}

export async function guestScope(app: AppCtx, workspaceId: string, userId: string): Promise<GuestScope> {
  const { rows } = await app.db.query<{ thread_ids: string[]; page_ids: string[] }>(
    `SELECT g.thread_ids, g.page_ids FROM guest_access a JOIN guest_grants g ON g.id = a.grant_id
     WHERE a.workspace_id = $1 AND a.user_id = $2 AND g.revoked_at IS NULL`,
    [workspaceId, userId],
  );
  const threadIds = new Set<string>();
  const pageIds = new Set<string>();
  for (const r of rows) {
    r.thread_ids.forEach((x) => threadIds.add(x));
    r.page_ids.forEach((x) => pageIds.add(x));
  }
  return { threadIds: [...threadIds], pageIds: [...pageIds] };
}

export interface ThreadAccess {
  thread: any;
  role: Role;
}

/** Load a non-deleted thread the principal can see; 404 otherwise. */
export async function threadAccess(app: AppCtx, p: Principal, threadId: string): Promise<ThreadAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) throw notFound('Thread');
  const { rows } = await app.db.query('SELECT * FROM threads WHERE id = $1 AND deleted_at IS NULL', [threadId]);
  const t = rows[0];
  if (!t) throw notFound('Thread');
  const role = await roleIn(app, p, t.workspace_id);
  if (!role) throw notFound('Thread');
  if (role === 'guest' && t.created_by !== p.userId) {
    const g = await guestScope(app, t.workspace_id, p.userId);
    if (!g.threadIds.includes(t.id) && !g.pageIds.includes(t.page_id)) throw notFound('Thread');
  }
  return { thread: t, role };
}

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
