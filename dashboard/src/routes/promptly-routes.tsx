import { Route } from 'react-router-dom';
import { Boundaried } from '@/routes/boundaried';
import {
  PromptDetailPage,
  PromptlyCatalogoPage,
  PromptlyCreatePage,
  PromptlyDiffPage,
  PromptlyOverviewPage,
  PromptlyPlaygroundPage,
} from '@/app-routes-lazy';

/**
 * As rotas do domínio `promptly` (B-003).
 *
 * Um VALOR JSX, e não um componente: `<Routes>` só percorre `<Route>` e
 * `React.Fragment`, e ignora qualquer outro elemento EM SILÊNCIO — um
 * componente aqui faria o domínio inteiro virar 404 com a suíte verde.
 * `subtree-wiring.test.tsx` pergunta isso ao próprio react-router.
 */
export const rotasDePromptly = (
  <>
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
  </>
);
