// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { isSafeRedirectUrl } from '@/lib/navigation/safe-redirect';

/**
 * A destination that has already been judged safe.
 *
 * ## Why a type and not a function call
 *
 * `isSafeRedirectUrl` is sound — it was attacked during the 2026-08-11 review and held.
 * What failed was the obligation to CALL it: nine sinks in `src/` hand a network-derived
 * string to `window.location.href` or `form.action`, and exactly one asked the predicate
 * first. The single site that obeys carries the comment that states the doctrine
 * (`pages/auth/device-verify.tsx:67`): a security guard that is not called is worse than
 * an absent one, because it creates the impression that the protection exists.
 *
 * Adding the call at the other eight sites would fix those eight and fail identically on
 * the ninth someone writes. So the check moves into the type: there is no public
 * constructor, `parse` is the only factory, and it returns `null` when the predicate
 * refuses. A sink whose parameter is `NavigationTarget` therefore cannot receive an
 * unchecked value — not as a runtime assertion that fires in production on the least
 * exercised path, but as a compile error at the moment the code is written.
 *
 * The predicate is reused, never reimplemented: it owns the allowlist and its 14 tests,
 * and rewriting a proven security check would be the riskiest possible response to the
 * complexity metric that B-214 records against it.
 */
/**
 * Which origins a destination CLASS may name, beyond the app's own.
 *
 * `./safe-redirect.ts` states the rule this implements, in its own words: when a
 * new kind of destination appears, the answer is a second allowlist and not a wider auth
 * one. Widening `SAFE_REDIRECT_ORIGINS` to admit the payment provider would also have let
 * a Kratos flow aim a login POST at it — a trade nobody would make on purpose.
 */
export interface NavigationPolicy {
  readonly name: string;
  readonly additionalOrigins: readonly string[];
}

/** The default: same-origin plus the canonical Theo auth hosts. */
const SAME_APP_AND_AUTH: NavigationPolicy = { name: 'same-app-and-auth', additionalOrigins: [] };

/**
 * The hosted payment provider. Used ONLY by the two billing redirects, whose destination is
 * a one-shot session url minted by the backend.
 */
export const BILLING_REDIRECT: NavigationPolicy = {
  name: 'billing-redirect',
  additionalOrigins: ['https://billing.stripe.com', 'https://checkout.stripe.com'],
};

/** The public documentation site. Reached from help affordances, never with a credential. */
export const DOCS_SITE: NavigationPolicy = {
  name: 'docs-site',
  additionalOrigins: ['https://docs.usetheo.dev'],
};

export class NavigationTarget {
  /**
   * Private so the class cannot be constructed around the check, and `__brand` above makes
   * the instance type nominal so a look-alike object literal is rejected too.
   */
  /**
   * `_value` is PRIVATE, and that is what makes the type nominal.
   *
   * TypeScript compares classes structurally unless they hold a private or protected
   * MEMBER — a private constructor makes only the static side nominal. The first draft had
   * just the constructor, and an adversarial review proved that
   * `{ value: 'javascript:alert(1)' }` was assignable to `NavigationTarget` with no cast at
   * all, while the docblock claimed a runtime brand that did not exist. A look-alike object
   * is now rejected by the compiler, which is what the rest of this file promises.
   */
  private constructor(private readonly _value: string) {}

  /** The judged destination. */
  get value(): string {
    return this._value;
  }

  /**
   * The only way to obtain a target. Returns `null` — not a thrown error — because every
   * call site has a user-facing branch to render when the destination is refused, and an
   * exception would push that decision into a catch block far from the message.
   */
  static parse(
    raw: string | null | undefined,
    policy: NavigationPolicy = SAME_APP_AND_AUTH,
  ): NavigationTarget | null {
    if (raw != null && raw.startsWith('#')) {
      // Same-document. A fragment resolves against the current url, so it cannot name
      // another origin and there is nothing to allowlist. Handled here rather than by
      // widening `isSafeRedirectUrl`, which guards ABSOLUTE destinations — a fragment is
      // not one, and loosening a proven security predicate to admit a shape it was never
      // asked about is how allowlists rot.
      return new NavigationTarget(raw);
    }
    if (isSafeRedirectUrl(raw)) return new NavigationTarget(raw as string);
    if (raw != null && policy.additionalOrigins.length > 0) {
      try {
        const u = new URL(raw);
        if (u.protocol === 'https:' && policy.additionalOrigins.includes(u.origin)) {
          return new NavigationTarget(raw);
        }
      } catch {
        // Not an absolute url; the default predicate already had its say.
      }
    }
    return null;
  }

  toString(): string {
    return this.value;
  }
}
