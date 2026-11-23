import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packages = fileURLToPath(new URL('./packages/', import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against package sources, so they never depend on a stale build.
    alias: [{ find: /^@anbiq\/([a-z-]+)$/, replacement: `${packages}$1/src/index.ts` }],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
