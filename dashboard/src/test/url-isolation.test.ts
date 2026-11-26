// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect } from 'vitest';

/**
 * B-283 — jsdom's URL is shared by every case in a file, and nothing reset it.
 *
 * ## The cause, named by measurement rather than by hypothesis
 *
 * `lens/overview.test.tsx` failed under `--sequence.shuffle` on one case, by assertion and not by
 * timeout, and passed in declaration order. Instrumenting `location.search` around every case in
 * the file showed it accumulating:
 *
 *     PROBE-IN  ""                        M60 — renders ONE shared trend chart (default …
 *     PROBE-OUT "?metric=latency"         M60 — renders ONE shared trend chart (default …
 *     PROBE-IN  "?metric=latency"         M60 — the shared chart draws one line per model
 *     PROBE-OUT "?metric=cost"            M60 — the shared chart draws one line per model
 *     PROBE-IN  "?metric=cost"            the range selector re-fetches server-side …
 *     PROBE-OUT "?metric=cost&range=7d"   the range selector re-fetches server-side …
 *
 * The failing case opens with `findByText('Throughput (traces)')` and calls it "the default
 * metric". Run after any case that left `?metric=latency` or `?metric=cost`, the page mounts on
 * the leaked metric and that text is never rendered. The case was right; its premise had been
 * revoked by whichever case happened to run before it.
 *
 * `MemoryRouter` isolates the ROUTER, which is why this looked impossible. It does not isolate
 * jsdom: nuqs's react-router adapter reads `window.location.search` at mount, and writes through
 * `history.pushState` — the real one. `src/test/render.tsx` documents that adapter behaviour
 * already; what nobody had connected is that it makes the jsdom URL shared mutable state between
 * cases.
 *
 * ## Why the fix is in the shared setup
 *
 * Every file that renders a page with `useQueryState` has this, and the ones that have not failed
 * yet differ only in which order their cases happen to run. `setup.ts` already corrects a WRONG
 * cause recorded for #187 ("a leaked location.search between test FILES") — files are isolated,
 * that reading was mistaken. Within a file they are not, and that is this.
 */
describe('the jsdom URL does not leak between cases (B-283)', () => {
  it('dirties the URL, exactly as a nuqs-backed page does', () => {
    window.history.pushState({}, '', '/?metric=cost&range=7d');
    expect(window.location.search).toBe('?metric=cost&range=7d');
  });

  it('sees a clean URL, because the case before it was reset', () => {
    // Fails without the reset in `setup.ts`: the search string above survives into here, which is
    // precisely how a page mounts on a metric no case selected.
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/');
  });
});
