import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    // PGlite boots a real PostgreSQL (WASM) per test file and each instance
    // reserves its own memory arena. On a memory-constrained machine, running
    // files in parallel exhausts RAM, so files run one at a time in a single
    // worker and each file tears its database down in afterAll.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,

    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
