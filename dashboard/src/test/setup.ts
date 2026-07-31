import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/**
 * theo-cloud#187 — `findBy*` / `waitFor` budget, raised from the testing-library default of 1000 ms.
 *
 * `vitest.config.ts` ALREADY raised `testTimeout`/`hookTimeout` to 20 s, for this exact reason, in its
 * own words: *"worker contention does NOT produce false failures — the tests are starved, not wrong"*.
 * The inner budget was left at the library default, so a `findBy*` gives up after **1 s** inside a test
 * that is allowed **20 s** — the outer ceiling can never be reached, because the inner one fires first.
 * That asymmetry is the defect; this line finishes the change that config started.
 *
 * The one failure actually observed was a `findByRole` giving up on a COLD run (52 s of transform/import
 * versus 7 s warm), while the same test passed 19/19 on every warm run and 3/3 in isolation. The failure
 * SHAPE was a timeout, not a wrong DOM.
 *
 * This also CORRECTS the cause recorded in #187 ("a leaked `location.search` … between test files"):
 * `isolate` is set in neither `vitest.config.ts` nor `vite.config.ts`, so it is vitest's default `true`
 * and every test FILE gets its own environment. Cross-file `window.location` leakage is not the
 * mechanism, and hardening `beforeEach` against it would have fixed nothing.
 *
 * Honest limit: a larger budget does not make a slow render fast, and it cannot mask a genuinely missing
 * element — a `findBy` that will never resolve still fails, 5 s later. What it removes is a red that
 * means "the runner was busy". #187 stays OPEN: this was never reproducible on demand (attempted twice
 * under load average 22 on 12 cores, both green), so the newly-enabled CI gate (#276) is what will
 * produce frequency data instead of anecdote.
 */
configure({ asyncUtilTimeout: 5000 });

// Auto-cleanup DOM after each test to prevent state bleeding.
// Vitest 4.x with @testing-library/react v16+ does NOT auto-cleanup by default.
afterEach(() => {
  cleanup();
});

// M21 T2.1 (risk R3) — deterministic fetch stub so NO test touches the real network.
// The sidebar becomes asynchronous in T3.1, and every suite that renders it (plus
// dashboard-layout and the e2e journeys) would otherwise issue a real request in jsdom.
// The symptom would not be a red test — it is an unhandled rejection plus act() noise,
// which does not block a merge. 503 (rather than a rejection) keeps existing suites on
// the path they already had when the network did not answer: `cloudFetch` resolves null.
//
// The stub is INSTALLED ONLY when fetch is not already a mock. Several suites
// (login, register, verification) call `vi.stubGlobal('fetch', …)` at module scope,
// which runs once at import; replacing it here on every test would detach their mock
// from globalThis and break them. For the same reason `vi.unstubAllGlobals()` is NOT
// called: it would restore the real fetch after their first test.
beforeEach(() => {
  if (!vi.isMockFunction(globalThis.fetch)) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
  }
});

// Polyfill window.matchMedia for jsdom (used by Radix media queries internally).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Polyfill ResizeObserver for jsdom (used by cmdk internally — Sprint 2 T2.1).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Polyfill Element.scrollIntoView for jsdom (used by cmdk to follow active item).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Polyfill Pointer Capture for jsdom (Radix Select/Dropdown triggers call
// hasPointerCapture/setPointerCapture on pointerdown; jsdom implements none, so
// without these the Radix listbox never OPENS in tests and `role="option"`
// queries find nothing — the J-19 TimeRangePicker test failure mode).
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
}
