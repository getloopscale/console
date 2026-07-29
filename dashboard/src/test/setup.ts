import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

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
