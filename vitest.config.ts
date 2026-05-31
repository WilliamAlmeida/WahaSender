import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 15000,
    setupFiles: ['tests/setup.ts'],
  },
});
