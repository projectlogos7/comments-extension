import { buildApp } from '../src/app';
import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../src/context';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppCtx;
  login(email: string, name?: string): Promise<string>;
  req(method: string, url: string, token?: string | null, body?: unknown): Promise<{ status: number; json: any; text: string; headers: Record<string, any> }>;
  close(): Promise<void>;
}

export async function makeApp(fetchImpl?: typeof fetch, config: Record<string, unknown> = {}): Promise<TestApp> {
  const { app, ctx } = await buildApp({
    env: {},
    config: { dataDir: ':memory:', devLogin: true, jobs: false, logger: false, publicUrl: 'http://pinpoint.test', webDir: '/nonexistent', ...config },
    fetch: fetchImpl,
  });
  await app.ready();
  const req: TestApp['req'] = async (method, url, token, body) => {
    const res = await app.inject({
      method: method as any,
      url,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* not json */
    }
    return { status: res.statusCode, json, text: res.body, headers: res.headers };
  };
  return {
    app,
    ctx,
    req,
    async login(email, name) {
      const r = await req('POST', '/api/v1/auth/dev-login', null, { email, name });
      if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text}`);
      return r.json.accessToken;
    },
    close: () => app.close(),
  };
}

export const anchor = (y = 100, extra: Record<string, unknown> = {}) => ({
  scope: 'area',
  urlMatch: 'path',
  viewport: { w: 1440, h: 900, dpr: 2 },
  selectors: ["[data-testid='card']"],
  xpath: '/html/body/main/div[1]',
  textFingerprint: 'Pro plan',
  rect: { relX: 0, relY: 0, w: 100, h: 50 },
  docRect: { x: 10, y, w: 100, h: 50 },
  ...extra,
});

/** Minimal valid 1x1 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = '----pp' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
