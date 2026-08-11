import { Route, Navigate } from 'react-router-dom';
import { Boundaried } from '@/routes/boundaried';
import {
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
  WorkspaceWebhooksPage,
} from '@/app-routes-lazy';

/**
 * As rotas do domínio `observability` (B-003).
 *
 * Um VALOR JSX, e não um componente: `<Routes>` só percorre `<Route>` e
 * `React.Fragment`, e ignora qualquer outro elemento EM SILÊNCIO — um
 * componente aqui faria o domínio inteiro virar 404 com a suíte verde.
 * `subtree-wiring.test.tsx` pergunta isso ao próprio react-router.
 */
export const rotasDeObservability = (
  <>
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
  </>
);
