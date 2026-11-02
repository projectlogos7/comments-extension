import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

describe('auth', () => {
  it('dev login, refresh rotation and reuse detection', async () => {
    const r = await t.req('POST', '/api/v1/auth/dev-login', null, { email: 'Rot@Example.com', name: 'Rot' });
    expect(r.status).toBe(200);
    const { refreshToken } = r.json;
    const r2 = await t.req('POST', '/api/v1/auth/refresh', null, { refreshToken });
    expect(r2.status).toBe(200);
    expect(r2.json.refreshToken).not.toBe(refreshToken);
    // reuse of the old token revokes the family
    const r3 = await t.req('POST', '/api/v1/auth/refresh', null, { refreshToken });
    expect(r3.status).toBe(401);
    const r4 = await t.req('POST', '/api/v1/auth/refresh', null, { refreshToken: r2.json.refreshToken });
    expect(r4.status).toBe(401);
    const me = await t.req('GET', '/api/v1/me', r2.json.accessToken);
    expect(me.json.user.email).toBe('rot@example.com');
  });

  it('logout revokes refresh token', async () => {
    const r = await t.req('POST', '/api/v1/auth/dev-login', null, { email: 'out@example.com' });
    expect((await t.req('POST', '/api/v1/auth/logout', null, { refreshToken: r.json.refreshToken })).status).toBe(204);
    expect((await t.req('POST', '/api/v1/auth/refresh', null, { refreshToken: r.json.refreshToken })).status).toBe(401);
  });

  it('rejects bad tokens', async () => {
    expect((await t.req('GET', '/api/v1/me', 'nope')).status).toBe(401);
    expect((await t.req('GET', '/api/v1/me')).json.error.code).toBe('unauthorized');
  });

  it('email magic link ends at redirect with tokens in the fragment', async () => {
    const bad = await t.req('POST', '/api/v1/auth/email', null, { email: 'm@example.com', redirect: 'https://evil.com/x' });
    expect(bad.status).toBe(400);
    const ok = await t.req('POST', '/api/v1/auth/email', null, { email: 'm@example.com', redirect: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/cb' });
    expect(ok.status).toBe(200);
    expect(t.ctx.mailer.outbox.at(-1)!.to).toBe('m@example.com');
    const link = new URL(ok.json.devLink);
    const v = await t.app.inject({ method: 'GET', url: link.pathname + link.search });
    expect(v.statusCode).toBe(302);
    expect(v.headers.location).toMatch(/^https:\/\/abcdefghijklmnopabcdefghijklmnop\.chromiumapp\.org\/cb#accessToken=.+&refreshToken=.+&expiresIn=900$/);
    // single use
    const again = await t.app.inject({ method: 'GET', url: link.pathname + link.search });
    expect(again.statusCode).toBe(400);
  });

  it('oauth start requires a configured provider', async () => {
    expect((await t.req('GET', '/api/v1/auth/google/start?redirect=http://pinpoint.test/app/')).status).toBe(404);
  });

  it('updates profile, exports and deletes account', async () => {
    const tok = await t.login('gone@example.com', 'Gone');
    const p = await t.req('PATCH', '/api/v1/me', tok, { name: 'Gone Two', analyticsOptOut: true });
    expect(p.json.user.name).toBe('Gone Two');
    expect(p.json.analyticsOptOut).toBe(true);
    const ws = await t.req('POST', '/api/v1/workspaces', tok, { name: 'Solo' });
    expect(ws.status).toBe(200);
    const ex = await t.req('GET', '/api/v1/me/export', tok);
    expect(ex.json.user.email).toBe('gone@example.com');
    expect(ex.json.memberships).toHaveLength(1);
    expect((await t.req('DELETE', '/api/v1/me', tok)).status).toBe(204);
    expect((await t.req('GET', '/api/v1/me', tok)).status).toBe(401);
  });
});
