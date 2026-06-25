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

  it('routes radix / lucide / theo-ui to their dedicated chunks', () => {
    expect(manualChunks('/x/node_modules/@radix-ui/react-dialog/index.js')).toBe('radix');
    expect(manualChunks('/x/node_modules/lucide-react/index.js')).toBe('lucide');
    expect(manualChunks('/x/node_modules/@usetheo/ui/dist/index.js')).toBe('theo-ui');
  });

  it('routes other node_modules to vendor', () => {
    expect(manualChunks('/x/node_modules/lodash/index.js')).toBe('vendor');
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
