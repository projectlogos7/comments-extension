import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context';
import { requireUser } from '../context';
import { decodeJwtPayload, randomToken, sha256, signJwt, verifyJwt } from '../crypto';
import { AppError, badRequest, notFound, unauthorized } from '../errors';
import { emailLayout } from '../mail';
import {
  isAllowedRedirect,
  issueTokens,
  loadMe,
  normalizeEmail,
  redirectWithTokens,
  revokeRefresh,
  rotateRefresh,
  upsertUser,
} from '../services/auth';
import { parse, z } from '../validate';
import { escapeHtml } from '@pinpoint/shared';

type Provider = 'google' | 'microsoft';

function providerConf(ctx: AppCtx, provider: Provider) {
  if (provider === 'google' && ctx.cfg.google)
    return {
      ...ctx.cfg.google,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    };
  if (provider === 'microsoft' && ctx.cfg.microsoft) {
    const t = ctx.cfg.microsoft.tenant;
    return {
      ...ctx.cfg.microsoft,
      authUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
      scope: 'openid email profile',
    };
  }
  return null;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppCtx) {
  const callbackUrl = (p: Provider) => `${ctx.cfg.publicUrl}/api/v1/auth/${p}/callback`;

  app.get('/api/v1/auth/providers', async () => ({
    google: !!ctx.cfg.google,
    microsoft: !!ctx.cfg.microsoft,
    email: true,
    dev: ctx.cfg.devLogin,
  }));

  app.get<{ Params: { provider: string }; Querystring: { redirect?: string } }>('/api/v1/auth/:provider/start', async (req, reply) => {
    const provider = req.params.provider as Provider;
    const conf = providerConf(ctx, provider);
    if (!conf) throw notFound('Sign-in provider');
    const redirect = req.query.redirect ?? '';
    if (!isAllowedRedirect(ctx, redirect)) throw badRequest('redirect is not allowed', 'bad_redirect');
    const state = signJwt({ typ: 'oauth_state', provider, redirect, n: randomToken(8) }, ctx.cfg.jwtSecret, 600);
    const u = new URL(conf.authUrl);
    u.searchParams.set('client_id', conf.clientId);
    u.searchParams.set('redirect_uri', callbackUrl(provider));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', conf.scope);
    u.searchParams.set('state', state);
    u.searchParams.set('prompt', 'select_account');
    return reply.redirect(u.toString());
  });

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/v1/auth/:provider/callback',
    async (req, reply) => {
      const provider = req.params.provider as Provider;
      const conf = providerConf(ctx, provider);
      if (!conf) throw notFound('Sign-in provider');
      const st = verifyJwt<{ typ: string; provider: string; redirect: string }>(req.query.state ?? '', ctx.cfg.jwtSecret);
      if (!st || st.typ !== 'oauth_state' || st.provider !== provider) throw badRequest('Invalid sign-in state', 'bad_state');
      if (req.query.error || !req.query.code) throw badRequest(`Sign-in cancelled: ${req.query.error ?? 'no code'}`, 'oauth_error');
      const res = await ctx.fetch(conf.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: conf.clientId,
          client_secret: conf.clientSecret,
          redirect_uri: callbackUrl(provider),
          grant_type: 'authorization_code',
        }),
      });
      if (!res.ok) throw new AppError(502, 'oauth_error', 'Could not complete sign in');
      const tok: any = await res.json();
      const claims = decodeJwtPayload(tok.id_token ?? '');
      const email = claims?.email ?? claims?.preferred_username;
      if (!claims || !email) throw new AppError(502, 'oauth_error', 'The provider did not return an email');
      if (provider === 'google' && claims.email_verified === false) throw badRequest('Email not verified', 'oauth_error');
      const userId = await upsertUser(ctx, {
        email,
        name: claims.name,
        avatarUrl: claims.picture ?? null,
        provider,
        subject: String(claims.oid ?? claims.sub),
      });
      return reply.redirect(redirectWithTokens(st.redirect, await issueTokens(ctx, userId)));
    },
  );

  app.post('/api/v1/auth/email', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ email: z.string().email().max(254), redirect: z.string().url() }), req.body);
    if (!isAllowedRedirect(ctx, body.redirect)) throw badRequest('redirect is not allowed', 'bad_redirect');
    const email = normalizeEmail(body.email);
    const token = randomToken(32);
    await ctx.db.query(`INSERT INTO email_login_tokens (token_hash, email, redirect, expires_at) VALUES ($1,$2,$3, now() + interval '15 minutes')`, [
      sha256(token),
      email,
      body.redirect,
    ]);
    const link = `${ctx.cfg.publicUrl}/api/v1/auth/email/verify?token=${token}`;
    await ctx.mailer.send({
      to: email,
      subject: 'Your Pinpoint sign-in link',
      text: `Sign in to Pinpoint: ${link}\n\nThe link expires in 15 minutes. If you did not request it, ignore this email.`,
      html: emailLayout('Sign in to Pinpoint', '<p>Click the button to sign in. The link expires in 15 minutes.</p>', { label: 'Sign in', url: link }),
    });
    return ctx.cfg.devLogin ? { sent: true, devLink: link } : { sent: true };
  });

  app.get<{ Querystring: { token?: string } }>('/api/v1/auth/email/verify', async (req, reply) => {
    const { rows } = await ctx.db.query(
      'UPDATE email_login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email, redirect',
      [sha256(req.query.token ?? '')],
    );
    if (!rows[0]) {
      reply.type('text/html').code(400);
      return `<!doctype html><meta charset="utf-8"><title>Link expired</title><body style="font-family:system-ui;padding:40px"><h1>This sign-in link has expired</h1><p>Request a new link from the extension or <a href="${escapeHtml(ctx.cfg.publicUrl)}/app/">web app</a>.</p></body>`;
    }
    const userId = await upsertUser(ctx, { email: rows[0].email, provider: 'email', subject: rows[0].email });
    return reply.redirect(redirectWithTokens(rows[0].redirect, await issueTokens(ctx, userId)));
  });

  app.post('/api/v1/auth/refresh', async (req) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10).max(200) }), req.body);
    const t = await rotateRefresh(ctx, refreshToken);
    if (!t) throw unauthorized('Session expired');
    return t;
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().max(200) }), req.body);
    await revokeRefresh(ctx, refreshToken);
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/dev-login', async (req) => {
    if (!ctx.cfg.devLogin) throw notFound('Route');
    const body = parse(z.object({ email: z.string().email(), name: z.string().max(100).optional() }), req.body);
    const userId = await upsertUser(ctx, { email: body.email, name: body.name });
    if (body.name) await ctx.db.query('UPDATE users SET name = $1 WHERE id = $2', [body.name, userId]);
    return issueTokens(ctx, userId);
  });

  app.get('/dev/mailbox', async (req, reply) => {
    if (!ctx.cfg.devLogin) throw notFound('Route');
    return reply.send(ctx.mailer.outbox.slice().reverse());
  });

  // ---------- me ----------
  app.get('/api/v1/me', async (req) => loadMe(ctx, await requireUser(ctx, req)));

  app.patch('/api/v1/me', async (req) => {
    const userId = await requireUser(ctx, req);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100).optional(), avatarUrl: z.string().url().max(2000).nullable().optional(), analyticsOptOut: z.boolean().optional() }),
      req.body,
    );
    if (body.name !== undefined) await ctx.db.query('UPDATE users SET name = $1 WHERE id = $2', [body.name, userId]);
    if (body.avatarUrl !== undefined) await ctx.db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [body.avatarUrl, userId]);
    if (body.analyticsOptOut !== undefined) await ctx.db.query('UPDATE users SET analytics_opt_out = $1 WHERE id = $2', [body.analyticsOptOut, userId]);
    return loadMe(ctx, userId);
  });

  // GDPR export: every record about the user.
  app.get('/api/v1/me/export', async (req, reply) => {
    const userId = await requireUser(ctx, req);
    const q = async (sql: string) => (await ctx.db.query(sql, [userId])).rows;
    const data = {
      exportedAt: new Date().toISOString(),
      user: (await q('SELECT id, email, name, avatar_url, analytics_opt_out, created_at FROM users WHERE id = $1'))[0],
      identities: await q('SELECT provider, created_at FROM auth_identities WHERE user_id = $1'),
      memberships: await q('SELECT m.workspace_id, w.name AS workspace_name, m.role, m.notification_prefs, m.created_at FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1'),
      threads: await q('SELECT id, workspace_id, page_id, scope, status, anchor, created_at FROM threads WHERE created_by = $1'),
      comments: await q('SELECT id, thread_id, body, created_at, edited_at, deleted_at FROM comments WHERE author_id = $1'),
      reactions: await q('SELECT comment_id, emoji, created_at FROM reactions WHERE user_id = $1'),
      notifications: await q('SELECT event, thread_id, title, excerpt, created_at, read_at FROM notifications WHERE user_id = $1'),
      savedViews: await q('SELECT name, filters, sort, shared, created_at FROM saved_views WHERE created_by = $1'),
      attachments: await q('SELECT id, name, content_type, size, created_at FROM attachments WHERE uploader_id = $1'),
    };
    reply.header('content-disposition', 'attachment; filename="pinpoint-my-data.json"');
    return data;
  });

  // GDPR deletion: remove account, sessions and memberships; comments stay attributed to "Deleted user".
  app.delete('/api/v1/me', async (req, reply) => {
    const userId = await requireUser(ctx, req);
    const { rows: owned } = await ctx.db.query(
      `SELECT m.workspace_id, (SELECT count(*)::int FROM members o WHERE o.workspace_id = m.workspace_id AND o.role = 'owner') AS owners,
              (SELECT count(*)::int FROM members a WHERE a.workspace_id = m.workspace_id) AS total
       FROM members m WHERE m.user_id = $1 AND m.role = 'owner'`,
      [userId],
    );
    for (const w of owned) {
      if (w.total > 1 && w.owners < 2) throw new AppError(409, 'transfer_ownership', 'Transfer ownership of your shared workspaces before deleting your account');
    }
    for (const w of owned) if (w.total === 1) await deleteWorkspaceData(ctx, w.workspace_id);
    await ctx.db.query('DELETE FROM members WHERE user_id = $1', [userId]);
    await ctx.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await ctx.db.query('DELETE FROM auth_identities WHERE user_id = $1', [userId]);
    await ctx.db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    await ctx.db.query('DELETE FROM saved_views WHERE created_by = $1', [userId]);
    await ctx.db.query(`UPDATE users SET email = 'deleted+' || id || '@pinpoint.invalid', name = 'Deleted user', avatar_url = NULL, deleted_at = now() WHERE id = $1`, [userId]);
    return reply.code(204).send();
  });
}

/** Delete a workspace and queue its files for removal. */
export async function deleteWorkspaceData(ctx: AppCtx, workspaceId: string) {
  await ctx.db.query(
    `INSERT INTO deleted_files (storage_key)
     SELECT storage_key FROM snapshots WHERE workspace_id = $1
     UNION SELECT storage_key FROM attachments WHERE workspace_id = $1
     ON CONFLICT DO NOTHING`,
    [workspaceId],
  );
  await ctx.db.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
}
