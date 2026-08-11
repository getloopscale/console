// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { RecordingNavigationSink } from './navigation-sink';
import { SafeNavigator } from './safe-navigator';

/**
 * B-138 · T3 — one seam for every server-supplied destination.
 *
 * `goTo` / `submitTo` take the RAW string and do the parse themselves, returning a boolean.
 * That looks like it re-opens the hole the value object closed, and it does not: the parse is
 * unconditional and internal, so there is no path through this class that reaches a sink
 * without it. What the boolean buys is that each call site keeps its own user-facing message
 * — refusing a destination is a thing the user must be told about, and the copy differs
 * between "the auth service returned an unexpected target" and "failed to open the billing
 * portal". A thrown error would have collapsed those into one catch block far from the copy.
 */
describe('SafeNavigator', () => {
  it('navigates when the destination is judged safe', () => {
    const sink = new RecordingNavigationSink();
    const nav = new SafeNavigator(sink);

    expect(nav.goTo('/device-success')).toBe(true);
    expect(sink.assignments).toEqual(['/device-success']);
  });

  it('refuses a hostile destination and does NOT touch the sink', () => {
    const sink = new RecordingNavigationSink();
    const nav = new SafeNavigator(sink);

    expect(nav.goTo('https://evil.example/collect')).toBe(false);
    expect(sink.assignments).toEqual([]);
  });

  it('submits the fields when the action is judged safe', () => {
    const sink = new RecordingNavigationSink();
    const nav = new SafeNavigator(sink);

    expect(nav.submitTo('/login', { method: 'password', password: 'hunter2' })).toBe(true);
    expect(sink.submissions).toEqual([
      { action: '/login', fields: { method: 'password', password: 'hunter2' } },
    ]);
  });

  it('refuses a hostile action and never lets the credential reach the sink', () => {
    const sink = new RecordingNavigationSink();
    const nav = new SafeNavigator(sink);

    expect(nav.submitTo('https://evil.example/collect', { password: 'hunter2' })).toBe(false);
    expect(sink.submissions).toEqual([]);
    // The assertion that matters: the secret is nowhere in what the sink observed.
    expect(JSON.stringify(sink)).not.toContain('hunter2');
  });

  it('reports failure when the sink itself throws, instead of letting it escape', () => {
    // The pre-boundary code wrapped `form.submit()` in a try/catch for "DOM/CSP edge cases"
    // — a real path: a `form-action` violation makes the browser throw. Removing that
    // try/catch while migrating would have turned a handled error into an unhandled one,
    // and the login page would show nothing at all instead of its network-error alert.
    // The boundary owns this now, so the site keeps ONE branch for both failure modes
    // rather than a guard plus a try/catch.
    const throwing = {
      assign() { throw new Error('CSP violation'); },
      submitForm() { throw new Error('CSP form-action violation'); },
      openInNewTab() { throw new Error('popup blocked'); },
    };
    const nav = new SafeNavigator(throwing);

    expect(() => nav.goTo('/billing')).not.toThrow();
    expect(nav.goTo('/billing')).toBe(false);
    expect(() => nav.submitTo('/login', { password: 'x' })).not.toThrow();
    expect(nav.submitTo('/login', { password: 'x' })).toBe(false);
    expect(() => nav.openInNewTab('/docs')).not.toThrow();
    expect(nav.openInNewTab('/docs')).toBe(false);
  });

  it('refuses a null or absent destination rather than navigating to the empty string', () => {
    const sink = new RecordingNavigationSink();
    const nav = new SafeNavigator(sink);

    expect(nav.goTo(null)).toBe(false);
    expect(nav.goTo(undefined)).toBe(false);
    expect(sink.assignments).toEqual([]);
  });
});
