// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { NavigationTarget } from './navigation-target';

/**
 * B-138 · T1 — parse, don't validate.
 *
 * The defect this closes is NOT that the safety predicate is wrong. It is sound, and an
 * attempt to break it during the 2026-08-11 review failed. The defect is that CALLING it
 * was a convention: nine sinks take a network-derived destination and exactly one asked
 * the predicate first.
 *
 * A value object moves the obligation from the developer's memory to the type system. A
 * `NavigationTarget` cannot exist unless the predicate accepted its input, so a sink that
 * accepts only `NavigationTarget` cannot be handed an unchecked string — not at runtime,
 * at compile time.
 */
describe('NavigationTarget.parse — the only way to obtain a target', () => {
  it('refuses a cross-origin url', () => {
    expect(NavigationTarget.parse('https://evil.example/collect')).toBeNull();
  });

  it('refuses the javascript: and data: schemes', () => {
    expect(NavigationTarget.parse('javascript:alert(1)')).toBeNull();
    expect(NavigationTarget.parse('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('refuses a protocol-relative url that resolves to a foreign host', () => {
    expect(NavigationTarget.parse('//evil.com')).toBeNull();
    expect(NavigationTarget.parse('//evil.com/path')).toBeNull();
  });

  it('refuses the userinfo trick that hides the real host', () => {
    expect(NavigationTarget.parse('https://auth.usetheo.dev@evil.com/x')).toBeNull();
  });

  it('refuses empty and nullish input', () => {
    expect(NavigationTarget.parse('')).toBeNull();
    expect(NavigationTarget.parse(null)).toBeNull();
    expect(NavigationTarget.parse(undefined)).toBeNull();
  });

  it('accepts a same-origin path and preserves it verbatim', () => {
    const target = NavigationTarget.parse('/device-success?simulated=1');
    expect(target).not.toBeNull();
    expect(target!.value).toBe('/device-success?simulated=1');
  });

  it('accepts an allowlisted origin and preserves it verbatim', () => {
    const raw = 'https://auth.usetheo.dev/self-service/recovery/browser';
    const target = NavigationTarget.parse(raw);
    expect(target).not.toBeNull();
    expect(target!.value).toBe(raw);
  });

  it('carries its proof: toString is the destination', () => {
    const target = NavigationTarget.parse('/billing');
    expect(String(target)).toBe('/billing');
  });
});
