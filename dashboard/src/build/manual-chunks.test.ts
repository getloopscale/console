import { describe, it, expect } from 'vitest';

import { manualChunks } from './manual-chunks';

describe('manualChunks vendor split', () => {
  it('co-locates scheduler with react in react-vendor (TDZ fix — ADR D1)', () => {
    // react-dom mutates scheduler.unstable_now at init; if scheduler lands in a
    // different chunk the init order breaks → blank SPA. scheduler MUST be react-vendor.
    expect(manualChunks('/x/node_modules/scheduler/index.js')).toBe('react-vendor');
  });

  it('puts react and react-dom in react-vendor', () => {
    expect(manualChunks('/x/node_modules/react/index.js')).toBe('react-vendor');
    expect(manualChunks('/x/node_modules/react-dom/client.js')).toBe('react-vendor');
  });

  it('keeps react-router OUT of react-vendor (uses /react/ slashes)', () => {
    expect(manualChunks('/x/node_modules/react-router/dist/index.js')).toBe('router');
  });

  it('routes radix / lucide / theo-ui to the single vendor chunk (F-fe-1 — no circular split)', () => {
    // @usetheo/ui re-exports Radix + utility deps that also live in `vendor`; giving
    // them dedicated chunks forms a `vendor ↔ theo-ui ↔ radix` cycle → TDZ → blank
    // SPA. They MUST share the one `vendor` chunk (circular chunks are merged, not
    // split — same principle as scheduler+react in ADR D1).
    expect(manualChunks('/x/node_modules/@radix-ui/react-dialog/index.js')).toBe('vendor');
    expect(manualChunks('/x/node_modules/lucide-react/index.js')).toBe('vendor');
    expect(manualChunks('/x/node_modules/@usetheo/ui/dist/index.js')).toBe('vendor');
  });

  it('routes other node_modules to vendor', () => {
    expect(manualChunks('/x/node_modules/lodash/index.js')).toBe('vendor');
  });

  it('keeps the force-graph + d3 family OUT of eager vendor chunks (TDZ fix F-fe-1)', () => {
    // react-force-graph-2d + force-graph + the d3-* constellation mutually reference
    // each other during init (d3-transition → d3-selection → d3-dispatch, …). Forcing
    // them into ANY eager shared chunk lets Rollup order a binding read before init
    // ("Cannot access X before initialization" → blank SPA); a dedicated chunk just
    // moves the circular boundary. GraphPage is React.lazy, so returning undefined
    // lets Rollup keep the family in the dynamic `graph` chunk with its consumer.
    expect(manualChunks('/x/node_modules/react-force-graph-2d/dist/index.js')).toBeUndefined();
    expect(manualChunks('/x/node_modules/force-graph/src/index.js')).toBeUndefined();
    for (const pkg of ['d3-array', 'd3-force-3d', 'd3-selection', 'd3-transition', 'd3-zoom', 'd3-scale-chromatic']) {
      expect(manualChunks(`/x/node_modules/${pkg}/src/index.js`)).toBeUndefined();
    }
    expect(manualChunks('/x/node_modules/d3/src/index.js')).toBeUndefined();
    // a lookalike that is NOT part of the family must still go to vendor
    expect(manualChunks('/x/node_modules/d3po/index.js')).toBe('vendor');
    expect(manualChunks('/x/node_modules/md3-utils/index.js')).toBe('vendor');
  });

  it('does NOT false-match scheduler-polyfill or @scope/scheduler (EC-4)', () => {
    // The trailing-slash `node_modules/scheduler/` must not grab a different package.
    expect(manualChunks('/x/node_modules/scheduler-polyfill/index.js')).toBe('vendor');
    expect(manualChunks('/x/node_modules/@some/scheduler/index.js')).toBe('vendor');
  });

  it('lets app code fall through (undefined → Rollup decides)', () => {
    expect(manualChunks('/x/src/app/main.tsx')).toBeUndefined();
  });
});
