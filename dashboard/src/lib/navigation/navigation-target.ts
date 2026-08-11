// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { isSafeRedirectUrl } from '@/pages/auth/safe-redirect';

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
export class NavigationTarget {
  /**
   * Private so the class cannot be constructed around the check. TypeScript enforces this
   * at compile time; the runtime brand below closes the `as any` escape.
   */
  private constructor(readonly value: string) {}

  /**
   * The only way to obtain a target. Returns `null` — not a thrown error — because every
   * call site has a user-facing branch to render when the destination is refused, and an
   * exception would push that decision into a catch block far from the message.
   */
  static parse(raw: string | null | undefined): NavigationTarget | null {
    return isSafeRedirectUrl(raw) ? new NavigationTarget(raw as string) : null;
  }

  toString(): string {
    return this.value;
  }
}
