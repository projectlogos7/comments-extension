import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context';
import { resolvePrincipal } from '../context';
import { parse, z } from '../validate';

// Anonymous product analytics and error reports. Only a name and primitive props are accepted, and
// no user id is stored, so page content or comment text cannot be attached by schema (NFR Observability).
const prop = z.union([z.string().max(100), z.number(), z.boolean()]);
const eventSchema = z.object({ name: z.string().regex(/^[a-z0-9_.:-]{1,64}$/i), props: z.record(z.string().max(40), prop).optional() }).strict();

export function registerTelemetryRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.post('/api/v1/telemetry', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { events } = parse(z.object({ events: z.array(eventSchema).max(50) }).strict(), req.body);
    const p = await resolvePrincipal(ctx, req).catch(() => null);
    if (p?.kind === 'user') {
      const { rows } = await ctx.db.query('SELECT analytics_opt_out FROM users WHERE id = $1', [p.userId]);
      if (rows[0]?.analytics_opt_out) return reply.code(204).send();
    }
    for (const e of events) {
      if (Object.keys(e.props ?? {}).length > 20) continue;
      await ctx.db.query('INSERT INTO telemetry_events (name, props) VALUES ($1, $2)', [e.name, JSON.stringify(e.props ?? {})]);
    }
    return reply.code(204).send();
  });

  app.post('/api/v1/errors', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const e = parse(
      z.object({ message: z.string().max(500), stack: z.string().max(4000).optional(), context: z.string().max(64), version: z.string().max(32) }).strict(),
      req.body,
    );
    // Strip URLs and quoted strings, which could carry page content.
    const scrub = (s: string) => s.replace(/https?:\/\/\S+/g, '<url>').replace(/"[^"]{20,}"/g, '"<redacted>"');
    await ctx.db.query('INSERT INTO error_reports (message, stack, context, version) VALUES ($1,$2,$3,$4)', [
      scrub(e.message),
      e.stack ? scrub(e.stack) : null,
      e.context,
      e.version,
    ]);
    return reply.code(204).send();
  });
}
