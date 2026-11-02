import { buildApp } from './app';

const { app, ctx } = await buildApp();
await app.listen({ port: ctx.cfg.port, host: ctx.cfg.host });
app.log.info(`Pinpoint server on ${ctx.cfg.publicUrl} (db: ${ctx.db.kind}${ctx.cfg.devLogin ? ', DEV_LOGIN on' : ''})`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0));
  });
}
