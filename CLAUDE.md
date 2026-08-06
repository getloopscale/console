# CLAUDE.md — `theo-cloud`

Contract between Claude and the `theo-cloud` codebase. Read before touching any file.

The standalone repository for the commercial **cloud-API (Go)** + **dashboard (React/TSX)**,
extracted from the `theo` monorepo at M4 of the decomposition roadmap. A **leaf** of the
decomposition graph: nothing in the engine imports it; it consumes
`github.com/usetheodev/theo-contracts` (`jwt` · `serviceauth` · `plan`) and talks to the
engine + theo-data **over HTTP only**.

```
        theo-contracts  ◄── imports NOTHING internal (most stable base)
      (jwt · serviceauth · plan)
              ▲
              │ semver+pin (today: local replace)
        theo-cloud  (THIS repo) ── HTTP ──►  theo (engine) /engine/*  ·  theo-data (themory)
        dashboard(TSX) + cloud-API(Go)
```

**Status:** Pre-release (same posture as the engine). The dashboard is the closed-source
commercial differentiator; the cloud-API is the auth/billing/metering front-end that sits
in front of the engine.

> **The codebase is authoritative.** Read the code, `CHANGELOG.md`, and `docs/` before
> inventing behavior. Where this file and the code disagree, the code wins.

---

## Where governance lives (read this first)

This repo has **no `.claude/` of its own** — the Cycle 6+1 pipeline (DISCOVER → PLAN →
IMPLEMENT → CODE-QUALITY → REVIEW → RELEASE → ANALYSIS), its skills, and its rule files
live in the **umbrella workspace** one level up (`../.claude/`). When you drive a feature
through the cycle, do it from the umbrella so the skills and `rules/` resolve. This file +
`docs/governance/dashboard.md` are the **repo-local** contract a contributor (human or
Claude) needs to build, test, and reason about `theo-cloud` on its own.

The **Unbreakable Principles** (`~/.claude/CLAUDE.md`) always apply: 95% confidence gate,
task completion, extreme honesty, git rules, CHANGELOG discipline, tests-first, don't
reinvent the wheel.

---

## How theo-cloud connects (read BEFORE editing any seam code)

Two HTTP seams, **zero Go coupling** to the engine. Both are frozen by contract tests.

| Seam | Direction | Mechanism | Contract / test |
|---|---|---|---|
| **cloud ↔ engine** | cloud → engine | opaque `/engine/*` proxy via `EngineAPIURL` (`internal/config/config.go`), authenticated with Ed25519 **service-auth** (`theo-contracts/serviceauth`) | `internal/auth/service_signer.go` + `internal/auth/service_signer_test.go` |
| **cloud ↔ theo-data** | cloud → theo-data | **themory** HTTP client | `openapi/themory.yaml` + `internal/themory/contract_test.go` |

Claude MUST consult the relevant test/contract BEFORE editing:
- `internal/auth/service_signer.go` (the engine-proxy signing path)
- `internal/themory/` (the theo-data client)
- `internal/config/config.go` (`EngineAPIURL`, Kratos URLs, Stripe keys)
- `openapi/themory.yaml` (the wire schema — keep it in sync with the client)

The engine and theo-data are **separate repos/services**. Never import their Go packages;
talk to them over the HTTP seam. A change that needs a new engine field is a **contract
change** — coordinate it across the seam, do not reach into engine internals.

---

## Stack

| Layer | Technology |
|---|---|
| cloud-API | Go 1.26 + chi/v5 + pgx/v5 + slog + OTel (otelhttp + otlptrace) + prometheus/client_golang |
| Auth contracts | `theo-contracts/jwt` (RSA JWT verify) · `theo-contracts/serviceauth` (Ed25519 sign) · `theo-contracts/plan` (cost/plan vocabulary) |
| Identity | Ory Kratos (session) + Ory Hydra (OAuth2/device) — consumed over HTTP, configured via `internal/config` |
| Billing | Stripe (`internal/billing`) |
| Dashboard | React 19 + Vite + TypeScript (`@theo/dashboard`) + Vitest + `@usetheo/ui` design system |
| Persistence | PostgreSQL 16 (pgx) — metering, api-keys, memory exports/webhooks |

### cloud-API packages (`internal/`)

`auth` (JWT verify + service-auth sign + scope middleware) · `billing` (Stripe checkout/portal/webhook) ·
`config` · `consent` (Hydra consent) · `memory_webhook_worker` · `metering` (usage → PG) ·
`metrics` (prometheus) · `ratelimit` · `routes` (the HTTP surface) · `themory` (theo-data client) · `tracing` (OTel).

### Dashboard routes (`dashboard/src/pages/`)

api-keys · audit · billing · build-{attestation,logs,sbom} · deployments + deployment-detail ·
device-{verify,success} · domains · environments · login · memory · overview · previews ·
profile · project-{connect,detail,readiness}. Each has a co-located `*.test.tsx`.

---

## Development commands

```bash
# cloud-API (Go)
go build ./...                       # build
go test ./... -race                  # all Go tests (unit tests live in tests/unit/ + *_test.go)
go vet ./...                         # static analysis

# dashboard (TypeScript) — from dashboard/
cd dashboard
npm ci                               # install (lockfile-faithful)
npm run build                        # tsc -b && vite build
npm test                             # vitest run
npm run lint                         # eslint
npm run size                         # size-limit budgets (react-vendor 55KB, theo-ui 18KB, …)
npm run tree-shake-check             # asserts lib/mocks does NOT leak into the prod bundle
```

There is no `task`/Taskfile in this repo — `task quality:*` and the cross-repo contract
matrix live in the **engine** (`theo/`). See § Durable enforcement.

---

## The Rules (Non-Negotiable)

1. **Tests before code** — no production code without a failing test first (RED → GREEN → REFACTOR).
2. **Code is authoritative** — read the code + `CHANGELOG.md` + `docs/`; don't invent behavior.
3. **No internal terms in user-facing output (Cross-Project Rule 9 — cloud abstraction).**
   The dashboard, API error messages, and any public copy hide the infrastructure the same
   way Vercel hides Lambda. **Forbidden** in user-facing strings: `Kubernetes`, `cluster`,
   `ArgoCD`, `Gitea`, `MinIO`, `Cosign`, `KEDA`, `Argo Rollouts`, `Pulumi`, `Helmfile`,
   `Ory`, `Traefik`, `cell`, `CRD`, `tenant_id`. Use product language: deploy, live URL,
   team, account, service, build, rollback. Internal terms are allowed only in code,
   comments, ADRs, and `docs/`.
4. **`--json` / API response shapes are stability contracts** — field names don't change
   without a major bump; new fields may be added.
5. **Lock + idempotency on mutations** — Stripe and webhook handlers MUST be **idempotent
   AND order-independent** (see § Common Mistakes). Mutating PG writes use the project's
   transaction discipline.
6. **Acyclic invariant is sacred** — this repo imports ONLY `theo-contracts`; never an
   engine-internal package (`usetheodev/theo/pkg/*`, `/api/*`, `/internal/*`). Talk to the
   engine over the `/engine/*` HTTP proxy. Enforced by the engine's `acyclic-graph` gate.
7. **CHANGELOG discipline** — every change lands in `[Unreleased]` first (Keep a Changelog +
   SemVer), with a ticket/PR ref. **No CHANGELOG do UMBRELLA**, não neste repo, e com atribuição
   no início da linha: `- **theo-cloud:** …`. Contrato: `../.claude/rules/umbrella-scope.md` § 5.
   A razão é operacional: `/release` filtra `[Unreleased]` pelo projeto-alvo para derivar a
   versão, e entrada sem atribuição não pode ser liberada porque ninguém sabe de quem é a versão.
   Uma iteração commita em **dois** repositórios — código aqui, CHANGELOG e artefatos de ciclo no
   umbrella.

   > **Atenção — conflito conhecido.** O `.claude/hooks/stop-validation.sh` deste repo é
   > histórico congelado e ainda BLOQUEIA quando o `CHANGELOG.md` **local** não muda junto com
   > código. Seguir o contrato acima **garante** o bloqueio. Enquanto
   > `usetheodev/theo-workspace#26` não for resolvido, o encerramento precisa de
   > `STOP_VALIDATION_WARN_ONLY=1`. **Não** resolva escrevendo no CHANGELOG local: isso cria
   > duas fontes de verdade que divergem, que é exatamente o que a regra evita.
8. **Git** — work on `develop`; never commit to `main` (release-only, via PR); never
   `git checkout`/`revert`/`push --force`/`reset --hard`; no `Co-Authored-By` trailers.

---

## Architecture overview

```
Browser ─► dashboard (React SPA, @theo/dashboard)
              │  fetch /api/* (session cookie / JWT)
              ▼
        cloud-API (Go, chi)  ── internal/auth: verify Kratos session / JWT (theo-contracts/jwt)
              │                  internal/auth: sign service-auth (theo-contracts/serviceauth)
              ├─ /engine/*  ──► theo engine API   (opaque proxy, Ed25519-signed)
              ├─ themory    ──► theo-data          (openapi/themory.yaml)
              ├─ /billing   ──► Stripe             (internal/billing)
              ├─ Hydra/Kratos consent + device flows (internal/consent, routes/device.go)
              └─ metering → PostgreSQL             (internal/metering)
```

- **Auth boundary:** the cloud-API validates the user's identity (Kratos session / JWT via
  `theo-contracts/jwt`) and re-signs requests to the engine with Ed25519 service-auth
  (`theo-contracts/serviceauth`). The two ends of each crypto protocol live in
  `theo-contracts` precisely so this repo and the engine agree without sharing code.
- **The engine is opaque:** `/engine/*` is a pass-through proxy. Business logic for deploys
  lives in the engine; this repo owns auth, billing, metering, consent, and the dashboard.

---

## Dashboard governance

The dashboard's **active mandates** — the Memory Section invariants, the dashboard-journey
plans, the sponsor priority chain, and the dashboard-specific common mistakes — live in
[`docs/governance/dashboard.md`](docs/governance/dashboard.md). They were migrated here from
the engine's `theo/CLAUDE.md` at **M5** (the dashboard code lives in this repo, so its
governance does too). **Read it before editing any `dashboard/src/pages/` route.**

Historical journey-delivery plans + baselines remain in the engine's
`theo/.claude/knowledge-base/` (preserved as institutional audit trail per the M5 ADR).

---

## Sondas: `/health` e `/ready` NÃO são intercambiáveis

Duas rotas, duas perguntas, **consequências opostas**. Fiar a errada reintroduz o defeito que o
`#339` corrigiu.

| rota | pergunta | reprovada significa | onde fiar |
|---|---|---|---|
| `/health` | "o processo está vivo?" | **mata o processo** | `livenessProbe`, autoheal |
| `/ready` | "consigo atender agora?" | **tira do tráfego** | `readinessProbe`, `depends_on: service_healthy`, `--wait`, roteamento |

`/health` **nunca** reprova por falha de dependência, de propósito: reiniciar não conserta um banco
fora, e um `livenessProbe` sensível a dependência derruba o serviço a cada oscilação do Postgres
(LT-038 do theo-trust). O estado do banco vai no **corpo** de ambas — informação para quem
investiga, não gatilho para matar o processo.

`/ready` devolve **503** quando a dependência não serve. É a que `depends_on: service_healthy` e
`docker compose --wait` querem.

Ambas **reportam** as integrações desligadas por falta de configuração, e **nenhuma** reprova por
causa delas: são opcionais por ambiente, e reprovar derrubaria o serviço em toda topologia que não
as configura. Visibilidade se entrega no corpo, não no status.

> Apontar `livenessProbe` para `/ready` é o erro que este contrato existe para impedir.

---

## Invariants

- **Imports nothing engine-internal** — `go list -deps ./... | grep usetheodev/theo/` shows
  only `theo-contracts`, never `usetheodev/theo/pkg/*` or `/api/*`. (Verified: this repo
  imports exactly `theo-contracts/{jwt,plan,serviceauth}`.)
- **The dashboard is the closed-source commercial differentiator** — keep it product-shaped
  (CR-9), accessible, and tree-shaken (no mocks in the prod bundle).
- **Seams are HTTP-only + contract-tested** — cloud↔engine (serviceauth) and cloud↔theo-data
  (themory) never become Go imports.
- **`theo-contracts` is consumed via `replace => ../theo-contracts` today** (local). It cuts
  over to a pinned published version per the engine's version-pin cutover runbook (owner-gated).

---

## Common Mistakes — Read Before Coding

These are real, code-grounded lessons for the code that now lives in **this** repo
(billing, auth, webhooks, dashboard). They migrated with the code from the monorepo.

| Mistake | Fix |
|---|---|
| Confiar numa guarda que nunca é atingida por teste | A guarda de "escopo vazio" no diálogo de chave existia desde sempre (`selected.size === 0`) — e era **inalcançável**, porque um escopo vinha pré-marcado de fábrica. Ela só passou a provar algo quando o default saiu (#348). **Ao remover um default, pergunte o que ele estava escondendo**; e ao adicionar um, pergunte qual caminho ele torna inatingível. Corolário medido no mesmo issue: três testes existentes passavam **por causa** do default — atualizá-los foi o certo, afrouxar a guarda teria sido o erro. |
| Rodar `npx prettier --write` num arquivo do dashboard | O repo **não tem `.prettierrc`**, então o default troca aspas simples por duplas — e `src/lib/lens-alert-guard.test.ts` detecta o import por regex **com aspas simples** (`/from\s*'@\/components\/ui\/alert-guard'/`). O arquivo continua importando certo e o check reprova mesmo assim. Use `npx prettier --single-quote` ou `eslint --fix`. Custou um check vermelho no `#346`. O guard casa **estilo** além de origem — hoje inócuo porque o repo padroniza aspas simples, mas é o tipo de acoplamento que surpreende. |
| Classificar um `401`/`403` de sonda como serviço fora do ar | O alvo **respondeu** — a pilha HTTP está de pé; o que faltou foi credencial em **quem perguntou**. `internal/serviceversions` tem `StateUnauthorized` separado de `StateUnreachable` por isso (#345): colapsar os dois pintava o indicador do dashboard de vermelho em **todas** as telas, permanentemente — e um indicador sempre-vermelho é um indicador **desligado**. O espelho do mesmo erro também já ocorreu aqui: um reconciliador lendo `401` como *"a rota existe"*. Nos dois casos, tratar *"não me deixaram medir"* como uma medição. |
| Adicionar escopo a `validScopes` sem adicioná-lo ao broker (ou vice-versa) | Aceito na emissão (`POST /v1/api-keys` → 200, chave cunhada) e **descartado na travessia**: a capacidade fica inalcançável por qualquer credencial, sem erro em lugar nenhum, porque cada camada parece correta isolada. Ocorreu **quatro** vezes (rag, storage, promptly, `trust:content`) apesar do aviso em prosa acima da lista — quem adicionou a quarta declarou tê-lo lido. `internal/ci/scope_parity_test.go` agora reprova nos dois sentidos. Ao adicionar um produto cujo namespace de broker difere do namespace do cliente (como `promptly` → `prompt:*`), registre em `brokerNamespace` — senão o teste acusa configuração correta, e teste que grita à toa treina a ignorar vermelho. |
| Endurecer uma sonda sem perguntar o que acontece **quando ela reprova** | `/health` reprovada **mata** o processo; `/ready` reprovada apenas o **tira do tráfego**. Fiz `/health` devolver 503 no #338 e isso mataria o container num piscar do Postgres — o mesmo defeito do `theo-trust` LT-038. Ver § *Sondas* acima. Ao corrigir qualquer indicador, exija o **par**: com a dependência no ar não pode acusar, com ela fora tem de acusar. Trocar sempre-vermelho por sempre-verde é regressão, não conserto. |
| `time.Hour.Truncate` bucket on Stripe `Idempotency-Key` | Stripe caches idempotency responses 24h; a 1h bucket returns a STALE checkout/portal URL for the whole wall-clock hour. Use `time.Minute` (absorbs double-click latency; Stripe only charges on payment, so coarser windows add no protection). `internal/billing`. |
| `WHERE stripe_subscription_id = $X` in a Stripe webhook handler | Stripe does NOT guarantee webhook **delivery order** — `subscription.created` can arrive before `checkout.session.completed` linked the id. Use `WHERE stripe_subscription_id = $X OR stripe_customer_id = $Y` and always SET the subscription id. **Webhook handlers must be idempotent AND order-independent.** `internal/billing`. |
| Enumeration-by-negation in the dashboard: `planTier !== 'enterprise' && planTier !== 'team'` | Silently covers `pro` and shows the wrong upgrade CTA to a Pro user. **Enumerate positively** (`=== 'free'`, `=== 'pro'`, …); normalize case on lookup (`(plan ?? 'starter').toLowerCase()`). |
| Sending Kratos `KRATOS_PUBLIC_URL` where `KRATOS_INTERNAL_URL` is needed (or vice-versa) | Public = `https://…` browser-facing; internal = cluster DNS `http://…`. Mixing them causes redirect loops / cookie-domain mismatch. Keep the public/internal split in `internal/config`. |
| Internal terms in a user-facing string (dashboard or API error) | CR-9 violation. "deploy" not "ArgoCD sync"; "live URL" not "ingress"; never `Kubernetes`/`cell`/`CRD`/`tenant_id`. |
| Reaching into the engine for a field the proxy doesn't expose | Don't import engine Go. Extend the `/engine/*` contract OR add the field to `theo-contracts` — coordinate across the seam. |
| Mocks leaking into the production dashboard bundle | `npm run tree-shake-check` must pass — `lib/mocks` must NOT appear in `dist/assets/*.js`. |

---

## Durable enforcement (M5)

The decomposition guarantees are mechanically enforced from the engine repo:

- **Acyclic gate** — `theo-ops quality acyclic-graph` (engine) FAILS if `theo-cloud` imports
  any engine-internal package. Run it before any merge that adds Go imports.
- **Cross-repo contract matrix** — `task quality:contract:cross-repo` (engine) runs all three
  seam contracts (cli↔engine, cloud↔engine serviceauth, cloud↔theo-data themory) in one pass.
  See `theo/docs/cross-repo-contract-matrix.md`.
- **Version-pin cutover** — `replace github.com/usetheodev/theo-contracts => ../theo-contracts`
  in `go.mod` is local-only. It cuts over to a pinned published tag per
  `theo/docs/version-pin-cutover-runbook.md` (**owner-gated** — do not flip unilaterally).

---

## Pre-Completion Checklist

```
[ ] go build ./... && go test ./... -race  (cloud-API green)
[ ] cd dashboard && npm test && npm run build  (dashboard green)
[ ] npm run lint  (dashboard) + go vet ./...  (cloud-API) clean
[ ] npm run tree-shake-check passes (no mocks in prod bundle)
[ ] No engine-internal Go imports introduced (acyclic invariant)
[ ] No internal terms in user-facing strings (CR-9)
[ ] Webhook / billing handlers are idempotent AND order-independent
[ ] Seam change? contract test updated (serviceauth / themory) + openapi/themory.yaml in sync
[ ] CHANGELOG do UMBRELLA `[Unreleased]` atualizado, com `- **theo-cloud:**` (nunca o local)
[ ] Dashboard route change? docs/governance/dashboard.md consulted
```

---

## Provenance

Extracted at **M4** (history preserved via `git filter-repo`). Governance was minimal at M4;
this fuller per-repo contract + the dashboard-governance migration land at **M5**
(`m5-governance-durable`). The decomposition ADR and milestone roadmap live in the umbrella
workspace (`../decisions/2026-06-16-monorepo-decomposition.md`, `../ROADMAP.md`); the
shipped state reached `main` in engine release **v0.19.0** (2026-06-17).
