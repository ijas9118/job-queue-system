import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@jq/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@jq/config': path.resolve(__dirname, 'packages/config/src'),
    },
  },
});
