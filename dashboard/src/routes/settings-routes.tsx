import { Navigate, Route } from 'react-router-dom';
import { Bell, ShieldAlert } from 'lucide-react';
import { Boundaried } from '@/routes/boundaried';
import { SubPagePlaceholder } from '@/pages/sub-page-placeholder';
import {
  ApiKeysPage,
  SettingsPage,
  WorkspaceWebhooksPage,
} from '@/app-routes-lazy';

/**
 * As rotas do domínio `settings` (B-003).
 *
 * Um VALOR JSX, e não um componente: `<Routes>` só percorre `<Route>` e
 * `React.Fragment`, e ignora qualquer outro elemento EM SILÊNCIO — um
 * componente aqui faria o domínio inteiro virar 404 com a suíte verde.
 * `subtree-wiring.test.tsx` pergunta isso ao próprio react-router.
 */
export const rotasDeSettings = (
  <>
    <Route path="/settings" element={<Boundaried path="/settings"><SettingsPage /></Boundaried>} />
    {/* B-206 — esta rota renderizava um placeholder que SOMBREAVA uma tela já entregue
        (/team), alcançável só por um bookmark antigo: quem chegasse por ele via "ainda
        estamos construindo" sobre uma funcionalidade que existe. O menu já aponta para
        /team. O tratamento é o mesmo que /api-keys recebeu — redirecionar, não manter
        duas portas com uma mentindo. */}
    <Route path="/settings/members" element={<Navigate to="/team" replace />} />
    {/* B-206 — esta rota renderizava um placeholder que SOMBREAVA uma tela já entregue
        (/billing), alcançável só por um bookmark antigo: quem chegasse por ele via "ainda
        estamos construindo" sobre uma funcionalidade que existe. O menu já aponta para
        /billing. O tratamento é o mesmo que /api-keys recebeu — redirecionar, não manter
        duas portas com uma mentindo. */}
    <Route path="/settings/billing" element={<Navigate to="/billing" replace />} />
    {/* API Tokens — canonical surface. Backed by ApiKeysPage which already
    ships the full Stripe-shape lifecycle: List + Create (typed scopes +
    optional expiration) + Revoke (typed confirmation) + Rotate (grace
    window) + Lineage (rotation timeline) + show-once secret reveal
    with EC-13 "I've copied my key safely" acknowledgement gate.
    Pre-fix the sidebar pointed here but the route was a placeholder
    suggesting a non-existent `loopscale token create` CLI. The canonical
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
    />
    </Boundaried>
    }
    />
  </>
);
