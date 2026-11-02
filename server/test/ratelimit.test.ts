import { afterAll, describe, expect, it } from 'vitest';
import { loadRateLimitConfig } from '../src/config';
import { isRateLimitExempt, rateLimitKey } from '../src/ratelimit';
import { signJwt } from '../src/crypto';
import { makeApp, type TestApp } from './helpers';

describe('rate limit config', () => {
  it('has sensible defaults and reads env', () => {
    expect(loadRateLimitConfig({})).toEqual({ enabled: true, max: 1200, anonMax: 120, window: '1 minute', authEmailMax: 5 });
    const c = loadRateLimitConfig({ RATE_LIMIT_ENABLED: '0', RATE_LIMIT_MAX: '50', RATE_LIMIT_ANON_MAX: '7', RATE_LIMIT_WINDOW: '30000', RATE_LIMIT_AUTH_EMAIL_MAX: 'nope' });
    expect(c).toEqual({ enabled: false, max: 50, anonMax: 7, window: 30000, authEmailMax: 5 });
  });

  it('keys by user, API key or IP', () => {
    const secret = 's3cret';
    const access = signJwt({ sub: 'user-1', typ: 'access' }, secret, 60);
    expect(rateLimitKey(secret, { headers: { authorization: `Bearer ${access}` }, ip: '1.2.3.4' } as any)).toBe('user:user-1');
    expect(rateLimitKey(secret, { headers: { authorization: 'Bearer pk_abc' }, ip: '1.2.3.4' } as any)).toMatch(/^key:[0-9a-f]{24}$/);
    expect(rateLimitKey(secret, { headers: { authorization: 'Bearer forged.token.x' }, ip: '1.2.3.4' } as any)).toBe('ip:1.2.3.4');
    expect(rateLimitKey(secret, { headers: {}, ip: '5.6.7.8' } as any)).toBe('ip:5.6.7.8');
  });

  it('exempts files, assets, health and websockets', () => {
    expect(isRateLimitExempt('GET', '/files/abc?sig=1')).toBe(true);
    expect(isRateLimitExempt('GET', '/app/app.js')).toBe(true);
    expect(isRateLimitExempt('GET', '/api/v1/health')).toBe(true);
    expect(isRateLimitExempt('GET', '/api/v1/ws?token=x', 'websocket')).toBe(true);
    expect(isRateLimitExempt('GET', '/api/v1/me')).toBe(false);
    expect(isRateLimitExempt('POST', '/app/x')).toBe(false);
  });
});

describe('rate limiting in the app', () => {
  let t: TestApp;
  afterAll(() => t?.close());

  it('limits anonymous callers by IP but signed-in users separately, with friendly errors', async () => {
    t = await makeApp(undefined, { rateLimit: { enabled: true, max: 6, anonMax: 5, window: '1 minute', authEmailMax: 2 } });
    const ana = await t.login('ana@x.com');
    const bo = await t.login('bo@x.com');
    // anonymous: 5 allowed per IP (the two sign-ins above used 2)
    for (let i = 0; i < 3; i++) expect((await t.req('GET', '/api/v1/invites/nope')).status).toBe(404);
    const limited = await t.req('GET', '/api/v1/invites/nope');
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('rate_limited');
    expect(limited.json.error.message).toMatch(/Please wait/);
    expect(limited.headers['retry-after']).toBeDefined();
    // signed-in users from the same IP are not affected by the anonymous bucket, and not by each other
    for (let i = 0; i < 5; i++) expect((await t.req('GET', '/api/v1/me', ana)).status).toBe(200);
    const okBo = await t.req('GET', '/api/v1/me', bo);
    expect(okBo.status).toBe(200);
    expect(okBo.headers['x-ratelimit-limit']).toBe('6');
    expect((await t.req('GET', '/api/v1/me', ana)).status).toBe(200);
    expect((await t.req('GET', '/api/v1/me', ana)).status).toBe(429);
    // exempt routes keep working
    expect((await t.req('GET', '/api/v1/health')).status).toBe(200);
  });

  it('can be switched off', async () => {
    const off = await makeApp(undefined, { rateLimit: { enabled: false, max: 1, anonMax: 1, window: '1 minute', authEmailMax: 1 } });
    for (let i = 0; i < 5; i++) expect((await off.req('GET', '/api/v1/invites/nope')).status).toBe(404);
    await off.close();
  });
});
