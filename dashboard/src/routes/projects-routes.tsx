import { Route, Navigate, useParams } from 'react-router-dom';
import { Boundaried } from '@/routes/boundaried';
import { ProjectGuard } from '@/components/project/project-guard';
import {
  ProjectDetailPage,
  ProjectsPage,
  AttestationTab,
  DeploymentDetailLayout,
  DeploymentsPage,
  DomainsPage,
  RollbackDetailPage,
  EnvironmentsPage,
  LogsTab,
  ProjectConnectPage,
  ProjectReadinessPage,
  ProjectScalePage,
  ProjectStatusPage,
  RuntimeLogsPage,
  SBOMTab,
  SecretsPage,
  TimelineTab,
} from '@/app-routes-lazy';

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

// Red Team loop-console#102 closure: /projects/:name/repository was a dead
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

/**
 * As rotas do domínio de projetos (B-003) — o maior subtree, 13 rotas.
 *
 * ## Os dois redirects vieram junto
 *
 * `PreviewsRedirect` e `RepositoryAlias` são decisão de roteamento, e a nota
 * do primeiro corte dizia que por isso pertenciam "à árvore que os aplica".
 * Continua valendo — e a árvore que os aplica é ESTA, não mais o `app.tsx`.
 *
 * Deixá-los na origem fecharia um ciclo: `app.tsx` importaria estas rotas, e
 * elas importariam o `app.tsx` de volta. Cada um tem exatamente um
 * consumidor, que é o critério da regra de residência.
 */
export const rotasDeProjects = (
  <>
    <Route path="/projects" element={<Boundaried path="/projects"><ProjectsPage /></Boundaried>} />
    <Route path="/projects/:name" element={<Boundaried path="/projects/:name"><ProjectDetailPage /></Boundaried>} />
    <Route
    path="/projects/:name/deployments"
    element={<Boundaried path="/projects/:name/deployments"><ProjectGuard><DeploymentsPage /></ProjectGuard></Boundaried>}
    />
    <Route
    path="/projects/:name/deployments/rollbacks/:rollbackId"
    element={<Boundaried path="/projects/:name/deployments/rollbacks/:rollbackId"><ProjectGuard><RollbackDetailPage /></ProjectGuard></Boundaried>}
    />
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
    <Route
    path="/projects/:name/repository"
    element={<ProjectGuard><RepositoryAlias /></ProjectGuard>}
    />
    <Route
    path="/projects/:name/scale"
    element={<Boundaried path="/projects/:name/scale"><ProjectGuard><ProjectScalePage /></ProjectGuard></Boundaried>}
    />
    <Route
    path="/projects/:name/readiness"
    element={<Boundaried path="/projects/:name/readiness"><ProjectGuard><ProjectReadinessPage /></ProjectGuard></Boundaried>}
    />
    <Route
    path="/projects/:name/domains"
    element={<Boundaried path="/projects/:name/domains"><ProjectGuard><DomainsPage /></ProjectGuard></Boundaried>}
    />
    <Route
    path="/projects/:name/environments"
    element={<Boundaried path="/projects/:name/environments"><ProjectGuard><EnvironmentsPage /></ProjectGuard></Boundaried>}
    />
  </>
);
