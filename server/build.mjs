import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, '../packages/shared/src/index.ts');

for (const entry of ['index', 'migrate-cli']) {
  await build({
    entryPoints: [path.join(here, 'src', `${entry}.ts`)],
    outfile: path.join(here, 'dist', `${entry}.js`),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
    packages: 'external',
    alias: { '@pinpoint/shared': shared },
    // @pinpoint/shared is TS source: force it into the bundle despite packages: 'external'.
    plugins: [
      {
        name: 'bundle-shared',
        setup(b) {
          b.onResolve({ filter: /^@pinpoint\/shared$/ }, () => ({ path: shared }));
        },
      },
    ],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
}
console.log('server built to server/dist');
