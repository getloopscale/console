import { Route } from 'react-router-dom';
import { Boundaried } from '@/routes/boundaried';
import {
  RagAnalyticsPage,
  RagAskPage,
  RagCollectionsPage,
  RagConnectorsPage,
  RagDocumentsPage,
  RagGraphRagPage,
  RagWikiPage,
} from '@/app-routes-lazy';

/**
 * As rotas do domínio `rag` (B-003).
 *
 * Um VALOR JSX, e não um componente: `<Routes>` só percorre `<Route>` e
 * `React.Fragment`, e ignora qualquer outro elemento EM SILÊNCIO — um
 * componente aqui faria o domínio inteiro virar 404 com a suíte verde.
 * `subtree-wiring.test.tsx` pergunta isso ao próprio react-router.
 */
export const rotasDeRag = (
  <>
    <Route path="/rag/collections" element={<Boundaried path="/rag/collections"><RagCollectionsPage /></Boundaried>} />
    <Route path="/rag/connectors" element={<Boundaried path="/rag/connectors"><RagConnectorsPage /></Boundaried>} />
    <Route path="/rag/documents" element={<Boundaried path="/rag/documents"><RagDocumentsPage /></Boundaried>} />
    <Route path="/rag/ask" element={<Boundaried path="/rag/ask"><RagAskPage /></Boundaried>} />
    <Route path="/rag/graphrag" element={<Boundaried path="/rag/graphrag"><RagGraphRagPage /></Boundaried>} />
    <Route path="/rag/wiki" element={<Boundaried path="/rag/wiki"><RagWikiPage /></Boundaried>} />
    <Route path="/rag/analytics" element={<Boundaried path="/rag/analytics"><RagAnalyticsPage /></Boundaried>} />
  </>
);
