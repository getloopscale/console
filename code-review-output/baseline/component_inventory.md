# Component inventory

**Total components:** 31 · **Files inventoried:** 818


## entrypoint

| Component | Path | LOC | Description |
|---|---|---|---|
| `app-routes-lazy` | `src/app-routes-lazy.ts` | 319 | Lazy route registry — code-splitting entry map for every page subtree. |
| `app` | `src/app.tsx` | 226 | Root <App/>: provider composition (QueryClient, Auth, Theme), global error boundary, route tree mount. |
| `main` | `src/main.tsx` | 118 | SPA bootstrap: React root, providers, service-worker registration, router mount. |
| `docker-entrypoint` | `docker-entrypoint.sh` | 44 | Container entry: runtime env-var injection into the static bundle before nginx starts. |

## layer

| Component | Path | LOC | Description |
|---|---|---|---|
| `pages` | `src/pages` | 79194 | Presentation layer — one subtree per product domain. Largest component by LOC. |
| `hooks` | `src/hooks` | 15577 | Data-access + state layer: react-query hooks per domain, auth, SSE/log streaming, mutations. |
| `lib` | `src/lib` | 11718 | Shared infrastructure: HTTP client, query keys/client, auth session, telemetry, formatting, theme, export, mocks, i18n. |
| `components` | `src/components` | 5437 | Reusable UI: layout shell, dialogs, charts, command palette, loading/error states, onboarding, ui primitives. |
| `routes` | `src/routes` | 730 | Route subtree definitions per domain (memory, rag, trust, skills, promptly, projects, settings, observability, profile) + boundaried wrapper. |

## module

| Component | Path | LOC | Description |
|---|---|---|---|
| `mocks` | `src/lib/mocks` | 4626 | Mock-mode data providers — must be tree-shaken out of production bundle (scripts/check-mocks-tree-shaken.mjs). |
| `e2e-suite` | `e2e` | 4220 | Playwright end-to-end journeys (28 files). |
| `api-contracts` | `src/lib/api` | 1274 | TypeScript contracts for backend payloads (types.ts, 861 LOC) + query-key factory. |
| `http-client` | `src/lib/http` | 1132 | Fetch wrapper (api.ts), runtime config, react-query client factory, list-ceiling guard. The single outbound I/O boundary. |
| `test-harness` | `src/test` | 1009 | Test infrastructure: render helper, setup, route manifest, stable-tree guard, a11y and journey suites. |
| `vendor-usetheo-ui` | `src/vendor/usetheo-ui` | 570 | Vendored design-system surface. |
| `telemetry` | `src/lib/telemetry` | 557 | Client-side telemetry emission. |
| `auth-session` | `src/lib/auth` | 531 | Session persistence, cross-tab auth channel, logout cache purge. |
| `build-config` | `src/build` | 0 | Build-time policy modules: manual chunk splitting, service-worker BFF paths + runtime caching, CSP. |

## service

| Component | Path | LOC | Description |
|---|---|---|---|
| `domain-lens` | `src/pages/lens` | 17284 | theo-lens observability surface — largest domain subtree (107 files). |
| `domain-promptly` | `src/pages/promptly` | 9096 | theo-promptly prompt-management surface. |
| `domain-projects` | `src/pages/projects` | 7160 | Project CRUD, environments, project status. |
| `domain-auth` | `src/pages/auth` | 6067 | Login, OIDC callback, signup, verification flows. |
| `domain-deploy` | `src/pages/deploy` | 5953 | Deployment surface + log streaming. |
| `domain-rag` | `src/pages/rag` | 5324 | theo-rag surface. |
| `domain-infra` | `src/pages/infra` | 5317 | Infrastructure/cluster surface. |
| `domain-memory` | `src/pages/memory` | 4962 | theo-memory surface. |
| `domain-skills` | `src/pages/skills` | 4818 | theo-skills surface. |
| `domain-settings` | `src/pages/settings` | 4771 | Account, billing, tokens, org settings. |
| `domain-trust` | `src/pages/trust` | 3603 | theo-trust surface. |
| `domain-overview` | `src/pages/overview` | 2941 | Capability overview dashboards (active plan area). |
| `domain-workspace` | `src/pages/workspace` | 1191 | Workspace shell surface. |
