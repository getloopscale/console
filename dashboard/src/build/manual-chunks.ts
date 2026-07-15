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
 *
 * CRITICAL (F-fe-1): `react-force-graph-2d` + `force-graph` + the `d3-*` family
 * mutually reference each other during module init. Forcing them into ANY eager
 * shared chunk (the generic `vendor`, OR a dedicated one) lets Rollup order a
 * binding read before init → `Cannot access X before initialization` → blank SPA
 * (a dedicated chunk just moves the circular boundary: `vendor ↔ force-graph`).
 * `GraphPage` is already `React.lazy`-imported (app.tsx), so the ONLY correct move
 * is to return `undefined` for the whole family and let Rollup keep it in the
 * dynamic `graph` chunk with its consumer — preserving the code-split AND the
 * self-contained init order. Match `d3-`/bare `d3` with the slash so `d3po`/
 * `md3-utils` are NOT captured.
 */
const FORCE_GRAPH_RE = /node_modules\/(react-force-graph|force-graph|d3-|d3\/)/;

export function manualChunks(id: string): string | undefined {
  // NOTE (F-fe-1): @usetheo/ui / @radix-ui / lucide are NOT given dedicated chunks.
  // @usetheo/ui re-exports Radix + utility deps that ALSO live in `vendor`, forming
  // a `vendor ↔ theo-ui ↔ radix` chunk cycle; Rollup then orders a `vendor` binding
  // read before its init → "Cannot access X before initialization" → blank SPA. The
  // same failure mode ADR D1 documents for scheduler: circular chunks must be MERGED,
  // not split. Letting them fall to the single `vendor` chunk breaks the cycle.
  // Force-graph/d3 family: keep OUT of every eager vendor chunk (F-fe-1 TDZ). Let
  // it ride the lazy `graph` chunk via Rollup's default dynamic-import splitting.
  if (FORCE_GRAPH_RE.test(id)) return undefined;
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
