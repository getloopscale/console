import { useEffect, useRef } from 'react';

export type OIDCProvider = 'github' | 'google';

/**
 * loopscale#140 — completes an OIDC click that arrived BEFORE the login flow resolved.
 *
 * `submitOIDC` cannot POST without a flow id and a CSRF token, so a click landing before the flow
 * used to start a new flow and return. That silently DISCARDED the click: no error, no spinner, no
 * navigation. The user saw the page re-render (the new flow arriving) and nothing else, and
 * concluded the button was broken.
 *
 * Extracted out of `login.tsx` rather than inlined there, because `login-loc-budget.test.ts` exists
 * precisely to stop that page re-inflating: "a refactor that re-inflates it — inlining error
 * rendering or redirect logic back into the page instead of a component — fails here and forces the
 * split to be kept." Raising the budget would have removed the guard instead of honoring it.
 *
 * A ref, not state: the pending provider is never rendered, and it must be readable by the effect
 * without inserting a render cycle between the flow landing and the submit.
 */
export function usePendingOIDC(
  flow: unknown,
  submit: (provider: OIDCProvider) => void,
): { remember: (provider: OIDCProvider) => void } {
  const pending = useRef<OIDCProvider | null>(null);

  // `submit` is redefined on every render of the page, so depending on it would re-run this effect
  // without the flow having changed. The ref guard — cleared BEFORE submitting — is what makes the
  // run at-most-once per pending click, and it is also what stops a later flow refresh re-firing a
  // stale provider and bouncing the user to an OIDC redirect they did not ask for.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    const provider = pending.current;
    if (!flow || !provider) return;
    pending.current = null;
    submitRef.current(provider);
  }, [flow]);

  return {
    remember: (provider: OIDCProvider) => {
      pending.current = provider;
    },
  };
}
