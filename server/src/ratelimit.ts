import type { FastifyRequest } from 'fastify';
import { sha256, verifyJwt } from './crypto';

/**
 * Rate-limit bucket for a request. Signed-in users and API keys get their own bucket, so a team
 * behind one office NAT is not throttled together; anonymous requests are keyed by IP.
 * Only cheap, local checks (HMAC verify / hash) — no database access per request.
 */
export function rateLimitKey(jwtSecret: string, req: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const h = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) {
    const token = m[1].trim();
    if (token.startsWith('pk_')) return 'key:' + sha256(token).slice(0, 24);
    const payload = verifyJwt<{ sub: string; typ: string }>(token, jwtSecret);
    if (payload?.sub && payload.typ === 'access') return 'user:' + payload.sub;
  }
  return 'ip:' + req.ip;
}

/** Requests never counted: file downloads, web-app assets, health/config, WebSocket upgrades. */
export function isRateLimitExempt(method: string, url: string, upgrade?: string | string[]): boolean {
  if (upgrade) return true;
  const path = url.split('?')[0];
  if (path.startsWith('/files/')) return true;
  if (path === '/api/v1/ws' || path === '/api/v1/health' || path === '/api/v1/config') return true;
  if (method === 'GET' && (path === '/' || path === '/app' || path.startsWith('/app/'))) return true;
  return false;
}
