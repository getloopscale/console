import { Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import {
  Database,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { SubPagePlaceholder } from '@/pages/sub-page-placeholder';
import { Boundaried } from '@/routes/boundaried';
import { rotasDeProjects } from '@/routes/projects-routes';
import { rotasDeTrust } from '@/routes/trust-routes';
import { rotasDeMemory } from '@/routes/memory-routes';
import { rotasDeRag } from '@/routes/rag-routes';
import { rotasDeSkills } from '@/routes/skills-routes';
import { rotasDePromptly } from '@/routes/promptly-routes';
import { rotasDeObservability } from '@/routes/observability-routes';
import { rotasDeSettings } from '@/routes/settings-routes';
import { rotasDeProfile } from '@/routes/profile-routes';
import { PlanLimitUpgradeModal } from '@/components/dialogs/plan-limit-upgrade-modal';
import { SessionExpiredNotice } from '@/components/session-expired-notice';
import { RouteLoading } from '@/components/loading/route-loading';
// Red Team #93 — parent-project existence guard for every per-project
// sub-route. Renders "Project not found" instead of letting the sub-view
// render functional UI on top of an empty data set when the URL slug is
// a deleted/non-existent project.
import {
  ApiKeysPage,
  AuditPage,
  BillingPage,
  BundleDetailPage,
  BundlesPage,
  CheckEmailPage,
  DeviceSuccessPage,
  DeviceVerifyPage,
  DomainsRedirect,
  LoginPage,
  NotFoundPage,
  OverviewPage,
  RagOverviewPage,
  RecoveryPage,
  RegisterPage,
  StatusPage,
  TeamPage,
  VerificationPage,
  SandboxesPage,
  WorkspacePage,
} from '@/app-routes-lazy';

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

// Red Team loop-console#58/#73 closure: wrap the dashboard inner Routes
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
// through the @getloopscale/ui Toaster contract, so we use a `useToast`
// shadow-tracking approach via a small registry mounted alongside.
function RouteScope({ children }: { children: ReactNode }) {
  const location = useLocation();
  // Radix scroll-lock stuck fix (radix-ui/primitives#2122). Quando um overlay do
  // @getloopscale/ui (Select / DropdownMenu / Dialog — todos Radix) está ABERTO e o
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
            loopscale:plan-limit window events emitted by the 402 interceptor in
            lib/api.ts. Single mount covers every surface (envs / secrets /
            projects / future verticals). Modal is closed by default; opens
            only on 402. */}
        <PlanLimitUpgradeModal />
        {/* B-218 — mesmo padrão, segundo evento: `lib/http/api.ts` anuncia `loopscale:session-expired`
            e este componente decide o que aparece. Antes o próprio cliente HTTP montava o `<div>`
            e o estilizava por `cssText`. Montagem única, como o modal acima. */}
        <SessionExpiredNotice />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
          <Route path="/login" element={<Boundaried path="/login"><LoginPage /></Boundaried>} />
          <Route path="/register" element={<Boundaried path="/register"><RegisterPage /></Boundaried>} />
          {/* T1.4 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #22.
            * /signup is the intuitive URL new users try; map to /register via
            * SPA-side Navigate per ADR D5. `replace` keeps history clean. */}
          <Route path="/signup" element={<Navigate to="/register" replace />} />
          {/* Red Team loop-console#55 closure: /registration is the second
            * intuitive URL (matches the noun "registration"). Map to
            * /register via SPA-side Navigate — same shape as the /signup
            * alias above. Replaces the prior fall-through that sent
            * unauthenticated users to /login with a misleading "Session
            * expired" toast (a fresh browser never had a session to
            * expire). */}
          <Route path="/registration" element={<Navigate to="/register" replace />} />
          <Route path="/verification" element={<Boundaried path="/verification"><VerificationPage /></Boundaried>} />
          {/*
            * Red Team loopscale/loopscale#162 (2026-07-01): the post-signup redirect
            * target /auth/check-email + email verify link /auth/verify used
            * to return 404 Caddy raw because the Caddyfile handle /auth/*
            * proxied everything to the loop-console BFF (which only serves
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
                {/* Red Team loop-console#58/#73 closure: wrap the inner
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
                    {rotasDeProjects}
                    {/* Plan J-17 T5.1: nested layout with Outlet replaces
                        the four sibling routes. Index = TimelineTab. */}
                    {/* Red Team loop-console#102 closure: /projects/:name/
                      * repository was an orphan deep-link (404). Canonical
                      * destination is /connect. */}
                    <Route path="/audit" element={<Boundaried path="/audit"><AuditPage /></Boundaried>} />
                    {/* M20: environments are a project dimension — the page lives
                        under the project (unambiguous scope, no project-guess). The
                        old global /environments redirects so bookmarks don't 404. */}
                    <Route path="/environments" element={<Navigate to="/projects" replace />} />
                    <Route path="/team" element={<Boundaried path="/team"><TeamPage /></Boundaried>} />
                    <Route path="/billing" element={<Boundaried path="/billing"><BillingPage /></Boundaried>} />
                    {/* Domains live inside a project; the old address redirects. */}
                    <Route path="/domains" element={<Boundaried path="/domains"><DomainsRedirect /></Boundaried>} />
                    {/* Canonical API token URL is /settings/tokens (sidebar → Settings → Developer
                        → API Tokens). /api-keys kept as redirect for backward compat with bookmarks
                        and any external link issued before the consolidation. */}
                    <Route path="/api-keys" element={<Navigate to="/settings/tokens" replace />} />
                    {/* Top-level main-menu surface for API Tokens (keeps the root
                        sidebar active — /settings/* would drill into Settings).
                        Same ApiKeysPage as the canonical /settings/tokens route. */}
                    <Route path="/tokens" element={<Boundaried path="/tokens"><ApiKeysPage /></Boundaried>} />
                    {rotasDeMemory}
                    <Route path="/rag" element={<Boundaried path="/rag"><RagOverviewPage /></Boundaried>} />
                    {/* PLACEHOLDER · revisar ate 2026-11-07. Databases e uma capacidade
                        ANUNCIADA no menu (comingSoon) e ainda nao construida. A rota existe para
                        que o item nao leve a lugar nenhum, e a tela diz o que fara.

                        SEM `cliCommand` DE PROPOSITO: nao ha comando `loopscale db` hoje. Sugerir um
                        seria mentir de forma mais convincente que a ausencia — o placeholder
                        existe justamente para nao afirmar o que nao existe.

                        Na revisao: ou vira implementacao, ou sai JUNTO com a entrada do menu. */}
                    <Route
                      path="/databases"
                      element={
                        <Boundaried path="/databases">
                          <SubPagePlaceholder
                            title="Databases"
                            description="Provision and operate managed databases for your projects, with backup, restore and connection by environment variable."
                            icon={Database}
                          />
                        </Boundaried>
                      }
                    />
                    <Route path="/sandboxes" element={<Boundaried path="/sandboxes"><SandboxesPage /></Boundaried>} />
                    <Route path="/workspaces" element={<Boundaried path="/workspaces"><WorkspacePage /></Boundaried>} />
                    <Route path="/storage" element={<Navigate to="/workspaces" replace />} />
                    {rotasDeRag}
                    {rotasDeTrust}
                    {rotasDeSkills}
                    <Route path="/bundles" element={<Boundaried path="/bundles"><BundlesPage /></Boundaried>} />
                    <Route path="/bundles/:bundleId" element={<Boundaried path="/bundles/:bundleId"><BundleDetailPage /></Boundaried>} />
                    {rotasDePromptly}
                    {rotasDeObservability}
                    {/* M21 — distinct from /projects/:name/status: this one is the platform-wide aggregate. */}
                    <Route path="/status" element={<Boundaried path="/status"><StatusPage /></Boundaried>} />
                    {rotasDeSettings}
                    {rotasDeProfile}
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
