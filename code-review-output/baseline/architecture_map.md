# Architecture map — loop-console dashboard

**Target:** `/home/paulo/Projetos/loopscale/loopscale-platform/loop-console/dashboard`
**Phase:** 1 (baseline) · **Date:** 2026-08-11
**Inventory:** 818 files · 137.038 LOC total (excl. `node_modules`, `dist`, `playwright-report`, `test-results`)

## What this is

A React 19 + TypeScript single-page application built with Vite. It is the web
control surface of the LoopScale platform: one route subtree per product capability
(lens, rag, memory, trust, skills, promptly, projects, deploy, infra, settings).
It ships as a static bundle served by nginx inside a container, with runtime
configuration injected at container start.

## Runtime shape

```
docker-entrypoint.sh            ← injects runtime env into the static bundle
        ↓
nginx (nginx.conf + nginx-security-headers.conf)
        ↓
index.html → src/main.tsx       ← SPA bootstrap
```

### Bootstrap chain (`src/main.tsx:101-118`)

```
StrictMode
  RouteBoundary(routePath="root")        ← extremal crash boundary
    QueryClientProvider                  ← deliberately OUTSIDE LoopScaleUIProvider
      LoopScaleUIProvider(TEMA_LOOPSCALE)          ← design system + Toaster
        App
        ReactQueryDevtools               ← dev only, __DEV__ build literal
```

Pre-render side effects, in order:
1. `prontoParaRenderizar` — awaits mock installation when `VITE_USE_MOCKS=true`
   (dynamic import; DCE'd in prod). Render is gated on it (`main.tsx:48-56`).
2. `installAuthChannel()` (`main.tsx:62`) — cross-tab logout coordination,
   deliberately moved out of module side effects (B-042).
3. `initWebVitals()` (`main.tsx:67`) — RUM reporter.
4. Service worker registration, `import.meta.env.PROD` only (`main.tsx:73-79`).

### Routing (`src/app.tsx`)

Two-level `<Routes>`. Outer level = unauthenticated/standalone surfaces
(`/login`, `/register`, `/verification`, `/recovery`, device flows) plus a `*`
catch-all that mounts `DashboardLayout`. Inner level = the authenticated
application, wrapped in `RouteScope` (route-keyed remount, `app.tsx:76-91`).

Every route element is wrapped in `<Boundaried path=…>` (`src/routes/boundaried.tsx`)
and domain subtrees are injected as arrays exported from `src/routes/*-routes.tsx`
(`rotasDeProjects`, `rotasDeMemory`, `rotasDeRag`, `rotasDeTrust`, `rotasDeSkills`,
`rotasDePromptly`, `rotasDeObservability`, `rotasDeSettings`, `rotasDeProfile`).

Pages are code-split through `src/app-routes-lazy.ts` (319 LOC) — a single lazy
registry mapping named exports to `React.lazy` default-export contracts.

## Layering

| Layer | Path | Files | LOC | Role |
|---|---|---|---|---|
| Presentation | `src/pages` | 485 | 79.194 | One subtree per product domain |
| Composition | `src/routes` | 12 | 730 | Route arrays + `Boundaried` wrapper |
| Data access / state | `src/hooks` | 134 | 15.577 | react-query hooks, auth, SSE, mutations |
| Shared infra | `src/lib` | 68 | 11.718 | HTTP, query keys, session, telemetry, theme, mocks |
| UI | `src/components` | 49 | 5.437 | Layout shell, dialogs, charts, command palette |
| Build policy | `src/build` | 8 | ~600 | Chunking, SW caching, CSP — tested as code |
| Test harness | `src/test` | 11 | 1.009 | render helper, route manifest, stable-tree guards |
| E2E | `e2e` | 28 | 4.220 | Playwright journeys |

Dependency direction observed: `pages → hooks → lib/http → network`. `components`
is consumed by both `pages` and `routes`. `lib` imports nothing from `pages`.

## The single I/O boundary

`src/lib/http/api.ts` (456 LOC) is the only outbound HTTP surface. It carries:

- the 402 interceptor that emits `loopscale:plan-limit` window events, consumed by
  the single top-level `<PlanLimitUpgradeModal/>` (`app.tsx:108`);
- `installAuthChannel()` — BroadcastChannel logout fan-out;
- 151 importers (per the comment at `main.tsx:60`), which makes it the highest-
  blast-radius module in the codebase.

Supporting modules: `lib/http/config.ts` (runtime config), `lib/http/query-client.ts`
(react-query factory), `lib/http/list-ceiling.ts` (list-size guard),
`lib/api/query-keys.ts` (key factory), `lib/api/types.ts` (861 LOC of backend contracts).

## Notable structural traits

- **Guard tests as architecture enforcement.** `src/lib` holds ~25 test files that
  are not unit tests of production modules but *invariant guards*:
  `route-boundary.test.ts`, `residence-rule.test.ts`, `loc-budget-ratchet.test.ts`,
  `parent-barrel-import.test.ts`, `silent-null-guard.test.ts`,
  `placeholder-honesty.test.ts`, `test-only-module-guard.test.ts`,
  `endpoint-surface.test.ts`, `i18n-guard.test.ts`. `npm run lint` also runs
  `scripts/check-guard-pairs.mjs`. This is a deliberate, unusually strong
  self-policing layer and should be treated as part of the architecture.
- **Mixed-language identifiers.** Portuguese identifiers (`rotasDeProjects`,
  `prontoParaRenderizar`, `TEMA_LOOPSCALE`, `arvore-estavel`) coexist with English
  ones. Comments likewise mix pt-BR and English.
- **Mock layer is production-gated by tree-shaking**, verified by a dedicated
  script (`scripts/check-mocks-tree-shaken.mjs`) rather than by convention.
- **Test-to-production ratio is high**: 376 test files / 51.573 LOC against
  437 production files / 69.177 LOC.

## Entry points registered

| Entry point | Path |
|---|---|
| SPA bootstrap | `src/main.tsx` |
| Root component / router | `src/app.tsx` |
| Lazy route registry | `src/app-routes-lazy.ts` |
| Container entry | `docker-entrypoint.sh` |
