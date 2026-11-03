import {defineConfig} from 'vitest/config';

// Tests never read backend/.env (which points at production). The setup file
// pins an isolated environment before any application module is imported.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-env.ts'],
    pool: 'forks',
    poolOptions: {forks: {singleFork: true}},
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
