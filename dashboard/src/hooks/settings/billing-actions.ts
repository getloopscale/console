import { cloudFetch } from '@/lib/http/api';

/**
 * The two Stripe hand-offs, as plain async functions rather than mutations.
 *
 * Deliberate: the billing screen drives both from an imperative handler with its own in-flight ref,
 * its own error copy and a same-window navigation, and wrapping them in `useMutation` would buy
 * cache integration that neither one has any use for — nothing on this page is invalidated by a
 * redirect off it. What B-244 asks for is that the transport stop living in the page; this is that,
 * and nothing more.
 *
 * Both opt into `throwOnError`, and each for a reason that was paid for in a bug:
 *
 *  - **Portal** (theo-cloud#49/#69): in the default `T | null` mode a non-2xx — the canonical case
 *    being a Free-tier visitor with no Stripe subscription to manage — returned `null` silently and
 *    the button looked like a no-op.
 *  - **Checkout** (theo-cloud#63): a non-2xx such as `503 BILLING_NOT_CONFIGURED` has to surface an
 *    `ApiError` carrying the server's actionable body, so the UI renders the operator's message
 *    verbatim instead of a generic "please try again" that invites retry for a condition retry
 *    cannot fix.
 *
 * Both still return `T | null` to the caller, because `throwOnError` only rules out the non-2xx: a
 * 2xx with no `url` remains possible and is a contract gap the page keeps a safety net for.
 */
export function openBillingPortal(): Promise<{ url: string } | null> {
  return cloudFetch<{ url: string }>('/v1/billing/portal', undefined, { throwOnError: true });
}

export function startCheckout(plan: string): Promise<{ url: string } | null> {
  return cloudFetch<{ url: string }>(
    '/v1/billing/checkout',
    { method: 'POST', body: JSON.stringify({ plan }) },
    { throwOnError: true },
  );
}
