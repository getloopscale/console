---
type: Runbook
title: M0 — Authentication & Onboarding — LIVE validation
description: The operator and sponsor procedure that closes the one non-autonomous gate on M0, a side-by-side browser walkthrough of sign-up, email verify and first login on dev-public.
tags: [runbook, m0, authentication, onboarding, live-validation, operator]
generated: { by: claude-opus-5/okf-export, at: 2026-08-05 }
status: stable
sources:
  - id: repo-history
    resource: docs/operations/m0-live-validation-runbook.md
    title: M0 LIVE validation runbook, at its pre-bundle path in this repository
    last_modified: 2026-07-03
---

# M0 — Authentication & Onboarding — LIVE Validation Runbook

**Purpose.** M0's DoD objective is *"sign-up → email verify → first login funcionando **LIVE no dev-public**."* The engineering for the five journeys is complete and hermetically verified (unit + component + browser-e2e + Go tests, all green, reviewed). This runbook is the **operator + sponsor** procedure that closes the one remaining, non-autonomous gate: the LIVE validation on `dev-public` per the INQUEBRÁVEL `cleanroom-up-live-test-mandate` (`loopscale/.claude/rules/cleanroom-up-live-test-mandate.md`).

> An agent cannot execute this runbook: it requires a real Cleanroom on `dev-public` and a sponsor **JUNTOS** (side-by-side) browser walkthrough. That human gate is the sole blocker to marking M0 `[x]` and advancing to **M1 — Project Lifecycle**.

## Pre-conditions (operator)

1. **Cleanroom TOTAL** on `dev-public`: `task clean:all && task setup` → `tilt up` → `task doctor` PASS (38+/0).
2. **OpenBao Shamir init** (dev-public: automated via `vault-bootstrap-dev.sh`; prod/persistent: witnessed).
3. **post-Cleanroom seeds**: `bash infra/scripts/local/seed-post-cleanroom-all.sh --verify`.
4. Kratos + Hydra + Resend courier reachable on `auth-dev.getloopscale.com`; dashboard on `app-dev.getloopscale.com`; BFF on `cloud-dev.getloopscale.com`.

## Engineering evidence already delivered (hermetic — green)

| Journey | Engineering | Hermetic evidence |
|---|---|---|
| **J-01 Login polish** | error-mapper, LoginErrorBanner, CookieBlockedAlert, NetworkRetryButton, return-to/safe-redirect sanitizers | 75 vitest + `dashboard/e2e/login.spec.ts` (3/3 browser e2e: OAuth-denial Alert, GitHub/Google autofocus+ring) |
| **J-02 Register** | `/v1/auth/me` provisioning snapshot + lazy starter-provision; `useProvisioningStatus` poll; `RegisterCompletingScreen` wired into `register.tsx` | 7 Go sqlmock + 5 hook + 4 component + 1 page test; full `go test ./...` green; **reviewed READY_TO_MERGE** |
| **J-03 Verification** | `ResendCooldownButton` (localStorage 60s cooldown); PinInput paste + auto-submit native | 6 component/page vitest + `dashboard/e2e/verification.spec.ts` (2/2) |
| **J-04 Recovery** | delivered 2026-06-05 | — |
| **J-05 Device Success** | delivered 2026-06-05 | — |

## LIVE validation — per journey (operator + sponsor JUNTOS)

For each, drive a real browser on `dev-public` with the sponsor present; capture evidence (screenshot + network `METHOD URL -> status`) per the steady-state-baseline Layer 4.

### J-01 Login (OIDC GitHub + Google)
1. `https://app-dev.getloopscale.com/login` → **Continue with GitHub** → real GitHub OAuth → redirected back, session established, lands on the dashboard.
2. Repeat with **Continue with Google**.
3. **Denial path**: start GitHub, deny consent → returns to `/login` with the honest "We couldn't sign you in." Alert (NOT a silent redirect); OIDC buttons still present for retry.

### J-02 Register (new tenant)
1. `https://app-dev.getloopscale.com/register` → sign up (new email) → after OIDC/consent, the **"Setting up your workspace"** completing screen shows while the tenant bootstraps.
2. Confirm it redirects to the app once `/v1/auth/me` reports `provisioning: active` (starter plan lazily provisioned) — verify in devtools Network: `GET /v1/auth/me` → 200 with `"provisioning":"active"`.
3. Confirm a `subscriptions` row (starter/active) exists for the new account (psql).

### J-03 Verification (email code via Resend)
1. During/after registration, the verification email is delivered by Resend (check inbox + `courier_messages`).
2. Enter the 6-digit code (or paste it — auto-distributes + auto-submits) → **Email verified**.
3. **Resend cooldown**: click "Didn't receive the email? Resend" → the button disables with a live "Resend available in Ns" countdown; reload the page → the cooldown persists (localStorage).

### J-04 / J-05
Re-confirm the 2026-06-05 LIVE validations still hold post-Cleanroom (recovery reset + device-flow).

## Sponsor JUNTOS sign-off

The sponsor confirms, side-by-side, the end-to-end funnel: **sign-up → email verify → first login** on `dev-public`. On sponsor verbatim approval, capture a steady-state baseline (`docs/operations/baselines/<date>-m0-live.md`) and mark **M0 `[x]`** in `ROADMAP.md`.

## Next roadmap item (post-M0)

On M0 close → **M1 — Project Lifecycle** (`ROADMAP.md`, depends on M0).

## Cross-references
- INQUEBRÁVEL mandate: `loopscale/.claude/rules/cleanroom-up-live-test-mandate.md`
- Steady-state baseline rule: `loopscale/.claude/rules/steady-state-baseline.md`
- M0 plans: `loopscale/.claude/knowledge-base/plans/2026-06-16-m0-j01-login-polish-plan.md` (+ j02/j03)

- Journey plans and dashboard invariants behind J-01 to J-05:
  [`governance/dashboard`](/governance/dashboard.md).

> **An agent cannot execute this runbook.** It requires a real Cleanroom on `dev-public` and a sponsor
> present side by side. It is recorded here so an agent can read what the gate is and why it is open,
> never so an agent can claim to have passed it.
