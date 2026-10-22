import { defineConfig } from 'vitest/config';
import path from 'path';

// Integration tests - run with external services (Postgres, Redis)
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.int.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@jq/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@jq/config': path.resolve(__dirname, 'packages/config/src'),
    },
  },
});
