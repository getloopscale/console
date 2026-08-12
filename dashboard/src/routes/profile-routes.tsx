import { Route } from 'react-router-dom';
import { Link2, Lock, ShieldAlert } from 'lucide-react';
import { Boundaried } from '@/routes/boundaried';
import { SubPagePlaceholder } from '@/pages/sub-page-placeholder';
import {
  ProfilePage,
} from '@/app-routes-lazy';

/**
 * As rotas do domínio `profile` (B-003).
 *
 * Um VALOR JSX, e não um componente: `<Routes>` só percorre `<Route>` e
 * `React.Fragment`, e ignora qualquer outro elemento EM SILÊNCIO — um
 * componente aqui faria o domínio inteiro virar 404 com a suíte verde.
 * `subtree-wiring.test.tsx` pergunta isso ao próprio react-router.
 */
export const rotasDeProfile = (
  <>
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
    />
    </Boundaried>
    }
    />
  </>
);
