---
slug: f1-safe-navigation-boundary
items: B-138, B-214
domain: frontend-dashboard
repo: theo-cloud/dashboard
date: 2026-08-11
---

# Plan — make server-supplied navigation impossible to get wrong

## Goal

Every navigation whose destination comes from a network response goes through one boundary that
refuses an unsafe destination, and a mechanical guard fails the build if a new raw sink appears.

## Baseline context

| File | LoC | Role |
|---|---|---|
| `src/pages/auth/safe-redirect.ts` | 74 | `isSafeRedirectUrl` + `SAFE_REDIRECT_ORIGINS`. Sound; 14 tests. |
| `src/pages/auth/login.tsx` | 500 (at its budget ceiling) | sink #1 |
| `src/pages/auth/register.tsx` | ~300 | sink #2 |
| `src/pages/auth/oidc-form.ts` | 45 | sink #3 |
| `src/pages/auth/kratos.ts` | ~120 | sink #4 |
| `src/lib/auth/session.ts` | 167 | sink #5 |
| `src/pages/settings/billing.tsx` | ~560 | sinks #6, #7 |
| `src/pages/memory/exports.tsx` | ~220 | sink #8 |
| `src/pages/auth/device-verify.tsx` | ~140 | sink #9 — the one that obeys |

`login.tsx` sits **exactly at** the ceiling enforced by `login-loc-budget.test.ts`. Any solution that
adds lines there fails a guard. This is a design constraint, not a detail: the fix must *remove*
lines from call sites, not add them.

## ADRs

### ADR-1 — Parse, don't validate: the sink accepts a proof, not a string

**Decision.** Introduce a `NavigationTarget` value object. It has no public constructor; the only way
to obtain one is `NavigationTarget.parse(raw)`, which returns `null` when `isSafeRedirectUrl` refuses.
The boundary's methods accept `NavigationTarget`, never `string`.

**Rationale.** The alternative — adding `if (!isSafeRedirectUrl(x)) return;` at eight sites — is the
copy-paste convention this review exists to condemn, and it fails identically the tenth time someone
adds a sink. With a value object the type carries the proof: an unguarded string *cannot* reach the
sink, because it does not typecheck. The guard stops being something a developer must remember and
becomes something the compiler enforces.

**Alternatives rejected.** (a) Eight inline guards — restores the exact defect. (b) A runtime assertion
inside a `navigate(string)` helper — better than (a), but a `string` parameter still lets an unchecked
value in and only fails at runtime, in production, on the path least exercised.

### ADR-2 — Depend on a sink interface, not on `window`

**Decision.** `SafeNavigator` depends on a `NavigationSink` interface (`assign(url)`,
`submitForm(target, fields)`); production binds `WindowNavigationSink`, tests bind a recording fake.

**Rationale.** DIP, and a concrete testing payoff: asserting "the password was NOT submitted" against
real `window.location` in jsdom needs property redefinition that leaks across tests. A recording fake
makes the negative assertion direct — and this plan's headline test is a negative assertion.

### ADR-3 — Reuse `isSafeRedirectUrl`; do not rewrite it

**Decision.** The predicate stays where it is and keeps its tests. `NavigationTarget` calls it.

**Rationale.** Parsimony ladder rung 4. It was independently attacked during the review and held. B-214
(its CC of 14) is an auditability concern, addressed by *reading* it through one caller rather than by
rewriting a proven security predicate — rewriting it would be the riskiest possible response to a
complexity metric.

## Tasks

### T1 — `NavigationTarget` value object  (RED → GREEN → REFACTOR)

`src/lib/navigation/navigation-target.ts`

#### TDD
- `test_parse_returns_null_for_a_cross_origin_url` — `NavigationTarget.parse('https://evil.example/x')` → `null`
- `test_parse_returns_null_for_javascript_and_data_schemes`
- `test_parse_returns_null_for_protocol_relative_url` — `//evil.com`
- `test_parse_accepts_a_same_origin_path` — `/device-success` → instance whose `.value` round-trips
- `test_parse_accepts_an_allowlisted_origin` — `https://auth.usetheo.dev/self-service/...`
- `test_the_class_cannot_be_constructed_directly` — the only export path is `parse`

#### Acceptance
- No public constructor. `parse` is the sole factory.

### T2 — `NavigationSink` + `WindowNavigationSink` + `RecordingNavigationSink`

`src/lib/navigation/navigation-sink.ts`

#### TDD
- `test_window_sink_assigns_location`
- `test_window_sink_builds_a_post_form_with_the_given_fields`
- `test_recording_sink_captures_without_navigating`

### T3 — `SafeNavigator` facade

`src/lib/navigation/safe-navigator.ts`

#### TDD
- `test_go_navigates_when_given_a_target`
- `test_submit_posts_the_fields_to_the_target`
- `test_navigator_accepts_no_string_overload` (type-level: `@ts-expect-error`)

### T4 — Migrate the 8 sinks

Each call site parses once and branches to an error message on `null`. **Must not increase**
`login.tsx` LoC (ADR constraint).

#### TDD (the headline, one per credential sink)
- `test_login_refuses_a_hostile_flow_action_and_does_not_submit_the_password`
- `test_register_refuses_a_hostile_flow_action_and_does_not_submit_the_password`
- `test_oidc_form_refuses_a_hostile_action`
- `test_kratos_init_flow_refuses_a_hostile_location_header`
- `test_logout_refuses_a_hostile_logout_url_and_falls_back_to_login`
- `test_billing_portal_refuses_a_hostile_url`
- `test_billing_checkout_refuses_a_hostile_url`
- `test_memory_export_download_encodes_the_row_id`

### T5 — The mechanical guard  (this is the task that makes the fix durable)

`src/lib/navigation/navigation-boundary.test.ts`

#### TDD
- `test_no_raw_navigation_sink_assignment_outside_the_boundary` — scans `src/`, allows the boundary
  module and a small documented allowlist of literal-only navigations, fails on anything else.
- `test_the_guard_itself_detects_a_planted_violation` — the guard must be shown able to FAIL.
  Without this the guard is exactly the "test that cannot fail" the review proved four of.

## Failure scenarios

| Scenario | Expected |
|---|---|
| Kratos returns `flow.ui.action = 'https://evil.example/collect'` | form is not submitted; user sees an error naming the auth service |
| `/v1/billing/portal` returns `url: 'javascript:...'` | no navigation; existing actionable-error copy |
| Logout returns a hostile `logout_url` | falls through to `/login` (the existing fallback) |
| A developer adds a 10th raw sink | T5 fails the build |

## Drawbacks & risks

- **The allowlist becomes load-bearing.** `SAFE_REDIRECT_ORIGINS` already is; this widens its blast
  radius to billing and logout. A missing legitimate origin turns into a broken flow rather than a
  silent redirect. Mitigated by failing *closed* with a message that names the service, and by the
  fact that a broken visible flow is the failure mode we want over a silent exfiltration.
- **`memory/exports.tsx:169` is a different defect** (unencoded interpolation, not a foreign origin).
  Folded in because it is the same sink and the same fix shape, but it is honestly a lower-severity
  companion.
- **The guard's regex sees text, not semantics.** A sufficiently indirect assignment evades it. Stated
  rather than implied; the value-object typing is the primary defence and the guard is the backstop.

## Unresolved questions

- Should `SAFE_REDIRECT_ORIGINS` be derived from the CSP `form-action` list so the two cannot diverge?
  That is B-132's territory; deliberately not resolved here to keep this slice shippable.
