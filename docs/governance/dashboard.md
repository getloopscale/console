---
type: Governance Mandate
title: Dashboard Governance
description: The locked mandates, architectural invariants and sponsor priority chain that any change to the LoopConsole dashboard must respect.
tags: [dashboard, governance, mandate, journeys, invariants]
generated: { by: claude-opus-5/okf-export, at: 2026-08-05 }
status: stable
sources:
  - id: repo-history
    resource: docs/dashboard-governance.md
    title: Dashboard Governance, at its pre-bundle path in this repository
    last_modified: 2026-06-16
---

# Dashboard Governance (migrated from the engine at M5)

> **Provenance:** These mandates were authored in `loopscale/CLAUDE.md` (the engine
> repo's root contract) while the dashboard lived at `loopscale/cloud/dashboard/`. The
> dashboard was extracted into THIS repository (`loop-console`) at M4 of the monorepo
> decomposition; this file is where its governance now lives (M5 Phase 4). The
> engine `loopscale/CLAUDE.md` retains only a pointer to this file — it no longer
> governs dashboard code it does not contain.
>
> Historical journey-delivery plans + baselines remain in the engine's
> `loopscale/.claude/knowledge-base/` (preserved per the M5 ADR "preserve historical
> audit trail"). Paths below that read `cloud/dashboard/...` are now
> `dashboard/...` in this repository (the `cloud/` prefix was the monorepo layout).

---

## GO-TO CTO mandate: Dashboard Memory Section expansion (locked 2026-06-06)

> **Read this BEFORE any commit touching `cloud/dashboard/src/pages/memory/`, `cloud/dashboard/src/pages/api-keys.tsx`, `cloud/internal/routes/memory_*.go`, `cloud/internal/routes/api_keys.go`, `cloud/internal/auth/scope.go`, or migrations creating `loop_runtime_api_keys` / `webhooks` / `memory_exports` tables.**

**Authorization:** project-owner mandate via `/grill-me` session 2026-06-06 (8 strategic + 2 housekeeping decisions resolved sequentially). The mandate authorizes a 5-plan sequential journey adding a unified Memory section to LoopConsole Dashboard, integrating the OSS `@getloopscale/memory` REST server as a managed-runtime consumer through a Go proxy.

**Source of truth (DO NOT re-derive these decisions ad-hoc — every PR cites the doc that locks them):**

- **ROADMAP (single source of truth for chain + cadence + per-plan scope/DoD/time-window)**: `.claude/knowledge-base/plans/2026-06-06-dashboard-memory-section-roadmap.md`
- **Strategic decisions** (8 A1-A8): `.claude/knowledge-base/architecture/dashboard/memory-section-prior-art-2026-06-06.md`
- **Plan 0 (first in chain — Platform API Keys with scopes)**: `.claude/knowledge-base/plans/2026-06-06-platform-api-keys-with-scopes-plan.md`

**Inviolable architectural invariants (any commit violating these must be reverted OR re-classified via new ADR with project-owner sign-off):**

1. **Memory section lives in `cloud/dashboard/src/pages/memory/`** — NOT a microservice, NOT a separate sibling app, NOT in any OSS repo. The dashboard is the closed-source commercial differentiator (lock-in posture is intentional + declared).
2. **Multi-tenancy = M1 shared cluster + `owner_user_id` discriminator on every row of every memory-touching query.** Per-tenant isolation (M2) is OUT OF SCOPE at v0.1. Cross-tenant DELETE returns **404 NOT 403** (existence-leak prevention).
3. **Auth = B1 Go proxy.** `cloud/internal/routes/memory_*.go` holds the master `THEMEMORY_API_KEY` env var. Customer NEVER sees TheMemory key. Customer auth at the public surface is the unified `theo_live_*` API key (Plan 0) with scopes. At v0.1, the OSS TheMemory remains tenant-unaware in schema — Go enforces tenant scope via **URL path scope params** `/v1/scopes/<type>/<owner_user_id>/...` propagated on every upstream call (empirical mechanism per OSS `src/server/handlers/scopes.ts`). The original mandate text said "X-Theo-User-Id header propagation"; this was a precision drift in the narrative — the INVARIANT (Go enforces tenant scope; OSS schema stays tenant-unaware) remains binding, only the mechanism description is corrected. Updated 2026-06-06 per plan `2026-06-06-memory-api-for-agents-mem0-parity-plan.md` T0.1 + ADR `decisions/2026-06-06-memory-api-tenant-propagation-url-path.md`.
4. **API key = unified `theo_live_{base64url(32)}` WITH scopes.** Industry-canonical (Stripe/GitHub fine-grained PAT/Slack/OpenAI convergence). SHA-256 hash NOT bcrypt. Scope enum v0.1: `memory:read|write|delete|admin`; reserved (returns 503 if attempted) `rag:*|traces:*|agents:*|deploys:*`. Per-service keys + OAuth client_credentials = REJECTED at v0.1 (YAGNI).
5. **Surface overlap = HYBRID γ.** 6 NEW pages under `/memory/`, 3 PROMOTIONS to existing `/billing` + `/audit` + `/settings` (memory section/tab/filter), 1 DROP (Install — `loopscale init` CLI + docs cover this), 1 SEPARATE platform `/api-keys` (NOT memory-scoped — covers all future verticals).
6. **OSS demo at `examples/chat-with-memory/`** stays as standalone LoopZero-native single-tenant demo. NOT the production dashboard. OSS consumer's UI story = CLI + REST + that demo. Production dashboard = PaaS-only differentiator.
7. **DESIGN.md v1.0 compliance is mandatory per memory page.** 5Q-3s rule + production-vs-staging badge + danger zone choreography (`<DangerZone>` + `<ConfirmDialog>` with impact paragraph + reversibility + typed confirmation phrase). NO `variant="primary"` on destructive memory actions (forget / API key revoke / webhook delete / export delete).
8. **No literal "Mem0" / "mem0" / `app.mem0.ai` mentions in src/ or test/** — `loop-console/loopscale/cloud/dashboard/` honors the same paper/marketing-name policy that OSS sibling honors. Branding stays "TheMemory" everywhere customer-facing.

**Chain order (DO NOT ship out of order without explicit re-prioritization ADR):**

See the ROADMAP doc § "Chain at a glance" for the visual chain. Summary:
`P0 (foundation) → P1 (shell) → (P2 + P3 parallel) → P4 (cross-cuts)`. Per-plan scope + DoD + time-window + cadence live ONLY in the roadmap; this CLAUDE.md section locks the INVARIANTS only, not the scope detail (single source of truth — anti-drift).

**Edge-case absorptions locked across all 5 plans** (every PR must respect; see prior-art doc § Edge case absorptions for canonical wording):

- Empirical pre-flight on every new surface (e.g., `curl /v1/api-keys/list` BEFORE authoring CRUD UI to validate Go route exists)
- Async middleware writers via `go func() { ... }()` AFTER response write — NEVER block hot-path; p95 delta ≤ 5ms with/without
- API key generation: `crypto/rand.Read(32)` NEVER `math/rand`; SHA-256 hash NEVER bcrypt
- Create API Key dialog: Close button DISABLED until checkbox "I've copied my key safely" checked
- Webhook page renders persistent `<Alert intent="warning" title="Demo only">` at TOP of page (NOT footer)
- Memory export filename = `export-${randomUUID()}.json` server-generated — NEVER trust client-supplied filename
- Every listing query filters by `WHERE owner_user_id = ctx.session.userId`

**OSS sibling P0 freeze posture (informational; honest disclosure):** The OSS `@getloopscale/memory` repository has its own PRIORITY 0 hardening lock (locked there 2026-06-04) scoped to its 3 sub-goals (APIs correct / SDK functional / MCP available). Adding LoopConsole Dashboard's Memory section does NOT change OSS TheMemory's P0 closure criteria — the dashboard ship is **parallel work** that empirically validates the public REST + scopes + Bearer auth surface at customer scale. Engineering teams coordinating across the two repos must treat the dashboard as a high-fidelity SDK consumer, NOT as a substitute for OSS `/dogfood` evidence collection.

**When this mandate may change:** Only via explicit ADR signed by project owner. Any PR that softens an invariant above (renames a scope, lifts the M1 shared-tenancy model, exposes TheMemory key to customer, etc.) MUST cite the ADR. The grill-me session of 2026-06-06 is the foundational record; any subsequent change layers ADRs on top — never erases the original mandate.

## Dashboard Journeys — 20 plans formalizados (locked 2026-06-06)

> **Read this BEFORE editing any file under `cloud/dashboard/src/pages/` OR adding a new dashboard route — every journey already has a formal plan that locks decisions.**

**Authorization:** project-owner directive 2026-06-06 — "Spawn TODOS os planos formais pendentes em escopo grande para centralizar decisões de design comuns." Resultado: 20 plans cobrindo TODAS as dashboard journeys ainda abertas (J-01..J-24, exceto J-04/J-05/J-09/J-17 já delivered).

**Source of truth (DO NOT re-derive decisions ad-hoc — every PR cites the plan that locks them):**

- **ROADMAP (sequência P0/P1/P2 + dependency graph + lessons-learned J-17):** `docs/handoff/2026-06-05-dashboard-vercel-like-integration-roadmap.md` § 8
- **20 planos individuais** em `.claude/knowledge-base/plans/2026-06-06-dashboard-journey-j{NN}-{slug}-plan.md`:

| Prioridade | Journey | Esforço | Plano |
|---|---|---:|---|
| P0 | J-06 Overview | 12h | `j06-overview-plan.md` |
| P0 | J-07 Projects List ✅ DELIVERED 2026-06-08 | 14h | `j07-projects-list-plan.md` + closed-via `2026-06-08-dashboard-screens-review-fixes-plan.md` T5.3 sponsor walkthrough commit `6f8f50b6` verbatim "Ficou ótimo, parabens!" |
| P0 | J-08 Project Detail Overview ✅ DELIVERED 2026-06-08 | 10h | `j08-project-detail-overview-plan.md` + closed-via same dashboard-screens-review-fixes T5.3 (cd603c7b derive metrics from builds[] + 898e3e85 enriched summary endpoint) |
| P0 | J-13 Billing (Stripe parity) | 12h | `j13-billing-stripe-parity-plan.md` |
| P0 | J-18 Status / Runtime Health | 20h | `j18-status-runtime-health-plan.md` |
| P0 | J-19 Runtime Logs Streaming | 21h | `j19-runtime-logs-streaming-plan.md` |
| P0 | J-20 Scale ✅ DELIVERED 2026-06-15 | 18h | `j20-scale-plan.md` v1.1 SHIPPABLE 96.4 → v0.16.0 (Vercel-style `/projects/:name/scale` page with 4 canonical components (ScaleSlider + HPAToggle + KEDAToggle + ScaleConfirmDialog) + 2 hooks (useScale + useScaleCost); server-side enforcement at handler boundary: `pkg/enforcement.AssertKEDAAllowed` 402 PLAN_UPGRADE_REQUIRED + `AssertHPATargetBounds` 400 HPA_TARGET_OUT_OF_BOUNDS structured body + `ComputeMonthlyCost` server-authoritative `monthly_cost_usd`; 44 NEW hermetic tests + 0 regressions; T5.3 LIVE bash + T5.4 sponsor JUNTOS walkthrough deferred per ADR D5 `cleanroom-up-live-test-mandate.md` INQUEBRÁVEL — closed on next operator session) |
| P0 | J-21 Readiness Score ✅ DELIVERED 2026-06-15 | 14h | `j21-readiness-plan.md` v1.1 SHIPPABLE 94.0 → v0.17.0 (Vercel-style `/projects/:name/readiness` page; 8 signals composing existing foundation-first hooks into weighted 0-100 score; tristate Pass/Fail/Unknown per EC-2 absorption — canonical fix for J-18 v0.15.0 empty-signals-leak-distress bug family — Unknown excluded from score numerator AND denominator; 4 canonical components (ScoreCard + Checklist + FAQ + deep-link drawer); ADR D3 a11y mapping locked; legacy v0 DELETED per Unbreakable Rule; 18+ NEW hermetic tests + 0 regressions; T4.3 LIVE bash + Final Phase sponsor JUNTOS walkthrough deferred per ADR D5 `cleanroom-up-live-test-mandate.md` INQUEBRÁVEL — closed on next operator session; CLOSES foundation-first chain engineering-side) |
| P0 | J-22 Secrets CRUD ✅ DELIVERED 2026-06-11 | 19h | `j22-secrets-crud-plan.md` + `2026-06-10-j22-openbao-transit-eso-sync-plan.md` v1.2 + `2026-06-10-j22-layer2-code-review-fixes-plan.md` v1.1 |
| P0 | J-23 Previews (per-PR) ✅ DELIVERED 2026-06-07 | 25h | `j23-previews-plan.md` + refactor-via `2026-06-07-preview-as-category-single-slot-plan.md` (Netlify-style); 8 commits 2026-06-07 closing 9 LIVE bugs in sponsor-guided regression test session; dogfood-preview 9/9 PASS; cross-ref [[reference_j23_batch_2026_06_07]] |
| P0 | J-24 Configuration (Monaco) | 24h | `j24-configuration-plan.md` |
| P0 | J-25 Live URL Discoverability ✅ DELIVERED 2026-06-12 | 8h | `2026-06-12-dashboard-journey-j25-live-url-discoverability-plan.md` v1.2 SHIPPABLE 100.0 + FAANG canonical refactor closing T6.2 addendum catches #21+#22 via 5 commits (`f2d2106c` helmfile dev-public BASE_DOMAIN per-env + `46186e52` values-dev BASE_DOMAIN 4-layer Tilt-canonical + `6a3815e2` Caddyfile `*.prod-dev.getloopscale.com` wildcard + `bfb21e0f` `pkg/naming.AppURL`/`AppHostname` canonical builder DRY (status.go + renderer_helpers delegate) + `6feb31e7` entry-app resolver prefers server over static-frontend); 11/11 hermetic helm gate + 6/6 resolver test + Cleanroom TOTAL ~34min + sponsor LIVE browser walkthrough JUNTOS validated canonical chain (CF DNS wildcard → Caddy `*.prod-dev.getloopscale.com` → Host rewrite `<sub>.loopscale.local` → Traefik) |
| P1 | J-01 Login polish | 12h | `j01-login-polish-plan.md` |
| P1 | J-02 Register | 13h | `j02-register-plan.md` |
| P1 | J-03 Verification | 8h | `j03-verification-plan.md` |
| P1 | J-10 Environments ✅ DELIVERED 2026-06-07 | 12h | `j10-environments-plan.md` + baseline `docs/operations/baselines/2026-06-06-j10-delivery-engineering.md` (sponsor manual end-to-end CLOSED 2026-06-07 addendum) |
| P1 | J-11 Domains ✅ DELIVERED 2026-06-15 | 10h | `j11-domains-plan.md` v1.1 SHIPPABLE 93.2 → v0.18.0 (Vercel-style /domains polish; 4 NEW components + 1 NEW hook with terminal-set LOCKED + document.hidden pause; ADR D6 backend already shipped per recon — saved 3h via Phase 1 DONE pre-implementation; ADR D7 rate-limit + ref-based debounce LOCKED; reuses canonical useVerifyDomain; 20 NEW vitest + 19 hermetic; T4.2 LIVE bash + Final Phase sponsor JUNTOS walkthrough deferred per ADR D5 INQUEBRÁVEL; J-21 custom_domain signal Unknown → Pass/Fail real destravado) |
| P1 | J-12 Team RBAC | 17h | `j12-team-rbac-plan.md` |
| P1 | J-15 Profile | 15h | `j15-profile-plan.md` |
| P1 | J-16 Settings workspace | 14h | `j16-settings-workspace-plan.md` |
| P2 | J-14 Audit Log | 8h | `j14-audit-log-plan.md` |

**Total: 20 plans, 3.268 LOC, ~280h delivery agregado.**

**Inviolable patterns inherited from J-17 (any plan above MUST respect — see roadmap § 8 lessons-learned):**

1. **Marker-based log filtering (4-layer)** — Promtail labels + Argo wrap + LogQL filter + Frontend parser. Reutilize para J-19 runtime logs e qualquer journey com structured logs.
2. **Terminal status é absorvente em stream reducers** — succeeded/failed/cancelled NUNCA regridem para running via SSE replay. Aplicar em J-18 health, J-19 log levels, J-20 scale state, J-21 readiness gates, J-23 preview lifecycle.
3. **useEffect deps refletindo lifecycle transitions** — `[id]` não basta; adicionar `isTerminal`, `isHealthy`, `isReady` quando conteúdo muda BETWEEN id changes.
4. **Empty failure logs são bug de produto** — capturar stdout/stderr via tee + replay 50 últimas linhas como markers em error path (pattern em `api/internal/argo/loopscale_log.go`).
5. **REST + SSE coexistem; Refresh manual obrigatório** — TODA página com SSE expõe Refresh button (RefreshCw + animate-spin durante isFetching).
6. **Backend dirige UX paginação desde dia 1** — endpoint que retorna lista DEVE retornar `total`; UI ganha "Showing N of M" + "Load more" em 30 LOC. Cap server-side 50/request.
7. **LIVE bash test é a ÚNICA defesa contra regressão de infra SSE/Caddy** — cada plan tem `infra/tests/e2e/dev-public-<journey>-flow_test.sh` + companion hermetic.
8. **Dogfood wrapper aggregator é canonical** — `infra/scripts/local/dogfood-<journey>.sh` agrega 4-7 suites. Wire em `taskfiles/test.yml`.
9. **JWT TTL ~12-60min — testes LIVE devem aceitar injeção** — env var ou arquivo `~/.loopscale/local-dogfood-token.txt`.
10. **Sponsor scope-extension verbatim approval** — quando governance-gate bloqueia edit cross-domain (api/ + cloud/ + infra/ na mesma feature), estender escopo em `.claude/governance-gate.local.md` citando verbatim a autorização. Pattern J-09 + J-17.

**Plan structure (CADA um dos 20 planos segue exatamente esta forma):**

- Context (Estado HOJE + Gaps específicos)
- Objective (DoD LIVE end-to-end em dev-public)
- ADRs (3-6 decisões de design + rationale)
- Phases 4-7 com tasks granulares T0.1..TN.N
- Coverage Matrix (gap → task mapping)
- Global DoD (vitest GREEN + LIVE bash + dogfood wrapper + manual sponsor)
- Edge cases summary (6-15 EC-N)
- Lessons-learned referência (12 patterns J-17)
- Final Phase Dogfood QA (mandatory)

**Implementation directive:** Quando spawnar `/implement` para qualquer dos 20 planos:
- Plan está em estado SHIPPABLE_WITH_CAVEATS (não precisa re-validar com `/plan-confidence`)
- Halt-loop pode rodar via `ralph-loop:ralph-loop` com `<promise>` = "PLAN_<JNN>_COMPLETE" gated por DoD do plano
- Dogfood wrapper canonical executa antes do final `<promise>`
- Sponsor LIVE manual gate (browser test em dev-public) é HARD STOP para emit promise

**When these plans may change:** Plans podem evoluir via "Plan amendment policy" (`.claude/rules/pre-release-governance.md` § Plan Amendment Policy). DoD redefinition + Task deferral + Plan abandon exigem MEET record + new ADR + plan version bump. Trivial + Scope refinement seguem direct edit + commit explicando.

**Delivered (histórico canonical — ordem cronológica de sponsor closure):**

| Journey | Closure date | Evidência (baseline / plano arquivado) |
|---|---|---|
| **J-04 Recovery** | pré-2026-06-06 (auth chain pre-baseline-rule) | Plano arquivado `2026-06-05-dashboard-journey-j04-recovery-plan.md`; citado em CLAUDE.md narrative linha 68 "já delivered" |
| **J-05 Device Success** | pré-2026-06-06 (auth chain pre-baseline-rule) | Plano arquivado `2026-06-05-dashboard-journey-j05-device-success-plan.md`; cross-ref [[reference_hydra_v2_device_flow_complete_chain_2026_06_05]] |
| **J-09 Project Connect** | pré-2026-06-06 (GitHub App + auto-deploy chain) | Plano arquivado `2026-06-05-dashboard-journey-j09-project-connect-plan.md`; cross-ref [[reference_j09_live_e2e_complete_2026_06_06]] + [[reference_github_app_credentials_chain_2026_06_06]] |
| **J-17 Deployments Realtime** | 2026-06-06 | Baseline `docs/operations/baselines/2026-06-06-post-merge-pre-j10.md` (capturado "post J-17 delivery + post-merge validation chain") |
| **J-10 Environments** | 2026-06-07 sponsor manual end-to-end | Baseline `docs/operations/baselines/2026-06-06-j10-delivery-engineering.md` (Update "✅ CLOSED 2026-06-07" addendum: create env via UI + 402 modal + list refresh + ADR D5 strict CRD separation; 4 LIVE-caught fixes shipped during sponsor session) |
| **J-23 Previews (per-PR)** | 2026-06-07 sponsor-guided regression test session | Plano refactor `2026-06-07-preview-as-category-single-slot-plan.md` (Netlify-style); 8 commits closing 9 LIVE bugs (`5a8132fc` RBAC+migration+SA+wildcard TLS + `01e7f185` canonical destination + `97d82a68` dogfood wrapper + `a9d6c431` RBAC+watcher + `e682e4d4` cleanup by label + `b21e9446` orphan prune + `347fdbc0` health endpoint); canonical formula locked `loopscale-<tenant>-<project>-<env>`; preview URL `<tenant>-<project>-<entryApp>-preview-pr-N.preview-dev.getloopscale.com`; dogfood-preview 9/9 PASS; cross-ref [[reference_j23_batch_2026_06_07]] |
| **J-07 Projects List** | 2026-06-08 sponsor walkthrough verbatim "Ficou ótimo, parabens!" | Plano `2026-06-08-dashboard-screens-review-fixes-plan.md` T5.3 commit `6f8f50b6` (scope cita `cloud/dashboard/src/pages/projects.tsx` 6 findings + `0d854f79` T2.1 additive last_deploy+apps_count+latest_framework + `c32214d0` T4.2 /projects 6 findings wire + `eee3e270` T4.5 Load more + ee516de6 T-MIG-3 page → DataTable) |
| **J-08 Project Detail Overview** | 2026-06-08 sponsor walkthrough verbatim "Ficou ótimo, parabens!" | Plano `2026-06-08-dashboard-screens-review-fixes-plan.md` T5.3 commit `6f8f50b6` (scope cita `cloud/dashboard/src/pages/project-detail.tsx` + `cd603c7b` derive metrics from useDeployments builds[] + `898e3e85` enriched summary endpoint env_count+apps_count+last_deploy_* + `61d5148b` builds list canonical apps[] source) |
| **J-22 Secrets CRUD** | 2026-06-11 sponsor verbatim "Confirmado" | Baseline `docs/operations/baselines/2026-06-11-j22-layer2-LIVE-walkthrough-green.md` (JOURNEY DELIVERY LIVE-GREEN end-to-end; broker round-trip 7ms 138× under SLO; ExternalSecret CR SecretSynced=True; K8s Secret materialized with correct plaintext) |
| **J-25 Live URL Discoverability** | 2026-06-12 sponsor LIVE walkthrough JUNTOS — verbatim `https://tn-a22685191fb60b8f-j25demo-api-production.prod-dev.getloopscale.com/ → 404 page not found` confirmou canonical chain end-to-end | Plan `2026-06-12-dashboard-journey-j25-live-url-discoverability-plan.md` v1.2 + closing dos T6.2 addendum catches #21 (preview-operator BASE_DOMAIN=loopscale.local) + #22 (loop-runtime-api PR check URL hardcoded). FAANG canonical fix replaced v1 patch-the-symptom (bending BASE_DOMAIN to carry public wildcard, which broke IngressRoute Host match) com canonical BASE/PUBLIC split: BASE_DOMAIN=loopscale.local (cluster-internal SNI for IngressRoute Host) + LOOPSCALE_PUBLIC_DOMAIN=prod-dev.getloopscale.com (wildcard root composed into status.url via `pkg/naming.AppURL`). 5 commits: `f2d2106c` helmfile overlay + `46186e52` values-dev Tilt-canonical + `6a3815e2` Caddyfile wildcard block (DNS-01 via CF) + `bfb21e0f` `pkg/naming` builder DRY (mirror of T2.5 `PreviewSubdomain`/`PreviewURL`) + `6feb31e7` entry-app 2-pass resolver (prefer server > non-static frontend, skip `rendering=static` CF Worker delivery apps). 11/11 hermetic helm gate locks canonical state against regression (A2/A3 BASE/PUBLIC split + A5/A5b status.go DRY delegation + A6 renderer_helpers DRY + A7/A8 4-layer Tilt-consumed values-dev canonical + A9/A10 Caddy wildcard block + Host rewrite). 6/6 resolver tests lock the exact LIVE-caught fixture (web-static FIRST + api-server SECOND must return "api"). Cleanroom TOTAL ~34min canonical survival validated. Sponsor LIVE walkthrough JUNTOS per `.claude/rules/cleanroom-up-live-test-mandate.md` INQUEBRÁVEL closed engineering-side + sponsor-side. Memorias canonical: `feedback_post_cleanroom_kratos_patch_dev_public` + `feedback_post_cleanroom_seed_admin_canonical` capturam os 2 gaps Cleanroom dev-public que requerem manual operator steps pós-`task setup`. |
| **J-20 Scale** | 2026-06-15 (engineering side; sponsor JUNTOS LIVE walkthrough on next operator session per ADR D5) | Plan `2026-06-06-dashboard-journey-j20-scale-plan.md` v1.1 SHIPPABLE 96.4 → v0.16.0. 8 atomic commits: T1.2+T1.3 `pkg/enforcement/scale.go` (KEDA tier gate + HPA bounds + monthly cost) + T1.1 api handler 402/400 wire + `pkg/errors` factories (`NewPlanUpgradeRequired` + `NewHPATargetBoundsViolated`) + T2.1+T2.2 hooks (`useScale` + `useScaleCost`) + T3.1-T3.4 4 UI components (`ScaleSlider` + `HPAToggle` + `KEDAToggle` + `ScaleConfirmDialog` reusing canonical `@/components/dialogs/confirm-dialog` per DRY rule of three) + T4.1 page composition `/projects/:name/scale`. 44 NEW hermetic tests + 0 regressions; `/code-quality` PASS; `/review` READY_TO_MERGE (0 BLOCKER + 0 HIGH + 1 MEDIUM with documented mitigation F-infra-1 `TargetMemoryPct` end-to-end propagation deferred — handler-boundary VALIDATION canonical; 4 LOW including 3 operator HARD STOPs per `cleanroom-up-live-test-mandate.md` INQUEBRÁVEL). Coverage Matrix 12/12 ECs absorbed: EC-2 server-authoritative cost + EC-3 KEDA Pro+ tier gate + EC-4 HPA bounds CPU [10,95] memory [10,90] + EC-5 withEnvironmentLock + EC-8 type-to-confirm `scale <projectname>` matching `delete <projectname>` convention. |
| **J-21 Readiness Score** | 2026-06-15 (engineering side; sponsor JUNTOS LIVE walkthrough on next operator session per ADR D5) | Plan `2026-06-06-dashboard-journey-j21-readiness-plan.md` v1.1 SHIPPABLE 94.0 → v0.17.0. 3 atomic commits: `4111a5e3` plan v1.0 → v1.1 absorption (4 MUST FIX: mandatory sections + tristate Pass/Fail/Unknown + a11y icon+text mapping + ADR D5 operator HARD STOP) + `8a0cae56` implementation Phase 0-5 engineering complete + `bbb438eb` /code-quality PASS + /review READY_TO_MERGE. Synthesis card composing J-18 status + J-19 logs + J-20 scale + J-22 secrets canonical hooks into tristate weighted 0-100 score. Canonical fix for J-18 v0.15.0 empty-signals-leak-distress bug family: Unknown excluded from BOTH score numerator AND denominator so operator outage NEVER renders user project as red Fail. 4 NEW components under `cloud/dashboard/src/components/readiness/` (ScoreCard with localStorage delta-vs-prev-visit + Checklist with Fix-it Link OR Coming-soon Tooltip per EC-7 KNOWN_ROUTES allowlist + FAQ collapse + deep-link drawer `?signal=X`) + 2 NEW lib modules (signals.ts + status-icons.ts ADR D3 canonical lucide-react mapping). Legacy v0 `components/project/readiness-checklist.{tsx,test.tsx}` DELETED per Unbreakable Rule "Legacy code is an error. Delete it." Page rewrite from 54-LOC stub. 18+ NEW hermetic tests (14 vitest + 4 status-icons implicit + 15 syntax) + 0 regressions; /code-quality PASS; /review verdict READY_TO_MERGE 0 BLOCKER 0 HIGH 0 MEDIUM 2 LOW operator HARD STOPs 1 INFO. Coverage Matrix 12/12 ECs absorbed including EC-2 tristate + EC-3 a11y aria-label per status + EC-5 hook error → Unknown (never Fail) + EC-6 no-flicker settled-gate + EC-7 KNOWN_ROUTES Coming-soon Tooltip + EC-8 Math.ceil score boundary 89.4→90/89.5→90/90.0→90/89.0→89 + EC-11 localStorage delta-vs-prev-render. **Synthesis card CLOSES foundation-first chain engineering-side per CLAUDE.md sponsor priority chain locked 2026-06-08**: J-19 ✓ J-22 ✓ J-18 ✓ J-18 T1.3.b ✓ J-20 ✓ J-21 ✓. |
| **J-11 Domains** | 2026-06-15 (engineering side; sponsor JUNTOS LIVE walkthrough on next operator session per ADR D5) | Plan `2026-06-06-dashboard-journey-j11-domains-plan.md` v1.1 SHIPPABLE 93.2 → v0.18.0. 3 atomic commits: `929ce742` plan v1.0 → v1.1 absorption (5 MUST FIX: mandatory sections + ADR D6 backend-already-shipped + ADR D2 terminal-set LOCKED + ADR D7 rate-limit+debounce + ADR D5 operator HARD STOP) + `4634a0ee` implementation Phase 2-5 + `66118020` /code-quality PASS + /review READY_TO_MERGE. ADR D6 codified Phase 1 backend ALREADY shipped per recon-first (POST /api/v1/domains/{name}/verify wired at router.go:486 + nameservers in Get/Create responses) — saved 3h of duplicate backend work. 4 NEW components under `cloud/dashboard/src/components/domains/` (NSInstructionsCard 3-step DNS setup + ReverifyButton ref-debounced status-gated + DomainTroubleshootSheet keyed on backend failure_mode) + 1 NEW hook (`useDomainStatusPolling` terminal-set `{active, failed, removing}` LOCKED + document.hidden pause). Reuses canonical `useVerifyDomain` mutation from existing `hooks/mutations/use-domains.ts` — no duplicate hook. ADR D7 rate-limit + ref-based debounce LOCKED (1/30s server-side via existing rateLimitMiddlewares + ref guard for synchronous client-side double-click protection). Page rewrite +78 LOC surgical extension preserves existing flow. 20 NEW vitest (4 polling hook + 4 NS card + 6 Reverify + 6 troubleshoot sheet) + 19 hermetic shell-script assertions + 0 regressions; /code-quality PASS; /review READY_TO_MERGE 0 BLOCKER 0 HIGH 0 MEDIUM 2 LOW 1 INFO. Coverage Matrix 11/11 ECs absorbed including EC-2 server-already-shipped + EC-3 polling terminal-set + EC-4 reverify debounce + EC-6 document.hidden pause + EC-8 empty nameservers skeleton. **Destrava `custom_domain` signal do J-21 Readiness Score** Unknown → Pass/Fail real. Esforço actual 6h vs plan 7h (ADR D6 saved 3h). |

**Sequência recomendada (per roadmap § 8):** `J-17 ✅ → J-18 ✅ → J-19 ✅ → J-22 ✅ → J-20 ✅ → J-23 ✅ → J-24 → J-25 ✅ → J-21 ✅ → J-06 → J-07 ✅ + J-08 ✅ / J-13`. Pode paralelizar journeys independentes (ex: J-10 ✅ + J-11 ✅ não compartilham surfaces).

## Dashboard Journeys — sponsor priority chain (locked 2026-06-08)

> **Read this BEFORE invoking `/implement` on any of the 20 dashboard-journey plans.** The sponsor has locked a specific subset + ordering that supersedes the generic "Sequência recomendada (per roadmap § 8)" line above for the next implementation cycles.

**Authorization:** sponsor verbatim directive 2026-06-08 — *"E nosso backlogo qual o proximo passo natual? secrets, domain, scale, Runtime logs, Production readiness (esses são itens que eu quero tratar com o MAXIMO de prioridade)"* + *"Deixe claro em nosso CLAUDE.md esse ROADMAP prioritario"*. The 5 journeys called out below + J-11 Domains form the MAX PRIORITY working set for the post-`2026-06-08-dashboard-screens-review-fixes` cycle.

**Locked priority chain (foundation-first observability, then power-tools, then synthesis):**

```
1. J-19  Runtime logs streaming    (21h)  ← observability foundation
2. J-22  Secrets CRUD              (19h)  ← runtime config foundation  ✅ DELIVERED 2026-06-11 (sponsor verbatim "Confirmado"; LIVE walkthrough GREEN; baseline `docs/operations/baselines/2026-06-11-j22-layer2-LIVE-walkthrough-green.md`)
3. J-18  Status / Runtime Health   (20h)  ← runtime signals (replicas + deploy + 5xx + alerts)
4. J-20  Scale                     (18h)  ✅ DELIVERED 2026-06-15 v0.16.0
5. J-21  Readiness Score           (14h)  ✅ DELIVERED 2026-06-15 v0.17.0
                                          ──────
                                          92h sequential

   J-11  Domains                   (10h)  ✅ DELIVERED 2026-06-15 v0.18.0
```

**Dependency rationale (why this order, not the original roadmap § 8 ordering):**

| Journey | Why this position | Blocks |
|---|---|---|
| **J-19 Runtime Logs** | Without log streaming, debugging Scale/Secret/Readiness failures is blind. Logs are the cheapest fastest debug surface. | J-20, J-21 |
| **J-22 Secrets** | Almost every non-trivial app needs env vars to start. Deploy without secrets = silent failure that J-19 reveals. | J-20 |
| **J-18 Status / Runtime Health** | Synthesizes pod/replicas/restart/5xx/alerts signals into the surface that J-21 Readiness consumes. **Caught LIVE in dashboard-screens-review-fixes T5.3 walkthrough** when ProjectHealthCard rendered 4 orphan `—` pills because backend `omitempty` dropped signals for projects without active release — that empty-state UX is the J-18 surface. | J-20, J-21 |
| **J-20 Scale** | Power-tool. Without J-18 health signals + J-19 logs, scaling is blind. Without J-22 secrets, scaled pods crash on missing env vars. | J-21 |
| **J-21 Readiness** | **Synthesis card** — by design depends on ALL signals above being present + canonical. Designed to be last in the chain per its own plan v1.0 acceptance. | — |
| **J-11 Domains** | Orthogonal to runtime — TLS + DNS layer, doesn't block or depend on the synthesis chain. Can be inserted at any iteration capacity-permitting. | — |

**Inviolable invariants for this priority chain:**

1. **Foundation-first**: J-19 + J-22 + J-18 ship BEFORE J-20 + J-21. Shipping Scale without observability = blind operations; shipping Readiness without underlying signals = empty card (the very bug T5.3 walkthrough caught + fixed).
2. **Release between plans is FAANG-canonical** but NOT required — current branch already 254+ commits ahead post dashboard-screens-review-fixes; either release-first then implement, or stack with single bundled release at chain end.
3. **Each plan ships its own dogfood wrapper + LIVE bash test + sponsor browser walkthrough** per the 12 lessons-learned patterns inherited from J-17 (§ Dashboard Journeys — 20 plans formalizados above).
4. **Plan estado SHIPPABLE_WITH_CAVEATS** — todos os 6 já passaram `/plan-confidence`. NÃO precisam re-passar antes de `/implement {slug}`.
5. **Sponsor LIVE browser walkthrough remains HARD STOP** for each plan's promise emit. T5.3 of dashboard-screens-review-fixes proved its value: caught 5 bugs that vitest + tsc + code-review missed (CSS cascade, border-color regression, Project Detail Overview, list page Apps/Framework/Last deploy from T2.1 SQL narrowing, ProjectHealthCard empty-state).
6. **Domain mental-model lock** (sponsor verbatim confirmed 2026-06-08): `Tenant (account, billing unit) → Project (1 monorepo = 1 loopscale.yaml) → Apps (services declared in apps: map)`. All dashboard journeys MUST honor this. Apps card displays count of apps IN the monorepo, not number of projects.

**Operational invocation per plan:**

```
/implement 2026-06-06-dashboard-journey-j19-runtime-logs-streaming
/implement 2026-06-06-dashboard-journey-j22-secrets-crud
/implement 2026-06-06-dashboard-journey-j18-status-runtime-health
/implement 2026-06-06-dashboard-journey-j20-scale
/implement 2026-06-06-dashboard-journey-j21-readiness
/implement 2026-06-06-dashboard-journey-j11-domains   # parallel slot
```

Each invocation drives ralph-loop halt-loop with promise `PLAN_J<NN>_COMPLETE` gated by the plan's DoD + dogfood wrapper + sponsor LIVE browser walkthrough.

**When this priority chain may change:** Only via explicit sponsor directive (verbatim citation required). Any PR that ships J-20/J-21 BEFORE J-19/J-22/J-18 violates the foundation-first invariant and MUST cite the ADR justifying the inversion.

**Cross-reference:** the J-17 LIVE walkthrough lessons (§ "12 patterns inherited from J-17" above in the 20-plans section) apply to every plan in this chain — terminal-status absorption, marker-based log filtering, useEffect lifecycle deps, empty-state-as-design, scope-extension via governance gate, etc.


---

## Common Mistakes — dashboard-specific (migrated from engine § Common Mistakes)

| Mistake | Fix |
|---------|-----|
| `/verification` page renders PinInput directly on flow load | Browser-mode `/self-service/verification/browser` creates an EMPTY flow; Kratos enqueues a courier message ONLY after a POST submitting the `email` field. Without an auto-POST the page sits showing PinInput for a code that was never sent. Use `ensureCodeRequested(flowId)` on mount: GET `/sessions/whoami` → POST `{method:'code', email}` to `flow.ui.action`. Idempotent: re-POST on flow with code-input node is no-op. Same pattern for recovery if the email-prompt screen is skipped. See `cloud/dashboard/src/pages/verification.tsx` + commit `3c81f5eb`. |
| `result.plan !== baselinePlan` polling on `/billing?success=true` | Fails silently when baseline already equals target (e.g., Pro user reactivating after cancel). Stripe `subscription.id` is unique per checkout — poll on `subscription_id` transition (any signup or re-purchase produces a diff regardless of plan name). Defensive `||` keeps the plan diff as fallback. Backend must expose `subscription_id` on `/v1/billing`. See `cloud/dashboard/src/pages/billing.tsx` + commit `252ba8a2`. |

## Related

- [`meetings/MEET-2026-07-03-004`](/meetings/MEET-2026-07-03-004.md) ratifies the
  `GET /v1/billing/invoices` contract for **J-13 Billing**, one of the P0 journeys listed above; its
  conditions are binding on any PR implementing that journey.
- [`operations/m0-live-validation-runbook`](/operations/m0-live-validation-runbook.md) is the operator
  procedure that closes **J-01 through J-05**, the login/register/verification journeys in the P1 set.
- [`roadmaps/knowledge-base-ux-redesign`](/roadmaps/knowledge-base-ux-redesign.md) proposes a redesign of
  a dashboard module, so it inherits every invariant on this page.
- [`releases/v0.3.0`](/releases/v0.3.0-release.md) shipped the dashboard Skills-tab curation surface.
- [`handoffs/looptrace-module`](/handoffs/looptrace-module.md) mirrors the Memory vertical slice whose
  invariants are locked above.
- [`architecture/mcp-broker`](/architecture/mcp-broker.md) mints the per-tenant keys behind the
  `theo_live_*` scoped-key model that invariant 4 locks.
