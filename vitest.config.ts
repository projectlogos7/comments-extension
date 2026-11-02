import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@pinpoint/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@pinpoint/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
    },
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'server/test/**/*.test.ts', 'extension/test/**/*.test.ts', 'web/test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
