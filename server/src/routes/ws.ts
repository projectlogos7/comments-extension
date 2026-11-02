import type { FastifyInstance } from 'fastify';
import type { RealtimeEvent } from '@pinpoint/shared';
import type { AppCtx, Principal } from '../context';
import { principalFromToken, roleIn } from '../context';

/** Real-time updates (FR-2.11). Protocol: client -> {type:'subscribe'|'unsubscribe', workspaceId} | {type:'ping'}; server -> {type:'event', event} | {type:'subscribed'} | {type:'pong'} | {type:'error'}. */
export function registerWsRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.get<{ Querystring: { token?: string } }>('/api/v1/ws', { websocket: true }, async (socket, req) => {
    const send = (m: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(m));
    };
    // Buffer messages while authenticating.
    const pending: string[] = [];
    const early = (d: any) => pending.push(String(d));
    socket.on('message', early);
    let principal: Principal | null = null;
    try {
      principal = await principalFromToken(ctx, String(req.query.token ?? ''));
    } catch {
      principal = null;
    }
    if (!principal) {
      send({ type: 'error', code: 'unauthorized' });
      socket.close(4401, 'unauthorized');
      return;
    }
    const p = principal;
    const subs = new Set<string>();
    let alive = true;
    const off = ctx.bus.on((e: RealtimeEvent) => {
      if (!subs.has(e.workspaceId)) return;
      if (e.kind === 'notification.created' && e.userId !== p.userId) return;
      send({ type: 'event', event: e });
    });
    const handle = async (raw: string) => {
      let m: any;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m?.type === 'ping') return send({ type: 'pong' });
      if (m?.type === 'subscribe' && typeof m.workspaceId === 'string') {
        const role = await roleIn(ctx, p, m.workspaceId).catch(() => null);
        if (!role) return send({ type: 'error', code: 'forbidden', workspaceId: m.workspaceId });
        subs.add(m.workspaceId);
        return send({ type: 'subscribed', workspaceId: m.workspaceId });
      }
      if (m?.type === 'unsubscribe') subs.delete(m.workspaceId);
    };
    socket.off('message', early);
    socket.on('message', (d: any) => void handle(String(d)));
    for (const raw of pending) await handle(raw);
    socket.on('pong', () => (alive = true));
    const timer = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      try {
        socket.ping();
      } catch {
        /* closed */
      }
    }, 30000);
    timer.unref?.();
    socket.on('close', () => {
      clearInterval(timer);
      off();
    });
  });
}
