import { describe, it, expect } from 'vitest';
import { makeApp } from './helpers';

describe('smoke', () => {
  it('boots', async () => {
    const t = await makeApp();
    const r = await t.req('GET', '/api/v1/health');
    expect(r.json).toEqual({ ok: true, db: 'pglite', version: '0.2.0' });
    const tok = await t.login('a@x.com', 'Ana');
    const me = await t.req('GET', '/api/v1/me', tok);
    expect(me.json.user.name).toBe('Ana');
    await t.close();
  });
});
