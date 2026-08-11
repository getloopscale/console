import { Route } from 'react-router-dom';
import { Boundaried } from '@/routes/boundaried';
import {
  EntitiesPage,
  EpisodesPage,
  ExportsPage,
  GraphPage,
  MemoryListPage,
  MemoryPage,
  PlaygroundPage,
  SkillsPage,
  WebhooksPage,
} from '@/app-routes-lazy';

/**
 * As rotas do domínio `memory` (B-003).
 *
 * Um VALOR JSX, e não um componente: `<Routes>` só percorre `<Route>` e
 * `React.Fragment`, e ignora qualquer outro elemento EM SILÊNCIO — um
 * componente aqui faria o domínio inteiro virar 404 com a suíte verde.
 * `subtree-wiring.test.tsx` pergunta isso ao próprio react-router.
 */
export const rotasDeMemory = (
  <>
    <Route path="/memory" element={<Boundaried path="/memory"><MemoryPage /></Boundaried>} />
    <Route path="/memory/memories" element={<Boundaried path="/memory/memories"><MemoryListPage /></Boundaried>} />
    <Route path="/memory/entities" element={<Boundaried path="/memory/entities"><EntitiesPage /></Boundaried>} />
    <Route path="/memory/episodes" element={<Boundaried path="/memory/episodes"><EpisodesPage /></Boundaried>} />
    <Route path="/memory/graph" element={<Boundaried path="/memory/graph"><GraphPage /></Boundaried>} />
    <Route path="/memory/exports" element={<Boundaried path="/memory/exports"><ExportsPage /></Boundaried>} />
    <Route path="/memory/webhooks" element={<Boundaried path="/memory/webhooks"><WebhooksPage /></Boundaried>} />
    <Route path="/memory/playground" element={<Boundaried path="/memory/playground"><PlaygroundPage /></Boundaried>} />
    <Route path="/memory/skills" element={<Boundaried path="/memory/skills"><SkillsPage /></Boundaried>} />
  </>
);
