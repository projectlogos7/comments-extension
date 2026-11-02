import type { AuthTokens, Me } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { randomToken, sha256, signJwt } from '../crypto';
import { badRequest } from '../errors';
import { loadMember, toUser, toWorkspace } from '../model';
import { joinWorkspace } from './membership';

export const ACCESS_TTL = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

export async function issueTokens(app: AppCtx, userId: string): Promise<AuthTokens> {
  const accessToken = signJwt({ sub: userId, typ: 'access' }, app.cfg.jwtSecret, ACCESS_TTL);
  const refreshToken = 'rt_' + randomToken(32);
  await app.db.query(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '${REFRESH_TTL_DAYS} days')`, [
    userId,
    sha256(refreshToken),
  ]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
}

export async function rotateRefresh(app: AppCtx, refreshToken: string): Promise<AuthTokens | null> {
  const { rows } = await app.db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha256(refreshToken)]);
  const r = rows[0];
  if (!r) return null;
  if (r.revoked_at) {
    // Reuse of a rotated token: assume theft and revoke every session of this user.
    await app.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [r.user_id]);
    return null;
  }
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  const { rows: u } = await app.db.query('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [r.user_id]);
  if (!u[0]) return null;
  await app.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [r.id]);
  return issueTokens(app, r.user_id);
}

export async function revokeRefresh(app: AppCtx, refreshToken: string) {
  await app.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(refreshToken)]);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Find or create the user for a verified email; link an IdP identity when given. */
export async function upsertUser(
  app: AppCtx,
  input: { email: string; name?: string | null; avatarUrl?: string | null; provider?: string; subject?: string },
): Promise<string> {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !/^[^@\s]+@localhost$/.test(email)) throw badRequest('Invalid email');
  let userId: string | null = null;
  if (input.provider && input.subject) {
    const { rows } = await app.db.query('SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2', [input.provider, input.subject]);
    userId = rows[0]?.user_id ?? null;
  }
  if (!userId) {
    const { rows } = await app.db.query(
      `INSERT INTO users (email, name, avatar_url) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         name = CASE WHEN users.name = '' THEN EXCLUDED.name ELSE users.name END,
         avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url)
       RETURNING id, deleted_at`,
      [email, input.name?.trim() || email.split('@')[0], input.avatarUrl ?? null],
    );
    if (rows[0].deleted_at) throw badRequest('This account was deleted', 'account_deleted');
    userId = rows[0].id as string;
    if (input.provider && input.subject) {
      await app.db.query('INSERT INTO auth_identities (provider, subject, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
        input.provider,
        input.subject,
        userId,
      ]);
    }
  }
  await acceptPendingInvites(app, userId, email);
  return userId;
}

/** Accept outstanding email invites addressed to this (verified) email. */
async function acceptPendingInvites(app: AppCtx, userId: string, email: string) {
  const { rows } = await app.db.query(`SELECT * FROM invites WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL`, [email]);
  for (const inv of rows) {
    try {
      await joinWorkspace(app, { workspaceId: inv.workspace_id, userId, role: inv.role, email, enforceDomain: inv.role !== 'guest' });
      await app.db.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [inv.id]);
    } catch {
      /* domain mismatch etc.: leave invite pending */
    }
  }
}

export async function loadMe(app: AppCtx, userId: string): Promise<Me> {
  const { rows: u } = await app.db.query('SELECT * FROM users WHERE id = $1', [userId]);
  const { rows } = await app.db.query(
    `SELECT m.id AS member_id, w.* , m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY w.created_at`,
    [userId],
  );
  const memberships = [];
  for (const r of rows) {
    const member = await loadMember(app, r.member_id);
    if (!member) continue;
    memberships.push({ workspace: toWorkspace(r, r.role === 'owner' || r.role === 'admin'), member });
  }
  return { user: toUser(u[0]), memberships, analyticsOptOut: !!u[0].analytics_opt_out };
}

const REDIRECT_EXT = /^https:\/\/[a-p]{32}\.chromiumapp\.org(\/|$)/;

export function isAllowedRedirect(app: AppCtx, redirect: string): boolean {
  if (REDIRECT_EXT.test(redirect)) return true;
  try {
    const r = new URL(redirect);
    const p = new URL(app.cfg.publicUrl);
    return r.origin === p.origin;
  } catch {
    return false;
  }
}

export function redirectWithTokens(redirect: string, t: AuthTokens): string {
  const base = redirect.split('#')[0];
  return `${base}#accessToken=${encodeURIComponent(t.accessToken)}&refreshToken=${encodeURIComponent(t.refreshToken)}&expiresIn=${t.expiresIn}`;
}
