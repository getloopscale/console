import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import {
  Bell,
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
const OverviewPage = lazy(() =>
  import('@/pages/overview').then((m) => ({ default: m.OverviewPage })),
);
const ProjectsPage = lazy(() =>
  import('@/pages/projects').then((m) => ({ default: m.ProjectsPage })),
);
const EnvironmentsPage = lazy(() =>
  import('@/pages/environments').then((m) => ({ default: m.EnvironmentsPage })),
);
const TeamPage = lazy(() =>
  import('@/pages/team').then((m) => ({ default: m.TeamPage })),
);
const BillingPage = lazy(() =>
  import('@/pages/billing').then((m) => ({ default: m.BillingPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage })),
);
const ProfilePage = lazy(() =>
  import('@/pages/profile').then((m) => ({ default: m.ProfilePage })),
);
const DomainsPage = lazy(() =>
  import('@/pages/domains').then((m) => ({ default: m.DomainsPage })),
);
const ApiKeysPage = lazy(() =>
  import('@/pages/api-keys').then((m) => ({ default: m.ApiKeysPage })),
);
const MemoryPage = lazy(() =>
  import('@/pages/memory').then((m) => ({ default: m.MemoryPage })),
);
const MemoryListPage = lazy(() =>
  import('@/pages/memory/memories').then((m) => ({ default: m.MemoryListPage })),
);
const EntitiesPage = lazy(() =>
  import('@/pages/memory/entities').then((m) => ({ default: m.EntitiesPage })),
);
const EpisodesPage = lazy(() =>
  import('@/pages/memory/episodes').then((m) => ({ default: m.EpisodesPage })),
);
const GraphPage = lazy(() =>
  import('@/pages/memory/graph').then((m) => ({ default: m.GraphPage })),
);
const ExportsPage = lazy(() =>
  import('@/pages/memory/exports').then((m) => ({ default: m.ExportsPage })),
);
const WebhooksPage = lazy(() =>
  import('@/pages/memory/webhooks').then((m) => ({ default: m.WebhooksPage })),
);
const WorkspaceWebhooksPage = lazy(() =>
  import('@/pages/settings/webhooks').then((m) => ({ default: m.WorkspaceWebhooksPage })),
);
const PlaygroundPage = lazy(() =>
  import('@/pages/memory/playground').then((m) => ({ default: m.PlaygroundPage })),
);
const SkillsPage = lazy(() =>
  import('@/pages/memory/skills').then((m) => ({ default: m.SkillsPage })),
);
const RagOverviewPage = lazy(() =>
  import('@/pages/rag').then((m) => ({ default: m.RagOverviewPage })),
);
const WorkspacePage = lazy(() =>
  import('@/pages/workspace').then((m) => ({ default: m.WorkspacePage })),
);
const RagCollectionsPage = lazy(() =>
  import('@/pages/rag/collections').then((m) => ({ default: m.RagCollectionsPage })),
);
const RagConnectorsPage = lazy(() =>
  import('@/pages/rag/connectors').then((m) => ({ default: m.RagConnectorsPage })),
);
const RagDocumentsPage = lazy(() =>
  import('@/pages/rag/documents').then((m) => ({ default: m.RagDocumentsPage })),
);
const RagAskPage = lazy(() =>
  import('@/pages/rag/ask').then((m) => ({ default: m.RagAskPage })),
);
const RagAnalyticsPage = lazy(() =>
  import('@/pages/rag/analytics').then((m) => ({ default: m.RagAnalyticsPage })),
);
const RagGraphRagPage = lazy(() =>
  import('@/pages/rag/graphrag').then((m) => ({ default: m.RagGraphRagPage })),
);
const RagWikiPage = lazy(() =>
  import('@/pages/rag/wiki').then((m) => ({ default: m.RagWikiPage })),
);
// M44 — lens management dashboard pages; M46 — Overview landing
const LensOverviewPage = lazy(() =>
  import('@/pages/lens').then((m) => ({ default: m.LensOverviewPage })),
);
const LensTracesPage = lazy(() =>
  import('@/pages/lens/traces').then((m) => ({ default: m.LensTracesPage })),
);
const LensSessionsPage = lazy(() =>
  import('@/pages/lens/sessions').then((m) => ({ default: m.LensSessionsPage })),
);
const LensSessionDetailPage = lazy(() =>
  import('@/pages/lens/session-detail').then((m) => ({ default: m.LensSessionDetailPage })),
);
const LensDatasetsPage = lazy(() =>
  import('@/pages/lens/datasets').then((m) => ({ default: m.LensDatasetsPage })),
);
const LensEvaluatorsPage = lazy(() =>
  import('@/pages/lens/evaluators').then((m) => ({ default: m.LensEvaluatorsPage })),
);
const LensGuardsPage = lazy(() =>
  import('@/pages/lens/guards').then((m) => ({ default: m.LensGuardsPage })),
);
const LensAlertsPage = lazy(() =>
  import('@/pages/lens/alerts').then((m) => ({ default: m.LensAlertsPage })),
);
const LensComparePage = lazy(() =>
  import('@/pages/lens/compare').then((m) => ({ default: m.LensComparePage })),
);
const LensAgentsPage = lazy(() =>
  import('@/pages/lens/agents').then((m) => ({ default: m.LensAgentsPage })),
);
const LensAskPage = lazy(() =>
  import('@/pages/lens/ask').then((m) => ({ default: m.LensAskPage })),
);
const LensLabelingQueuePage = lazy(() =>
  import('@/pages/lens/labeling-queue').then((m) => ({ default: m.LensLabelingQueuePage })),
);
const LensExperimentsPage = lazy(() =>
  import('@/pages/lens/experiments').then((m) => ({ default: m.LensExperimentsPage })),
);
const LensDashboardsPage = lazy(() =>
  import('@/pages/lens/dashboards').then((m) => ({ default: m.LensDashboardsPage })),
);
const LoginPage = lazy(() =>
  import('@/pages/login').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('@/pages/register').then((m) => ({ default: m.RegisterPage })),
);
// Red Team theo/theo#162 (2026-07-01): SPA-side page for the post-signup
// redirect target /auth/check-email that previously 404'd against the BFF.
const CheckEmailPage = lazy(() =>
  import('@/pages/check-email').then((m) => ({ default: m.CheckEmailPage })),
);
const VerificationPage = lazy(() =>
  import('@/pages/verification').then((m) => ({ default: m.VerificationPage })),
);
const RecoveryPage = lazy(() =>
  import('@/pages/recovery').then((m) => ({ default: m.RecoveryPage })),
);
const DeviceSuccessPage = lazy(() =>
  import('@/pages/device-success').then((m) => ({ default: m.DeviceSuccessPage })),
);
const DeviceVerifyPage = lazy(() =>
  import('@/pages/device-verify').then((m) => ({ default: m.DeviceVerifyPage })),
);
const ProjectDetailPage = lazy(() =>
  import('@/pages/project-detail').then((m) => ({ default: m.ProjectDetailPage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })),
);
const DeploymentsPage = lazy(() =>
  import('@/pages/deployments').then((m) => ({ default: m.DeploymentsPage })),
);
// Plan J-17 T5.1: layout + 4 tabs replace the 4 sibling routes below.
const DeploymentDetailLayout = lazy(() =>
  import('@/pages/deployment-detail-layout').then((m) => ({ default: m.DeploymentDetailLayout })),
);
const TimelineTab = lazy(() =>
  import('@/pages/deployment-tabs/timeline-tab').then((m) => ({ default: m.TimelineTab })),
);
const LogsTab = lazy(() =>
  import('@/pages/deployment-tabs/logs-tab').then((m) => ({ default: m.LogsTab })),
);
const SBOMTab = lazy(() =>
  import('@/pages/deployment-tabs/sbom-tab').then((m) => ({ default: m.SBOMTab })),
);
const AttestationTab = lazy(() =>
  import('@/pages/deployment-tabs/attestation-tab').then((m) => ({ default: m.AttestationTab })),
);
// Legacy pages kept as fallback for direct deep links (e.g., emails) —
// nested routes below take precedence inside the new layout.
const BuildLogsPage = lazy(() =>
  import('@/pages/build-logs').then((m) => ({ default: m.BuildLogsPage })),
);
const BuildSBOMPage = lazy(() =>
  import('@/pages/build-sbom').then((m) => ({ default: m.BuildSBOMPage })),
);
const BuildAttestationPage = lazy(() =>
  import('@/pages/build-attestation').then((m) => ({ default: m.BuildAttestationPage })),
);
// Suppress "unused" lints while the legacy pages exist as fallback.
void BuildLogsPage;
void BuildSBOMPage;
void BuildAttestationPage;
const RuntimeLogsPage = lazy(() =>
  import('@/pages/runtime-logs').then((m) => ({ default: m.RuntimeLogsPage })),
);
const ProjectStatusPage = lazy(() =>
  import('@/pages/project-status').then((m) => ({ default: m.ProjectStatusPage })),
);
const SecretsPage = lazy(() =>
  import('@/pages/secrets').then((m) => ({ default: m.SecretsPage })),
);
// PreviewsPage deleted per plan 2026-06-08-dashboard-screens-review-fixes
// T1.1 + ADR D1: the multi-row preview table is semantically obsolete
// under the post-M2 single-slot preview model. /projects/:name/previews
// now 301-equivalent client-redirects to /environments?project=:name where
// the single preview slot is rendered inline via PreviewRow.
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

const ProjectConnectPage = lazy(() =>
  import('@/pages/project-connect').then((m) => ({ default: m.ProjectConnectPage })),
);
const AuditPage = lazy(() =>
  import('@/pages/audit').then((m) => ({ default: m.AuditPage })),
);
const ProjectScalePage = lazy(() =>
  import('@/pages/project-scale').then((m) => ({ default: m.ProjectScalePage })),
);
const ProjectReadinessPage = lazy(() =>
  import('@/pages/project-readiness').then((m) => ({ default: m.ProjectReadinessPage })),
);

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
                    <Route path="/workspaces" element={<Boundaried path="/workspaces"><WorkspacePage /></Boundaried>} />
                    <Route path="/storage" element={<Navigate to="/workspaces" replace />} />
                    <Route path="/rag/collections" element={<Boundaried path="/rag/collections"><RagCollectionsPage /></Boundaried>} />
                    <Route path="/rag/connectors" element={<Boundaried path="/rag/connectors"><RagConnectorsPage /></Boundaried>} />
                    <Route path="/rag/documents" element={<Boundaried path="/rag/documents"><RagDocumentsPage /></Boundaried>} />
                    <Route path="/rag/ask" element={<Boundaried path="/rag/ask"><RagAskPage /></Boundaried>} />
                    <Route path="/rag/graphrag" element={<Boundaried path="/rag/graphrag"><RagGraphRagPage /></Boundaried>} />
                    <Route path="/rag/wiki" element={<Boundaried path="/rag/wiki"><RagWikiPage /></Boundaried>} />
                    <Route path="/rag/analytics" element={<Boundaried path="/rag/analytics"><RagAnalyticsPage /></Boundaried>} />
                    <Route path="/observability" element={<Boundaried path="/observability"><LensOverviewPage /></Boundaried>} />
                    <Route path="/observability/traces" element={<Boundaried path="/observability/traces"><LensTracesPage /></Boundaried>} />
                    <Route path="/observability/compare" element={<Boundaried path="/observability/compare"><LensComparePage /></Boundaried>} />
                    <Route path="/observability/sessions" element={<Boundaried path="/observability/sessions"><LensSessionsPage /></Boundaried>} />
                    {/* M9 — session detail: aggregate metrics + temporal replay for one session. */}
                    <Route path="/observability/sessions/:sessionId" element={<Boundaried path="/observability/sessions/:sessionId"><LensSessionDetailPage /></Boundaried>} />
                    <Route path="/observability/datasets" element={<Boundaried path="/observability/datasets"><LensDatasetsPage /></Boundaried>} />
                    <Route path="/observability/evaluators" element={<Boundaried path="/observability/evaluators"><LensEvaluatorsPage /></Boundaried>} />
                    <Route path="/observability/guards" element={<Boundaried path="/observability/guards"><LensGuardsPage /></Boundaried>} />
                    <Route path="/observability/alerts" element={<Boundaried path="/observability/alerts"><LensAlertsPage /></Boundaried>} />
                    <Route path="/observability/agents" element={<Boundaried path="/observability/agents"><LensAgentsPage /></Boundaried>} />
                    <Route path="/observability/ask" element={<Boundaried path="/observability/ask"><LensAskPage /></Boundaried>} />
                    <Route path="/observability/labeling-queue" element={<Boundaried path="/observability/labeling-queue"><LensLabelingQueuePage /></Boundaried>} />
                    <Route path="/observability/experiments" element={<Boundaried path="/observability/experiments"><LensExperimentsPage /></Boundaried>} />
                    <Route path="/observability/dashboards" element={<Boundaried path="/observability/dashboards"><LensDashboardsPage /></Boundaried>} />
                    {/* M86 — webhook management inside observability: reuse the exact settings CRUD component
                        (same /v1/settings/webhooks/* endpoints) so alert setup stays in one module. */}
                    <Route path="/observability/webhooks" element={<Boundaried path="/observability/webhooks"><WorkspaceWebhooksPage context="observability" /></Boundaried>} />
                    <Route path="/settings" element={<Boundaried path="/settings"><SettingsPage /></Boundaried>} />
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
