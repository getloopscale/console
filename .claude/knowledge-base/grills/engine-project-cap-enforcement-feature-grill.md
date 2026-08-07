---
slug: engine-project-cap-enforcement
date: 2026-06-28
generated_by: roadmap-feature
new_milestone_id: M4
questions_answered: 4
sota_delta: "none — internal feature; mirrors the canonical pkg/enforcement + Red Team #101 scale-cap pattern already in the theo engine. No new reference peers."
status: completed
notes:
  - "slug re-named from per-account-project-quota-engine (substring collision with M2 'project quota')"
  - "out_of_scope_cross_check: no overlap (account_members RBAC / JWT major bump / data-plane semantics are off-limits; this feature touches none)"
---

# Feature grill: engine-project-cap-enforcement (M4)

### Q1/4: what & why-now

**Question:** What is this feature (M4) and why add it NOW (what changed)?

**Recommended:** Close the cap-enforcement descoped from M2.

**User answer:** M2 made plan/billing/cap RESOLVE per-Account but DESCOPED enforcement at project-creation (projects = AI agents created in the ENGINE, not via tenant-creation in theo-cloud). Today the cap is resolvable but NOT binding: a Starter Account (cap=1) can create unlimited projects in the engine. M4 enforces the per-Account project cap at the engine's project-creation path. Why now: M0–M3 completed the per-Account model end-to-end; enforcement is the last functional gap to make plan limits actually bind — a revenue-integrity / abuse gap (Starter bypass), analogous to the Red Team #101 scale-cap fix.

### Q2/4: dependencies

**Question:** Which existing milestones must be `[x]` before M4 can start?

**Recommended:** M2 + M3.

**User answer:** M2 + M3. M2 delivered per-Account cap resolution (plan_limits + account-scoped subscriptions = the source of the cap number M4 enforces); M3 made account_id NOT NULL (the reliable tenant→account join the resolution uses). Both `[x]`. M0/M1 are transitive.

### Q3/4: Definition of Done

**Question:** Verifiable DoD (3-5 bullets)?

**User answer (recommended, accepted):**
1. Engine project-creation resolves the Account's cap (tenant→account→plan_limits) and REJECTS the (N+1)th project beyond the cap with a typed error + HTTP 422 (code `PROJECT_CAP_EXCEEDED`), mirroring the canonical #101 pattern (`REPLICAS_EXCEED_PLAN`).
2. Negative-case test: a Starter Account (cap=1) creating a 2nd project gets the typed error (closes the M2-descoped bullet).
3. Concurrency: two simultaneous creations at the cap boundary cannot both succeed (atomic check — row/advisory lock or unique constraint), proven under `go test -race`.
4. Unlimited plan (enterprise, cap=NULL) is never blocked; grandfathered over-cap accounts don't break (existing projects keep working; only new creation is barred).
5. Runtime metric: `plan_limit_violations{metric="max_projects_per_account"}` increments on rejection (observability — wiring triad pillar c).

### Q4/4: top 2 NEW risks

**Question:** Top 2 NEW risks this feature introduces?

**User answer (recommended, accepted):**
1. **Check-then-create race** — two concurrent creations both read count<cap and both insert, overrunning the cap. Mitigation: atomic count+insert (per-account advisory lock OR conditional/unique insert) + `-race` boundary test.
2. **Mutable cap / grandfathered accounts** — a plan downgrade (cap drops below current count) or accounts already over cap. Enforcement must bar NEW creation without breaking/deleting existing projects or failing reads — explicit "block-new-only" decision, tested.

### Step 5 — SOTA delta

**Decision:** none. Internal feature; mirrors the canonical `pkg/enforcement` + Red Team #101 scale-cap pattern already in the theo engine (`REPLICAS_EXCEED_PLAN` → 422). No new reference peers cloned.


