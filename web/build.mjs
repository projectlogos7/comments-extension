// Builds the web app into server/public/app (served by the server at /app/).
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outdir = path.resolve(root, 'server/public/app');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: { app: path.join(here, 'src/main.tsx') },
  bundle: true,
  format: 'esm',
  target: ['chrome110', 'edge110', 'firefox115', 'safari16'],
  outdir,
  sourcemap: true,
  minify: !watch,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: {
    '@pinpoint/shared': path.join(root, 'packages/shared/src/index.ts'),
  },
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

await mkdir(outdir, { recursive: true });
await copyFile(path.join(here, 'index.html'), path.join(outdir, 'index.html'));

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
