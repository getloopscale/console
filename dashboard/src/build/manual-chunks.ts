/**
 * manualChunks — Rollup vendor split for the dashboard build, extracted to a pure,
 * unit-testable function (dashboard-manualchunks-tdz-fix T1.1, ADR D2). Keeping the
 * chunking logic out of the inline vite.config makes the init-order invariant
 * (below) testable so it can never silently regress. Lives under src/ so the
 * existing tsconfig (`include: ["src"]`) typechecks it and vitest discovers its test.
 *
 * CRITICAL (ADR D1): `react`, `react-dom` AND `scheduler` MUST share one chunk.
 * `react-dom` mutates the `scheduler` module's exports (`unstable_now`, …) during
 * init; splitting `scheduler` into a separate chunk breaks chunk init order →
 * `Cannot set properties of undefined (setting 'unstable_now')` → blank SPA. Use
 * `node_modules/react/` (with slashes) so `react-router` etc. are NOT pulled into
 * `react-vendor`. Prior art: vitejs/vite #12209, #7376, #12448.
 */
export function manualChunks(id: string): string | undefined {
  if (id.includes('node_modules/@usetheo/ui')) return 'theo-ui';
  if (id.includes('node_modules/@radix-ui')) return 'radix';
  if (id.includes('node_modules/lucide-react')) return 'lucide';
  if (
    id.includes('node_modules/react/') ||
    id.includes('node_modules/react-dom/') ||
    id.includes('node_modules/scheduler/')
  )
    return 'react-vendor';
  if (id.includes('node_modules/react-router')) return 'router';
  if (id.includes('node_modules/')) return 'vendor';
  return undefined;
}
