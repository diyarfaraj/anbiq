import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against package sources, so they never depend on a stale build.
    alias: {
      '@anbiq/core': source('./packages/core/src/index.ts'),
      '@anbiq/testkit': source('./packages/testkit/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
