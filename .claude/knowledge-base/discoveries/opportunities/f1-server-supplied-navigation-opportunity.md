---
slug: f1-server-supplied-navigation
items: B-138, B-214 (+ the F1 family)
mode: review
date: 2026-08-11
verdict: SHIPPABLE
---

# Opportunity — server-supplied navigation has a guard nobody is required to call

## Corner 1 — Evidence

MEASURED 2026-08-11 by grepping every assignment to a browser navigation sink in `src/`
(`form.action =`, `window.location.href =`) and classifying each by where its value comes from.

**Nine sinks take a value derived from a network response. One is guarded.**

| # | Site | Value comes from | Guarded |
|---|---|---|---|
| 1 | `src/pages/auth/login.tsx:230` | `flow.ui.action` (Kratos flow) — **posts `password`** | NO |
| 2 | `src/pages/auth/register.tsx:127` | `flow.ui.action` (Kratos flow) — **posts `password`** | NO |
| 3 | `src/pages/auth/oidc-form.ts:25` | `action` param, fed from `flow.ui.action` | NO |
| 4 | `src/pages/auth/kratos.ts:48` | `resp.headers.get('Location')` on a 3xx | NO |
| 5 | `src/lib/auth/session.ts:159` | `data.logout_url` (Kratos logout) | NO |
| 6 | `src/pages/settings/billing.tsx:166` | `portal.url` (`/v1/billing/portal`) | NO |
| 7 | `src/pages/settings/billing.tsx:200` | `result.url` (`/v1/billing/checkout`) | NO |
| 8 | `src/pages/memory/exports.tsx:169` | `row.id` interpolated unencoded into a path | NO |
| 9 | `src/pages/auth/device-verify.tsx:83` | `body.redirect_to` | **YES** |

The guard is `isSafeRedirectUrl` (`src/pages/auth/safe-redirect.ts:57`), fully tested
(`safe-redirect.test.ts`, 14 cases including `javascript:`, `data:`, `//evil.com`,
`https://auth-dev.usetheo.dev@evil.com`). An independent attempt to break it during the review
failed — the predicate is sound.

The defect is not the predicate. It is that **calling it is a convention**, and the one comment
in the repo that states the doctrine sits at the single site that obeys it
(`device-verify.tsx:67-70`): *"um guard de seguranca nao chamado e pior que ausente: da a
impressao de que a protecao existe."*

The review corrected its own count here: the finding said 5 sites, measurement says 8 unguarded.

## Corner 2 — Constraint relation

`unknown` — `rules/current-constraint.md` is `status = undeclared`, so no constraint is on record
to relate this to.

## Corner 3 — Blast radius

Confined to `theo-cloud/dashboard`. No other repo imports these modules; `theo-contracts` is not
touched. Within the repo the reach is the whole auth surface plus billing and memory exports.

The CSP bounds the damage today and must not be mistaken for the fix: the effective intersection of
the two shipped policies allows `form-action 'self' auth.usetheo.dev accounts.google.com github.com`.
So an attacker who controls a Kratos response cannot aim the password POST at an arbitrary host —
but two of those are third parties present for the OIDC dance, not to receive a credential, and
`'self'` permits any path on the dashboard origin. The CSP is also a second hand-maintained copy that
B-132 records as already divergent.

## Corner 4 — Verification

- A test that FAILS on the current tree: a hostile `flow.ui.action` reaches `form.submit()`.
- After the fix: the same input is refused and the user sees an error instead of a submitted form.
- A **mechanical guard** fails the build when any new raw assignment to a navigation sink appears
  outside the boundary module. Without it this reverts to a convention, which is the defect.
