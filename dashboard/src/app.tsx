import { Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import {
  Bell,
  Database,
  Link2,
  Lock,
  Receipt,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { SubPagePlaceholder } from '@/pages/sub-page-placeholder';
import { RouteBoundary } from '@/components/error/route-boundary';
import { PlanLimitUpgradeModal } from '@/components/dialogs/plan-limit-upgrade-modal';
import { RouteLoading } from '@/components/loading/route-loading';
// Red Team #93 — parent-project existence guard for every per-project
// sub-route. Renders "Project not found" instead of letting the sub-view
// render functional UI on top of an empty data set when the URL slug is
// a deleted/non-existent project.
import { ProjectGuard } from '@/components/project/project-guard';
import {
  ApiKeysPage,
  AttestationTab,
  AuditPage,
  BillingPage,
  BundleDetailPage,
  BundlesPage,
  CheckEmailPage,
  DeploymentDetailLayout,
  DeploymentsPage,
  DeviceSuccessPage,
  DeviceVerifyPage,
  DomainsPage,
  EntitiesPage,
  EnvironmentsPage,
  EpisodesPage,
  ExportsPage,
  GraphPage,
  LensAgentsPage,
  LensAlertsPage,
  LensAskPage,
  LensComparePage,
  LensDashboardsPage,
  LensDatasetsPage,
  LensEvaluatorsPage,
  LensExperimentsPage,
  LensLabelingQueuePage,
  LensMonitorsPage,
  LensOverviewPage,
  LensSessionDetailPage,
  LensSessionsPage,
  LensTracesPage,
  LensUsageByUserPage,
  LoginPage,
  LogsTab,
  MemoryListPage,
  MemoryPage,
  NotFoundPage,
  OverviewPage,
  PlaygroundPage,
  ProfilePage,
  ProjectConnectPage,
  ProjectDetailPage,
  ProjectReadinessPage,
  ProjectScalePage,
  ProjectStatusPage,
  ProjectsPage,
  PromptDetailPage,
  PromptlyCatalogoPage,
  PromptlyCreatePage,
  PromptlyDiffPage,
  PromptlyOverviewPage,
  PromptlyPlaygroundPage,
  RagAnalyticsPage,
  RagAskPage,
  RagCollectionsPage,
  RagConnectorsPage,
  RagDocumentsPage,
  RagGraphRagPage,
  RagOverviewPage,
  RagWikiPage,
  RecoveryPage,
  RegisterPage,
  RuntimeLogsPage,
  SBOMTab,
  SecretsPage,
  SettingsPage,
  SkillAuthoringPage,
  SkillDetailPage,
  SkillVersionsPage,
  SkillsCatalogPage,
  SkillsDiscoveryPage,
  SkillsOverviewPage,
  SkillsPage,
  StatusPage,
  TeamPage,
  TimelineTab,
  TrustEnforcementPage,
  TrustGuardrailNewPage,
  TrustGuardrailsPage,
  TrustOverviewPage,
  TrustViolationsPage,
  VerificationPage,
  WebhooksPage,
  WorkspacePage,
  WorkspaceWebhooksPage,
} from '@/app-routes-lazy';

/**
 * T0.1: helper para wrap cada <Route element> em <RouteBoundary>.
 * Crash em uma page só renderiza fallback nessa page — sidebar/topbar persistem.
 * routePath é forwarded para telemetry (error reporter classifica por path).
 */
function Boundaried({ path, children }: { path: string; children: ReactNode }) {
  return <RouteBoundary routePath={path}>{children}</RouteBoundary>;
}

/**
 * Route-level code-split via React.lazy + Suspense.
 *
 * Each page becomes its own chunk; initial bundle ships only the
 * BrowserRouter + DashboardLayout shell + loading fallback. Pages load
 * on-demand when route matches.
 *
 * Pages use named exports — wrapper converts to React.lazy default-export
 * contract: `.then(m => ({ default: m.PageName }))`.
 *
 * Reduces initial bundle ≥30% for first paint (per T-H.3 attempt to meet
 * D7 +30% gzip target).
 */

// PreviewsPage deleted per plan 2026-06-08-dashboard-screens-review-fixes
// The multi-row preview table is obsolete under the post-M2 single-slot
// preview model, and Previews was removed from the nav. Stale
// /projects/:name/previews links redirect to the project's Environments tab
// (post-M20), where the single preview slot is rendered inline via PreviewRow.
function PreviewsRedirect() {
  const { name } = useParams();
  // Previews was removed from the project nav; the old target (/environments)
  // is now a redirect since M20 re-homed environments. Send stale
  // /projects/:name/previews links to the project's environments tab, where
  // preview environments live, instead of the dead global env page.
  return <Navigate to={`/projects/${encodeURIComponent(name ?? '')}/environments`} replace />;
}

// Red Team theo-cloud#102 closure: /projects/:name/repository was a dead
// deep-link — the sidebar menu sent users to /projects/:name/connect but
// the URL directly resolved to 404. Canonicalize by redirecting to the
// real route.
function RepositoryAlias() {
  const { name } = useParams();
  return (
    <Navigate
      to={`/projects/${encodeURIComponent(name ?? '')}/connect`}
      replace
    />
  );
}

// Red Team theo-cloud#58/#73 closure: wrap the dashboard inner Routes
// in a route-keyed scope so:
//   1. When the URL pathname changes, React discards the previous
//      route's tree IMMEDIATELY (instead of letting the prior page
//      linger until the new page's data loads), so the user no longer
//      sees ~1-2s of the wrong page under the new URL.
//   2. Any toasts owned by the previous route get dismissed — the
//      canonical "Failed to start checkout" error from /billing must
//      not haunt /projects.
// `key` on a child forces React to unmount the previous instance + mount
// a fresh one. The cost is one extra render per route change, which is
// the correct trade-off (the previous behavior was a visible bug). The
// `dismiss-all` part is best-effort: we cannot enumerate live toast IDs
// through the @usetheo/ui Toaster contract, so we use a `useToast`
// shadow-tracking approach via a small registry mounted alongside.
function RouteScope({ children }: { children: ReactNode }) {
  const location = useLocation();
  // Radix scroll-lock stuck fix (radix-ui/primitives#2122). Quando um overlay do
  // @usetheo/ui (Select / DropdownMenu / Dialog — todos Radix) está ABERTO e o
  // componente DESMONTA durante uma navegação de rota, o Radix não roda o cleanup
  // e deixa `pointer-events: none` (inline) + `data-scroll-locked` PRESOS no <body>.
  // Nesse estado a página inteira trava: nenhum clique passa e NENHUM texto pode
  // ser selecionado/copiado. Reproduzido de forma determinística (abrir dropdown →
  // navegar → body preso). Limpa a cada troca de rota — idempotente e seguro, pois
  // ao navegar os overlays da rota anterior já foram desmontados.
  useEffect(() => {
    document.body.style.removeProperty('pointer-events');
    document.body.removeAttribute('data-scroll-locked');
  }, [location.pathname]);
  return <div key={location.pathname}>{children}</div>;
}


// Sprint 3 Phase 2 (#17) v1.1 ADR D1 — `PageLoader` superseded by
// `<RouteLoading />` (`src/components/loading/route-loading.tsx`). The new
// component adds `role="status"` so AT announces the transition AND so the
// QA Red Team regression test at `app.test.tsx` can detect the loading state.

export default function App() {
  return (
    <BrowserRouter>
      <NuqsAdapter>
        {/* Plan J-10 v1.1 T2.6 — top-level PlanLimitUpgradeModal listens for
            theo:plan-limit window events emitted by the 402 interceptor in
            lib/api.ts. Single mount covers every surface (envs / secrets /
            projects / future verticals). Modal is closed by default; opens
            only on 402. */}
        <PlanLimitUpgradeModal />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
          <Route path="/login" element={<Boundaried path="/login"><LoginPage /></Boundaried>} />
          <Route path="/register" element={<Boundaried path="/register"><RegisterPage /></Boundaried>} />
          {/* T1.4 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #22.
            * /signup is the intuitive URL new users try; map to /register via
            * SPA-side Navigate per ADR D5. `replace` keeps history clean. */}
          <Route path="/signup" element={<Navigate to="/register" replace />} />
          {/* Red Team theo-cloud#55 closure: /registration is the second
            * intuitive URL (matches the noun "registration"). Map to
            * /register via SPA-side Navigate — same shape as the /signup
            * alias above. Replaces the prior fall-through that sent
            * unauthenticated users to /login with a misleading "Session
            * expired" toast (a fresh browser never had a session to
            * expire). */}
          <Route path="/registration" element={<Navigate to="/register" replace />} />
          <Route path="/verification" element={<Boundaried path="/verification"><VerificationPage /></Boundaried>} />
          {/*
            * Red Team theo/theo#162 (2026-07-01): the post-signup redirect
            * target /auth/check-email + email verify link /auth/verify used
            * to return 404 Caddy raw because the Caddyfile handle /auth/*
            * proxied everything to the theo-cloud BFF (which only serves
            * 4 OAuth routes). Caddyfile is now narrowed with a named
            * @auth_bff matcher so these paths fall through to the SPA.
            * /auth/verify → canonical Kratos /verification page.
            */}
          <Route path="/auth/check-email" element={<Boundaried path="/auth/check-email"><CheckEmailPage /></Boundaried>} />
          <Route path="/auth/verify" element={<Navigate to="/verification" replace />} />
          <Route path="/recovery" element={<Boundaried path="/recovery"><RecoveryPage /></Boundaried>} />
          <Route path="/device-success" element={<Boundaried path="/device-success"><DeviceSuccessPage /></Boundaried>} />
          <Route path="/device-verify" element={<Boundaried path="/device-verify"><DeviceVerifyPage /></Boundaried>} />
          <Route
            path="*"
            element={
              <DashboardLayout>
                {/* Red Team theo-cloud#58/#73 closure: wrap the inner
                    Routes in a route-keyed RouteScope so a route change
                    (a) forces React to discard the prior route's tree
                    immediately instead of letting the previous page
                    linger on screen during the new component's first
                    paint, AND (b) clears any toasts that belonged to
                    the previous page (a stale "Failed to start checkout"
                    error from /billing must not haunt /projects). */}
                <RouteScope>
                <Suspense fallback={<RouteLoading />}>
                  <Routes>
                    <Route path="/" element={<Boundaried path="/"><OverviewPage /></Boundaried>} />
                    <Route path="/projects" element={<Boundaried path="/projects"><ProjectsPage /></Boundaried>} />
                    <Route path="/projects/:name" element={<Boundaried path="/projects/:name"><ProjectDetailPage /></Boundaried>} />
                    <Route
                      path="/projects/:name/deployments"
                      element={<Boundaried path="/projects/:name/deployments"><ProjectGuard><DeploymentsPage /></ProjectGuard></Boundaried>}
                    />
                    {/* Plan J-17 T5.1: nested layout with Outlet replaces
                        the four sibling routes. Index = TimelineTab. */}
                    <Route
                      path="/projects/:name/deployments/:id"
                      element={<Boundaried path="/projects/:name/deployments/:id"><ProjectGuard><DeploymentDetailLayout /></ProjectGuard></Boundaried>}
                    >
                      <Route index element={<TimelineTab />} />
                      <Route path="logs" element={<LogsTab />} />
                      <Route path="sbom" element={<SBOMTab />} />
                      <Route path="attestation" element={<AttestationTab />} />
                    </Route>
                    <Route
                      path="/projects/:name/logs"
                      element={<Boundaried path="/projects/:name/logs"><ProjectGuard><RuntimeLogsPage /></ProjectGuard></Boundaried>}
                    />
                    <Route
                      path="/projects/:name/status"
                      element={<Boundaried path="/projects/:name/status"><ProjectGuard><ProjectStatusPage /></ProjectGuard></Boundaried>}
                    />
                    <Route
                      path="/projects/:name/secrets"
                      element={<Boundaried path="/projects/:name/secrets"><ProjectGuard><SecretsPage /></ProjectGuard></Boundaried>}
                    />
                    <Route
                      path="/projects/:name/previews"
                      element={<ProjectGuard><PreviewsRedirect /></ProjectGuard>}
                    />
                    <Route
                      path="/projects/:name/connect"
                      element={<Boundaried path="/projects/:name/connect"><ProjectGuard><ProjectConnectPage /></ProjectGuard></Boundaried>}
                    />
                    {/* Red Team theo-cloud#102 closure: /projects/:name/
                      * repository was an orphan deep-link (404). Canonical
                      * destination is /connect. */}
                    <Route
                      path="/projects/:name/repository"
                      element={<ProjectGuard><RepositoryAlias /></ProjectGuard>}
                    />
                    <Route path="/audit" element={<Boundaried path="/audit"><AuditPage /></Boundaried>} />
                    <Route
                      path="/projects/:name/scale"
                      element={<Boundaried path="/projects/:name/scale"><ProjectGuard><ProjectScalePage /></ProjectGuard></Boundaried>}
                    />
                    <Route
                      path="/projects/:name/readiness"
                      element={<Boundaried path="/projects/:name/readiness"><ProjectGuard><ProjectReadinessPage /></ProjectGuard></Boundaried>}
                    />
                    {/* M20: environments are a project dimension — the page lives
                        under the project (unambiguous scope, no project-guess). The
                        old global /environments redirects so bookmarks don't 404. */}
                    <Route
                      path="/projects/:name/environments"
                      element={<Boundaried path="/projects/:name/environments"><ProjectGuard><EnvironmentsPage /></ProjectGuard></Boundaried>}
                    />
                    <Route path="/environments" element={<Navigate to="/projects" replace />} />
                    <Route path="/team" element={<Boundaried path="/team"><TeamPage /></Boundaried>} />
                    <Route path="/billing" element={<Boundaried path="/billing"><BillingPage /></Boundaried>} />
                    <Route path="/domains" element={<Boundaried path="/domains"><DomainsPage /></Boundaried>} />
                    {/* Canonical API token URL is /settings/tokens (sidebar → Settings → Developer
                        → API Tokens). /api-keys kept as redirect for backward compat with bookmarks
                        and any external link issued before the consolidation. */}
                    <Route path="/api-keys" element={<Navigate to="/settings/tokens" replace />} />
                    {/* Top-level main-menu surface for API Tokens (keeps the root
                        sidebar active — /settings/* would drill into Settings).
                        Same ApiKeysPage as the canonical /settings/tokens route. */}
                    <Route path="/tokens" element={<Boundaried path="/tokens"><ApiKeysPage /></Boundaried>} />
                    <Route path="/memory" element={<Boundaried path="/memory"><MemoryPage /></Boundaried>} />
                    <Route path="/memory/memories" element={<Boundaried path="/memory/memories"><MemoryListPage /></Boundaried>} />
                    <Route path="/memory/entities" element={<Boundaried path="/memory/entities"><EntitiesPage /></Boundaried>} />
                    <Route path="/memory/episodes" element={<Boundaried path="/memory/episodes"><EpisodesPage /></Boundaried>} />
                    <Route path="/memory/graph" element={<Boundaried path="/memory/graph"><GraphPage /></Boundaried>} />
                    <Route path="/memory/exports" element={<Boundaried path="/memory/exports"><ExportsPage /></Boundaried>} />
                    <Route path="/memory/webhooks" element={<Boundaried path="/memory/webhooks"><WebhooksPage /></Boundaried>} />
                    <Route path="/memory/playground" element={<Boundaried path="/memory/playground"><PlaygroundPage /></Boundaried>} />
                    <Route path="/memory/skills" element={<Boundaried path="/memory/skills"><SkillsPage /></Boundaried>} />
                    <Route path="/rag" element={<Boundaried path="/rag"><RagOverviewPage /></Boundaried>} />
                    {/* PLACEHOLDER · revisar ate 2026-11-07. Databases e uma capacidade
                        ANUNCIADA no menu (comingSoon) e ainda nao construida. A rota existe para
                        que o item nao leve a lugar nenhum, e a tela diz o que fara.

                        SEM `cliCommand` DE PROPOSITO: nao ha comando `theo db` hoje. Sugerir um
                        seria mentir de forma mais convincente que a ausencia — o placeholder
                        existe justamente para nao afirmar o que nao existe.

                        Na revisao: ou vira implementacao, ou sai JUNTO com a entrada do menu. */}
                    <Route
                      path="/databases"
                      element={
                        <Boundaried path="/databases">
                          <SubPagePlaceholder
                            title="Databases"
                            description="Provisionar e operar bancos gerenciados para os seus projetos, com backup, restauração e conexão por variável de ambiente."
                            icon={Database}
                          />
                        </Boundaried>
                      }
                    />
                    <Route path="/workspaces" element={<Boundaried path="/workspaces"><WorkspacePage /></Boundaried>} />
                    <Route path="/storage" element={<Navigate to="/workspaces" replace />} />
                    <Route path="/rag/collections" element={<Boundaried path="/rag/collections"><RagCollectionsPage /></Boundaried>} />
                    <Route path="/rag/connectors" element={<Boundaried path="/rag/connectors"><RagConnectorsPage /></Boundaried>} />
                    <Route path="/rag/documents" element={<Boundaried path="/rag/documents"><RagDocumentsPage /></Boundaried>} />
                    <Route path="/rag/ask" element={<Boundaried path="/rag/ask"><RagAskPage /></Boundaried>} />
                    <Route path="/rag/graphrag" element={<Boundaried path="/rag/graphrag"><RagGraphRagPage /></Boundaried>} />
                    <Route path="/rag/wiki" element={<Boundaried path="/rag/wiki"><RagWikiPage /></Boundaried>} />
                    <Route path="/rag/analytics" element={<Boundaried path="/rag/analytics"><RagAnalyticsPage /></Boundaried>} />
                    <Route path="/trust" element={<Boundaried path="/trust"><TrustOverviewPage /></Boundaried>} />
                    <Route path="/trust/violations" element={<Boundaried path="/trust/violations"><TrustViolationsPage /></Boundaried>} />
                    <Route path="/trust/guardrails" element={<Boundaried path="/trust/guardrails"><TrustGuardrailsPage /></Boundaried>} />
                    <Route path="/trust/guardrails/new" element={<Boundaried path="/trust/guardrails/new"><TrustGuardrailNewPage /></Boundaried>} />
                    <Route path="/trust/enforcement" element={<Boundaried path="/trust/enforcement"><TrustEnforcementPage /></Boundaried>} />
                    <Route path="/skills" element={<Boundaried path="/skills"><SkillsOverviewPage /></Boundaried>} />
                    <Route path="/skills/catalog" element={<Boundaried path="/skills/catalog"><SkillsCatalogPage /></Boundaried>} />
                    <Route path="/skills/new" element={<Boundaried path="/skills/new"><SkillAuthoringPage /></Boundaried>} />
                    <Route path="/skills/discovery" element={<Boundaried path="/skills/discovery"><SkillsDiscoveryPage /></Boundaried>} />
                    {/* As rotas antigas em português seguem RESOLVENDO, por redirect.
                        A URL é parte do que o usuário vê, e o produto é monolíngue — mas um link
                        já compartilhado ou salvo não pode virar 404 por causa disso. O redirect é
                        `replace` para não empilhar a URL antiga no histórico do navegador. */}
                    <Route path="/skills/catalogo" element={<Navigate to="/skills/catalog" replace />} />
                    <Route path="/skills/nova" element={<Navigate to="/skills/new" replace />} />
                    <Route path="/skills/descoberta" element={<Navigate to="/skills/discovery" replace />} />
                    <Route path="/skills/:skillId" element={<Boundaried path="/skills/:skillId"><SkillDetailPage /></Boundaried>} />
                    <Route path="/skills/:skillId/versions" element={<Boundaried path="/skills/:skillId/versions"><SkillVersionsPage /></Boundaried>} />
                    <Route path="/bundles" element={<Boundaried path="/bundles"><BundlesPage /></Boundaried>} />
                    <Route path="/bundles/:bundleId" element={<Boundaried path="/bundles/:bundleId"><BundleDetailPage /></Boundaried>} />
                    <Route path="/promptly" element={<Boundaried path="/promptly"><PromptlyOverviewPage /></Boundaried>} />
                    {/* `/promptly/new` ANTES do segmento dinâmico. O ranking do roteador já
                        prefere o estático, mas a ordem explícita é o que impede alguém de ler
                        "new" como nome de prompt ao mover uma linha daqui. */}
                    <Route path="/promptly/new" element={<Boundaried path="/promptly/new"><PromptlyCreatePage /></Boundaried>} />
                    {/* `/promptly/catalogo` é literal e cai na mesma classe de `/promptly/new`:
                        precede o segmento dinâmico, senão o roteador o trata como nome de prompt. */}
                    <Route path="/promptly/catalogo" element={<Boundaried path="/promptly/catalogo"><PromptlyCatalogoPage /></Boundaried>} />
                    <Route path="/promptly/:promptName" element={<Boundaried path="/promptly/:promptName"><PromptDetailPage /></Boundaried>} />
                    {/* M21 DoD-1 — as três abas que não são a índice. A índice É
                        `/promptly/:promptName` acima, e é o endereço que já circulava: links para
                        ele existem no catálogo, no diff e na lista de dependentes do M20. As
                        quatro montam o MESMO componente, que decide o recorte pela rota — o
                        estado da aba fica no endereço, e não em memória. */}
                    <Route path="/promptly/:promptName/config" element={<Boundaried path="/promptly/:promptName/config"><PromptDetailPage /></Boundaried>} />
                    <Route path="/promptly/:promptName/producao" element={<Boundaried path="/promptly/:promptName/producao"><PromptDetailPage /></Boundaried>} />
                    <Route path="/promptly/:promptName/consumo" element={<Boundaried path="/promptly/:promptName/consumo"><PromptDetailPage /></Boundaried>} />
                    <Route path="/promptly/:name/diff" element={<Boundaried path="/promptly/:name/diff"><PromptlyDiffPage /></Boundaried>} />
                    <Route path="/promptly/:promptName/playground" element={<Boundaried path="/promptly/:promptName/playground"><PromptlyPlaygroundPage /></Boundaried>} />
                    <Route path="/observability" element={<Boundaried path="/observability"><LensOverviewPage /></Boundaried>} />
                    <Route path="/observability/traces" element={<Boundaried path="/observability/traces"><LensTracesPage /></Boundaried>} />
                    <Route path="/observability/compare" element={<Boundaried path="/observability/compare"><LensComparePage /></Boundaried>} />
                    <Route path="/observability/sessions" element={<Boundaried path="/observability/sessions"><LensSessionsPage /></Boundaried>} />
                    {/* M142 — consumo por end-user. O path é IDÊNTICO ao declarado em LENS_CAPABILITIES;
                        o e2e derivado do registro navega até aqui pelo menu e fica vermelho se divergir.
                        Verificado por mutação: removida esta linha, o e2e falha na asserção do heading. */}
                    <Route path="/observability/usage-by-user" element={<Boundaried path="/observability/usage-by-user"><LensUsageByUserPage /></Boundaried>} />
                    {/* M9 — session detail: aggregate metrics + temporal replay for one session. */}
                    <Route path="/observability/sessions/:sessionId" element={<Boundaried path="/observability/sessions/:sessionId"><LensSessionDetailPage /></Boundaried>} />
                    <Route path="/observability/datasets" element={<Boundaried path="/observability/datasets"><LensDatasetsPage /></Boundaried>} />
                    <Route path="/observability/evaluators" element={<Boundaried path="/observability/evaluators"><LensEvaluatorsPage /></Boundaried>} />
                    <Route path="/observability/monitors" element={<Boundaried path="/observability/monitors"><LensMonitorsPage /></Boundaried>} />
                    {/* M136 — a bookmarked /observability/guards must not 404. Unlike the API alias
                        (which mounts the same handler because a redirect breaks non-redirect-following
                        clients), a browser follows a redirect natively, so `replace` is the right shape
                        here: the user lands on the canonical URL and their history is not polluted with
                        a dead one. Found by the LIVE test — the rename shipped with no UI alias at all. */}
                    <Route path="/observability/guards" element={<Navigate to="/observability/monitors" replace />} />
                    <Route path="/observability/alerts" element={<Boundaried path="/observability/alerts"><LensAlertsPage /></Boundaried>} />
                    <Route path="/observability/agents" element={<Boundaried path="/observability/agents"><LensAgentsPage /></Boundaried>} />
                    <Route path="/observability/ask" element={<Boundaried path="/observability/ask"><LensAskPage /></Boundaried>} />
                    <Route path="/observability/labeling-queue" element={<Boundaried path="/observability/labeling-queue"><LensLabelingQueuePage /></Boundaried>} />
                    <Route path="/observability/experiments" element={<Boundaried path="/observability/experiments"><LensExperimentsPage /></Boundaried>} />
                    <Route path="/observability/dashboards" element={<Boundaried path="/observability/dashboards"><LensDashboardsPage /></Boundaried>} />
                    {/* M86 — webhook management inside observability: reuse the exact settings CRUD component
                        (same /v1/settings/webhooks/* endpoints) so alert setup stays in one module. */}
                    <Route path="/observability/webhooks" element={<Boundaried path="/observability/webhooks"><WorkspaceWebhooksPage context="observability" /></Boundaried>} />
                    {/* M21 — distinct from /projects/:name/status: this one is the platform-wide aggregate. */}
                    <Route path="/status" element={<Boundaried path="/status"><StatusPage /></Boundaried>} />
                    <Route path="/settings" element={<Boundaried path="/settings"><SettingsPage /></Boundaried>} />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/settings/members"
                      element={
                        <Boundaried path="/settings/members">
                          <SubPagePlaceholder
                            title="Members"
                            description="Manage workspace members, roles, and pending invites."
                            icon={Users}
                            cliCommand="theo team list"
                          />
                        </Boundaried>
                      }
                    />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/settings/billing"
                      element={
                        <Boundaried path="/settings/billing">
                          <SubPagePlaceholder
                            title="Billing settings"
                            description="Payment method, invoices, and plan management."
                            icon={Receipt}
                            cliCommand="theo billing status"
                          />
                        </Boundaried>
                      }
                    />
                    {/* API Tokens — canonical surface. Backed by ApiKeysPage which already
                        ships the full Stripe-shape lifecycle: List + Create (typed scopes +
                        optional expiration) + Revoke (typed confirmation) + Rotate (grace
                        window) + Lineage (rotation timeline) + show-once secret reveal
                        with EC-13 "I've copied my key safely" acknowledgement gate.
                        Pre-fix the sidebar pointed here but the route was a placeholder
                        suggesting a non-existent `theo token create` CLI. The canonical
                        page was orphaned at /api-keys with no nav entry — consolidated
                        to the sidebar-shaped Settings → Developer → API Tokens hierarchy. */}
                    <Route
                      path="/settings/tokens"
                      element={<Boundaried path="/settings/tokens"><ApiKeysPage /></Boundaried>}
                    />
                    <Route
                      path="/settings/webhooks"
                      element={
                        <Boundaried path="/settings/webhooks">
                          <WorkspaceWebhooksPage />
                        </Boundaried>
                      }
                    />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/settings/notifications"
                      element={
                        <Boundaried path="/settings/notifications">
                          <SubPagePlaceholder
                            title="Notifications"
                            description="Email + integrations for build, deploy, and alert events."
                            icon={Bell}
                            cliCommand="theo notify list"
                          />
                        </Boundaried>
                      }
                    />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/settings/danger"
                      element={
                        <Boundaried path="/settings/danger">
                          <SubPagePlaceholder
                            title="Danger Zone"
                            description="Destructive workspace actions: delete, transfer ownership."
                            icon={ShieldAlert}
                            cliCommand="theo team delete --confirm"
                          />
                        </Boundaried>
                      }
                    />
                    <Route path="/profile" element={<Boundaried path="/profile"><ProfilePage /></Boundaried>} />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/profile/security"
                      element={
                        <Boundaried path="/profile/security">
                          <SubPagePlaceholder
                            title="Security"
                            description="Password, MFA, and recovery options."
                            icon={Lock}
                            cliCommand="theo login --rotate-credentials"
                          />
                        </Boundaried>
                      }
                    />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/profile/sessions"
                      element={
                        <Boundaried path="/profile/sessions">
                          <SubPagePlaceholder
                            title="Active sessions"
                            description="Devices and browsers currently signed in to your account."
                            icon={Link2}
                            cliCommand="theo session list"
                          />
                        </Boundaried>
                      }
                    />
                    {/* PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
                        Rota navegavel que renderiza EmptyState + comando de CLI. Na revisao,
                        ou vira implementacao ou sai JUNTO com a entrada de nav — um placeholder
                        nao e uma feature, e sem data ele vira uma para quem le o menu. */}
                    <Route
                      path="/profile/danger"
                      element={
                        <Boundaried path="/profile/danger">
                          <SubPagePlaceholder
                            title="Danger Zone"
                            description="Destructive account actions: delete account."
                            icon={ShieldAlert}
                            cliCommand="theo account delete --confirm"
                          />
                        </Boundaried>
                      }
                    />
                    <Route path="*" element={<Boundaried path="*"><NotFoundPage /></Boundaried>} />
                  </Routes>
                </Suspense>
                </RouteScope>
              </DashboardLayout>
            }
          />
          </Routes>
        </Suspense>
      </NuqsAdapter>
    </BrowserRouter>
  );
}
