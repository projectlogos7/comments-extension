import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from './config';
import { openDb } from './db';
import { createStorage } from './storage';
import { createMailer } from './mail';
import { Bus } from './bus';
import type { AppCtx } from './context';
import { AppError } from './errors';
import { registerAuthRoutes } from './routes/auth';
import { registerWorkspaceRoutes } from './routes/workspaces';
import { registerThreadRoutes } from './routes/threads';
import { registerFileRoutes } from './routes/files';
import { registerShareRoutes } from './routes/share';
import { registerNotificationRoutes } from './routes/notifications';
import { registerViewRoutes } from './routes/views';
import { registerExportRoutes } from './routes/export';
import { registerIntegrationRoutes } from './routes/integrations';
import { registerTelemetryRoutes } from './routes/telemetry';
import { registerWsRoutes } from './routes/ws';
import { startJobs } from './services/jobs';

export interface BuildOptions {
  config?: Partial<Config>;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export async function buildApp(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppCtx }> {
  const cfg = loadConfig(opts.env ?? process.env, opts.config);
  const app = Fastify({
    logger: cfg.logger ? { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization'] } : false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  const db = await openDb({ databaseUrl: cfg.databaseUrl, dataDir: cfg.dataDir });
  const bus = new Bus(db);
  await bus.start();
  const ctx: AppCtx = {
    cfg,
    db,
    storage: createStorage(cfg),
    mailer: createMailer(cfg, (m) => (cfg.logger ? app.log.info(m) : undefined)),
    bus,
    log: app.log,
    fetch: opts.fetch ?? fetch,
  };

  const publicOrigin = new URL(cfg.publicUrl).origin;
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === publicOrigin || origin.startsWith('chrome-extension://') || origin.startsWith('extension://')) return cb(null, true);
      // The public API (API keys) is called server-to-server; browsers on other origins are refused.
      cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    exposedHeaders: ['content-disposition'],
    maxAge: 600,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/files/') });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 20 } });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.getHeader('referrer-policy')) reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    if (!req.url.startsWith('/files/')) reply.header('x-frame-options', 'DENY');
    if (cfg.publicUrl.startsWith('https://')) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err.validation) return reply.code(400).send({ error: { code: 'validation_error', message: err.message } });
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests, slow down' } });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: { code: 'file_too_large', message: 'File too large' } });
    if (err.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') return reply.code(400).send({ error: { code: 'validation_error', message: 'Expected multipart/form-data' } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  registerAuthRoutes(app, ctx);
  registerWorkspaceRoutes(app, ctx);
  registerThreadRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerShareRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerViewRoutes(app, ctx);
  registerExportRoutes(app, ctx);
  registerIntegrationRoutes(app, ctx);
  registerTelemetryRoutes(app, ctx);
  registerWsRoutes(app, ctx);

  app.get('/api/v1/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, db: db.kind, version: '0.2.0' };
  });
  app.get('/api/v1/config', async () => ({
    publicUrl: cfg.publicUrl,
    providers: { google: !!cfg.google, microsoft: !!cfg.microsoft, email: true, dev: cfg.devLogin },
    extensionIds: cfg.extensionIds,
  }));

  // Web app (built by the web package into server/public/app).
  const webDir = cfg.webDir;
  const hasWeb = fs.existsSync(path.join(webDir, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: webDir, prefix: '/app/', index: ['index.html'], wildcard: true });
  app.get('/', async (_req, reply) => reply.redirect('/app/'));
  if (!hasWeb) {
    app.get('/app/*', async (_req, reply) =>
      reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title>Pinpoint</title><p style="font-family:system-ui;padding:40px">The web app is not built yet. Run <code>npm run build -w web</code>.</p>'),
    );
  }

  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && req.url.startsWith('/app')) {
      return reply.type('text/html').send(fs.readFileSync(path.join(webDir, 'index.html')));
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
  });

  let stopJobs: (() => void) | null = null;
  if (cfg.jobs) stopJobs = startJobs(ctx);
  app.addHook('onClose', async () => {
    stopJobs?.();
    await db.close();
  });
  return { app, ctx };
}
