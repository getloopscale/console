import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest config — separate from vite.config.ts so production build doesn't
 * load test setup.
 *
 * jsdom environment provides window, document, etc. — required because
 * src/lib/config.ts reads from window.__THEO_CONFIG__ and gets transitively
 * imported by other lib/ modules.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // The suite is jsdom + import-heavy (143 files). Under full-suite worker
    // contention a per-test/-hook timeout can fire on an otherwise-fine test
    // (observed: import-smoke + render tests timing out at 10-27s while the
    // default 5s elapses under starvation). Raise the ceilings so worker
    // contention does NOT produce false failures — the tests are starved, not
    // wrong. Deterministic-green guard (dashboard-logs-sse-suite-repair F-XV-1).
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
