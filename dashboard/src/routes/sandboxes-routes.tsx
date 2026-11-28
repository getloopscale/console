import { Route } from 'react-router-dom';
import { Boundaried } from '@/routes/boundaried';
import {
  SandboxDetailPage,
  SandboxSecretsPage,
  SandboxTemplatesPage,
  SandboxesPage,
} from '@/app-routes-lazy';

/**
 * The routes of the Sandboxes area.
 *
 * A JSX value and not a component: `<Routes>` walks `<Route>` and fragments
 * only, and skips any other element without a word, which would turn the whole
 * area into a 404. `subtree-wiring.test.tsx` asks react-router what it sees.
 *
 * The two named screens come before `:id`, though react-router ranks a static
 * segment above a parameter either way.
 */
export const sandboxRoutes = (
  <>
    <Route path="/sandboxes" element={<Boundaried path="/sandboxes"><SandboxesPage /></Boundaried>} />
    <Route path="/sandboxes/templates" element={<Boundaried path="/sandboxes/templates"><SandboxTemplatesPage /></Boundaried>} />
    <Route path="/sandboxes/secrets" element={<Boundaried path="/sandboxes/secrets"><SandboxSecretsPage /></Boundaried>} />
    <Route path="/sandboxes/:id" element={<Boundaried path="/sandboxes/:id"><SandboxDetailPage /></Boundaried>} />
  </>
);
