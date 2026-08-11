// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { BILLING_REDIRECT, NavigationTarget } from './navigation-target';

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

  it('accepts a same-document fragment', () => {
    // A fragment posts to the CURRENT url — same-origin by construction, nothing to
    // exfiltrate. It is accepted here rather than by widening `isSafeRedirectUrl`, because
    // that predicate guards absolute destinations and a fragment is not one.
    //
    // This is not a convenience: `lib/mocks/dev-mocks.ts` serves `action: '#mock-submit-login'`
    // precisely BECAUSE `form.submit()` is a real navigation and not a fetch the mock can
    // intercept. The fragment is what keeps mock login on the page. Refusing it would have
    // broken the dev flow while the production flow stayed green — the worst shape of
    // regression, because nobody sees it until they try to work.
    const target = NavigationTarget.parse('#mock-submit-login');
    expect(target).not.toBeNull();
    expect(target!.value).toBe('#mock-submit-login');
  });

  it('still refuses a fragment that is not the whole destination', () => {
    expect(NavigationTarget.parse('https://evil.example/#x')).toBeNull();
  });

  it('refuses the billing provider under the default policy', () => {
    expect(NavigationTarget.parse('https://billing.stripe.com/session/abc')).toBeNull();
  });

  it('accepts the billing provider ONLY under the billing policy', () => {
    // `safe-redirect.ts` states the rule this follows, in its own words: when a new
    // destination class appears, the answer is a second allowlist, NOT loosening the auth
    // one. Widening `SAFE_REDIRECT_ORIGINS` would have let a Kratos flow redirect a login
    // POST to Stripe, which is not a trade anyone would make deliberately.
    const t = NavigationTarget.parse('https://billing.stripe.com/session/abc', BILLING_REDIRECT);
    expect(t).not.toBeNull();
    expect(t!.value).toBe('https://billing.stripe.com/session/abc');
  });

  it('the billing policy still refuses an arbitrary host', () => {
    expect(NavigationTarget.parse('https://evil.example/x', BILLING_REDIRECT)).toBeNull();
  });

  it('carries its proof: toString is the destination', () => {
    const target = NavigationTarget.parse('/billing');
    expect(String(target)).toBe('/billing');
  });
});

/**
 * The BLOCKER an adversarial review found in the first draft, pinned so it cannot come back.
 *
 * The class had only a private CONSTRUCTOR, which makes just the static side nominal.
 * TypeScript still compared instances structurally, so this object literal was assignable to
 * `NavigationTarget` with no cast — while the docblock claimed a runtime brand that was never
 * written. The design's central promise ("a sink cannot receive an unchecked value, as a
 * compile error") was false for the exact shape an attacker would use.
 */
describe('NavigationTarget is nominal, not structural', () => {
  it('rejects a look-alike object literal at compile time', () => {
    // @ts-expect-error a plain object is NOT a NavigationTarget — this line failing to error
    // means the private member was removed and the guarantee is gone.
    const forged: NavigationTarget = { value: 'javascript:alert(document.cookie)' };
    expect(forged).toBeDefined();
  });
});
