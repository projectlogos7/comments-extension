import type { FastifyInstance } from 'fastify';
import { can, canChangeRole, normalizeSitePattern, type Membership, type Role } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { requireAuth, requireRole, requireUser, isUuid } from '../context';
import { randomToken } from '../crypto';
import { AppError, badRequest, forbidden, notFound } from '../errors';
import { emailLayout } from '../mail';
import { iso, loadMember, loadMembers, toWorkspace } from '../model';
import { listActivity } from '../services/activity';
import { domainOf, joinWorkspace } from '../services/membership';
import { normalizeEmail } from '../services/auth';
import { parse, z } from '../validate';
import { deleteWorkspaceData } from './auth';

const roleSchema = z.enum(['owner', 'admin', 'member', 'guest']);

const prefsSchema = z.object({
  events: z.object(
    Object.fromEntries(
      ['mention', 'reply', 'assignment', 'resolution'].map((k) => [k, z.object({ inApp: z.boolean(), email: z.boolean(), chat: z.boolean() })]),
    ) as any,
  ),
  emailMode: z.enum(['immediate', 'digest']),
});

async function workspaceRow(ctx: AppCtx, id: string) {
  const { rows } = await ctx.db.query('SELECT * FROM workspaces WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Workspace');
  return rows[0];
}

async function membershipFor(ctx: AppCtx, workspaceId: string, userId: string): Promise<Membership> {
  const ws = await workspaceRow(ctx, workspaceId);
  const { rows } = await ctx.db.query('SELECT id FROM members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  const member = await loadMember(ctx, rows[0].id);
  return { workspace: toWorkspace(ws, member!.role === 'owner' || member!.role === 'admin'), member: member! };
}

function inviteUrl(ctx: AppCtx, token: string) {
  return `${ctx.cfg.publicUrl}/app/#/invite/${token}`;
}

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.post('/api/v1/workspaces', async (req) => {
    const userId = await requireUser(ctx, req);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    const { rows } = await ctx.db.query('INSERT INTO workspaces (name, invite_token) VALUES ($1, $2) RETURNING id', [name, 'lnk_' + randomToken(18)]);
    const { rows: u } = await ctx.db.query('SELECT email FROM users WHERE id = $1', [userId]);
    await joinWorkspace(ctx, { workspaceId: rows[0].id, userId, role: 'owner', email: u[0].email, enforceDomain: false });
    return membershipFor(ctx, rows[0].id, userId);
  });

  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    return toWorkspace(await workspaceRow(ctx, req.params.ws), can(role, 'manageMembers'));
  });

  app.patch<{ Params: { ws: string } }>('/api/v1/workspaces/:ws', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        allowedSites: z.array(z.string().max(253)).max(200).optional(),
        linkSharing: z.enum(['members', 'anyone']).optional(),
        emailDomain: z.string().trim().max(253).nullable().optional(),
        privacy: z
          .object({
            allowFullPage: z.boolean().optional(),
            allowDom: z.boolean().optional(),
            requireBlurReview: z.boolean().optional(),
            snapshotRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
          })
          .optional(),
      }),
      req.body,
    );
    const need = (ok: boolean) => {
      if (!ok) throw forbidden();
    };
    const ws = await workspaceRow(ctx, req.params.ws);
    if (body.name !== undefined) {
      need(can(role, 'manageMembers'));
      await ctx.db.query('UPDATE workspaces SET name = $1 WHERE id = $2', [body.name, ws.id]);
    }
    if (body.allowedSites !== undefined) {
      need(can(role, 'manageSites'));
      const sites = [...new Set(body.allowedSites.map(normalizeSitePattern).filter(Boolean))];
      for (const s of sites) if (!/^(\*\.)?[a-z0-9.-]+(:\d+)?$/.test(s)) throw badRequest(`Invalid site: ${s}`, 'validation_error');
      await ctx.db.query('UPDATE workspaces SET allowed_sites = $1 WHERE id = $2', [JSON.stringify(sites), ws.id]);
    }
    if (body.linkSharing !== undefined) {
      need(can(role, 'manageSharing'));
      await ctx.db.query('UPDATE workspaces SET link_sharing = $1 WHERE id = $2', [body.linkSharing, ws.id]);
    }
    if (body.emailDomain !== undefined) {
      need(can(role, 'manageMembers'));
      const d = body.emailDomain ? body.emailDomain.toLowerCase().replace(/^@/, '') : null;
      if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw badRequest('Invalid email domain', 'validation_error');
      await ctx.db.query('UPDATE workspaces SET email_domain = $1 WHERE id = $2', [d, ws.id]);
    }
    if (body.privacy !== undefined) {
      need(can(role, 'manageSharing'));
      const merged = { ...(ws.privacy ?? {}), ...body.privacy };
      await ctx.db.query('UPDATE workspaces SET privacy = $1 WHERE id = $2', [JSON.stringify(merged), ws.id]);
    }
    ctx.bus.publish({ kind: 'workspace.updated', workspaceId: ws.id });
    return toWorkspace(await workspaceRow(ctx, ws.id), true);
  });

  app.delete<{ Params: { ws: string } }>('/api/v1/workspaces/:ws', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    if (p.kind !== 'user') throw forbidden();
    await requireRole(ctx, p, req.params.ws, 'deleteWorkspace');
    await deleteWorkspaceData(ctx, req.params.ws);
    return reply.code(204).send();
  });

  // ---------- members ----------
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/members', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws);
    return loadMembers(ctx, req.params.ws);
  });

  app.patch<{ Params: { ws: string; memberId: string } }>('/api/v1/workspaces/:ws/members/:memberId', async (req) => {
    const p = await requireAuth(ctx, req);
    const actorRole = await requireRole(ctx, p, req.params.ws, 'manageMembers');
    const { role } = parse(z.object({ role: roleSchema }), req.body);
    if (!isUuid(req.params.memberId)) throw notFound('Member');
    const { rows } = await ctx.db.query('SELECT * FROM members WHERE id = $1 AND workspace_id = $2', [req.params.memberId, req.params.ws]);
    const target = rows[0];
    if (!target) throw notFound('Member');
    if (!canChangeRole(actorRole, target.role, role)) throw forbidden();
    if (target.role === 'owner' && role !== 'owner') await assertAnotherOwner(ctx, req.params.ws, target.id);
    await ctx.db.query('UPDATE members SET role = $1 WHERE id = $2', [role, target.id]);
    ctx.bus.publish({ kind: 'workspace.updated', workspaceId: req.params.ws });
    return loadMember(ctx, target.id);
  });

  app.delete<{ Params: { ws: string; memberId: string } }>('/api/v1/workspaces/:ws/members/:memberId', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    const actorRole = await requireRole(ctx, p, req.params.ws);
    if (!isUuid(req.params.memberId)) throw notFound('Member');
    const { rows } = await ctx.db.query('SELECT * FROM members WHERE id = $1 AND workspace_id = $2', [req.params.memberId, req.params.ws]);
    const target = rows[0];
    if (!target) throw notFound('Member');
    const self = p.kind === 'user' && target.user_id === p.userId;
    if (!self) {
      if (!can(actorRole, 'manageMembers')) throw forbidden();
      if (target.role === 'owner' && actorRole !== 'owner') throw forbidden();
    }
    if (target.role === 'owner') await assertAnotherOwner(ctx, req.params.ws, target.id);
    await ctx.db.query('DELETE FROM members WHERE id = $1', [target.id]);
    await ctx.db.query('DELETE FROM guest_access WHERE workspace_id = $1 AND user_id = $2', [req.params.ws, target.user_id]);
    ctx.bus.publish({ kind: 'workspace.updated', workspaceId: req.params.ws });
    return reply.code(204).send();
  });

  app.put<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/me/preferences', async (req) => {
    const userId = await requireUser(ctx, req);
    await requireRole(ctx, { kind: 'user', userId }, req.params.ws);
    const prefs = parse(prefsSchema, req.body);
    const { rows } = await ctx.db.query('UPDATE members SET notification_prefs = $1 WHERE workspace_id = $2 AND user_id = $3 RETURNING id', [
      JSON.stringify(prefs),
      req.params.ws,
      userId,
    ]);
    return loadMember(ctx, rows[0].id);
  });

  // ---------- invites ----------
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/invites', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    const { rows } = await ctx.db.query('SELECT * FROM invites WHERE workspace_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC', [req.params.ws]);
    return rows.map(toInvite);
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/invites', async (req) => {
    const p = await requireAuth(ctx, req);
    const actorRole = await requireRole(ctx, p, req.params.ws, 'manageMembers');
    const body = parse(z.object({ emails: z.array(z.string().email()).min(1).max(50), role: roleSchema.default('member') }), req.body);
    if (body.role === 'owner' && actorRole !== 'owner') throw forbidden('Only owners can invite owners');
    const ws = await workspaceRow(ctx, req.params.ws);
    const { rows: inviter } = await ctx.db.query('SELECT name FROM users WHERE id = $1', [p.userId]);
    const out = [];
    for (const raw of body.emails) {
      const email = normalizeEmail(raw);
      if (body.role !== 'guest' && ws.email_domain && domainOf(email) !== ws.email_domain) {
        throw badRequest(`${email} is outside the allowed domain @${ws.email_domain}`, 'domain_restricted');
      }
      const token = 'inv_' + randomToken(24);
      await ctx.db.query(`UPDATE invites SET revoked_at = now() WHERE workspace_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, [
        ws.id,
        email,
      ]);
      const { rows } = await ctx.db.query(
        'INSERT INTO invites (workspace_id, email, role, token, invited_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [ws.id, email, body.role, token, p.userId],
      );
      out.push(toInvite(rows[0]));
      const url = inviteUrl(ctx, token);
      const who = inviter[0]?.name || 'A teammate';
      await ctx.mailer.send({
        to: email,
        subject: `${who} invited you to ${ws.name} on Pinpoint`,
        text: `${who} invited you to join the "${ws.name}" workspace on Pinpoint.\n\nAccept: ${url}`,
        html: emailLayout(`Join ${ws.name} on Pinpoint`, `<p>${who} invited you to comment on web pages with the ${ws.name} team.</p>`, {
          label: 'Accept invitation',
          url,
        }),
      });
    }
    return out;
  });

  app.delete<{ Params: { ws: string; id: string } }>('/api/v1/workspaces/:ws/invites/:id', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    if (!isUuid(req.params.id)) throw notFound('Invite');
    await ctx.db.query('UPDATE invites SET revoked_at = now() WHERE id = $1 AND workspace_id = $2', [req.params.id, req.params.ws]);
    return reply.code(204).send();
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/invite-link', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    const token = 'lnk_' + randomToken(18);
    await ctx.db.query('UPDATE workspaces SET invite_token = $1 WHERE id = $2', [token, req.params.ws]);
    return { token, url: inviteUrl(ctx, token) };
  });

  app.delete<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/invite-link', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    await ctx.db.query('UPDATE workspaces SET invite_token = NULL WHERE id = $1', [req.params.ws]);
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>('/api/v1/invites/:token', async (req) => {
    const inv = await findInvite(ctx, req.params.token);
    return { workspaceName: inv.workspaceName, role: inv.role, kind: inv.kind };
  });

  app.post<{ Params: { token: string } }>('/api/v1/invites/:token/accept', async (req) => {
    const userId = await requireUser(ctx, req);
    const inv = await findInvite(ctx, req.params.token);
    const { rows: u } = await ctx.db.query('SELECT email FROM users WHERE id = $1', [userId]);
    const email = u[0].email as string;
    if (inv.kind === 'email') {
      if (normalizeEmail(inv.email!) !== email) throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
      await joinWorkspace(ctx, { workspaceId: inv.workspaceId, userId, role: inv.role, email, enforceDomain: inv.role !== 'guest' });
      await ctx.db.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [inv.id]);
    } else if (inv.kind === 'link') {
      await joinWorkspace(ctx, { workspaceId: inv.workspaceId, userId, role: 'member', email, enforceDomain: true });
    } else {
      await joinWorkspace(ctx, { workspaceId: inv.workspaceId, userId, role: 'guest', email, enforceDomain: false });
      await ctx.db.query('INSERT INTO guest_access (workspace_id, user_id, grant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
        inv.workspaceId,
        userId,
        inv.id,
      ]);
    }
    ctx.bus.publish({ kind: 'workspace.updated', workspaceId: inv.workspaceId });
    return membershipFor(ctx, inv.workspaceId, userId);
  });

  // ---------- guest links (FR-7.7) ----------
  app.get<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/guest-links', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    const { rows } = await ctx.db.query('SELECT * FROM guest_grants WHERE workspace_id = $1 ORDER BY created_at DESC', [req.params.ws]);
    return rows.map(toGrant);
  });

  app.post<{ Params: { ws: string } }>('/api/v1/workspaces/:ws/guest-links', async (req) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    const body = parse(z.object({ threadIds: z.array(z.string().uuid()).max(500).default([]), pageIds: z.array(z.string().uuid()).max(500).default([]) }), req.body);
    if (!body.threadIds.length && !body.pageIds.length) throw badRequest('Choose at least one thread or page', 'validation_error');
    const { rows: tcheck } = await ctx.db.query('SELECT count(*)::int AS n FROM threads WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [
      req.params.ws,
      body.threadIds,
    ]);
    const { rows: pcheck } = await ctx.db.query('SELECT count(*)::int AS n FROM pages WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [
      req.params.ws,
      body.pageIds,
    ]);
    if (tcheck[0].n !== body.threadIds.length || pcheck[0].n !== body.pageIds.length) throw badRequest('Unknown thread or page', 'validation_error');
    const token = 'gst_' + randomToken(24);
    const { rows } = await ctx.db.query(
      'INSERT INTO guest_grants (workspace_id, token, thread_ids, page_ids, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.ws, token, JSON.stringify(body.threadIds), JSON.stringify(body.pageIds), p.userId],
    );
    return { ...toGrant(rows[0]), url: inviteUrl(ctx, token) };
  });

  app.delete<{ Params: { ws: string; id: string } }>('/api/v1/workspaces/:ws/guest-links/:id', async (req, reply) => {
    const p = await requireAuth(ctx, req);
    await requireRole(ctx, p, req.params.ws, 'manageMembers');
    if (!isUuid(req.params.id)) throw notFound('Guest link');
    await ctx.db.query('UPDATE guest_grants SET revoked_at = now() WHERE id = $1 AND workspace_id = $2', [req.params.id, req.params.ws]);
    return reply.code(204).send();
  });

  // ---------- activity (FR-7.8) ----------
  app.get<{ Params: { ws: string }; Querystring: { threadId?: string } }>('/api/v1/workspaces/:ws/activity', async (req) => {
    const p = await requireAuth(ctx, req);
    const role = await requireRole(ctx, p, req.params.ws);
    if (role === 'guest' && !req.query.threadId) throw forbidden();
    if (req.query.threadId && !isUuid(req.query.threadId)) throw notFound('Thread');
    if (req.query.threadId && role === 'guest') {
      const { threadAccess } = await import('../context');
      await threadAccess(ctx, p, req.query.threadId);
    }
    return listActivity(ctx, req.params.ws, req.query.threadId);
  });
}

async function assertAnotherOwner(ctx: AppCtx, workspaceId: string, exceptMemberId: string) {
  const { rows } = await ctx.db.query(`SELECT count(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'owner' AND id <> $2`, [
    workspaceId,
    exceptMemberId,
  ]);
  if (rows[0].n < 1) throw new AppError(409, 'last_owner', 'A workspace needs at least one owner');
}

function toInvite(r: any) {
  return { id: r.id, workspaceId: r.workspace_id, email: r.email, role: r.role as Role, createdAt: iso(r.created_at), acceptedAt: r.accepted_at ? iso(r.accepted_at) : null };
}

function toGrant(r: any) {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    token: r.token,
    threadIds: r.thread_ids,
    pageIds: r.page_ids,
    createdAt: iso(r.created_at),
    revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
  };
}

async function findInvite(
  ctx: AppCtx,
  token: string,
): Promise<{ id: string; kind: 'email' | 'link' | 'guest'; workspaceId: string; workspaceName: string; role: Role; email?: string }> {
  if (token.startsWith('inv_')) {
    const { rows } = await ctx.db.query(
      'SELECT i.*, w.name AS ws_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = $1 AND i.revoked_at IS NULL',
      [token],
    );
    const r = rows[0];
    if (!r || r.accepted_at) throw notFound('Invitation');
    return { id: r.id, kind: 'email', workspaceId: r.workspace_id, workspaceName: r.ws_name, role: r.role, email: r.email };
  }
  if (token.startsWith('lnk_')) {
    const { rows } = await ctx.db.query('SELECT id, name FROM workspaces WHERE invite_token = $1', [token]);
    if (!rows[0]) throw notFound('Invitation');
    return { id: rows[0].id, kind: 'link', workspaceId: rows[0].id, workspaceName: rows[0].name, role: 'member' };
  }
  if (token.startsWith('gst_')) {
    const { rows } = await ctx.db.query(
      'SELECT g.id, g.workspace_id, w.name FROM guest_grants g JOIN workspaces w ON w.id = g.workspace_id WHERE g.token = $1 AND g.revoked_at IS NULL',
      [token],
    );
    if (!rows[0]) throw notFound('Invitation');
    return { id: rows[0].id, kind: 'guest', workspaceId: rows[0].workspace_id, workspaceName: rows[0].name, role: 'guest' };
  }
  throw notFound('Invitation');
}
