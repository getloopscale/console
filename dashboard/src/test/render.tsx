import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { Toaster } from '@usetheo/ui';
import { ThemeProvider } from '@theokit/ui';
import { TEMA_LOOPSCALE } from '@/lib/theme/loopscale-theme';
import { PageMetaProvider } from '@/hooks/use-page-meta';
import type { ReactElement, ReactNode } from 'react';

interface RenderProvidersProps {
  children: ReactNode;
  initialEntries?: string[];
  historyRouter?: boolean;
}

/**
 * Test wrapper providing the same context chain as production:
 *   QueryClientProvider (test client) > ThemeProvider > Toaster > MemoryRouter > PageMetaProvider
 *
 * MemoryRouter uses initialEntries to set the active route for tests.
 *
 * Test QueryClient (EC-08 fold): retry:false (deterministic failures, no
 * exponential backoff em test), gcTime:0 (no cache leak entre tests).
 * Fresh client per render call so test isolation is preserved.
 */
function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function AllProviders({ children, initialEntries = ['/'], historyRouter = false }: RenderProvidersProps) {
  const client = makeTestQueryClient();
  // B-240 — `historyRouter` opts a case into the router PRODUCTION uses.
  //
  // MemoryRouter keeps its location in memory and never touches `window.history`. Most cases
  // want that: it is fast and isolated. But nuqs's react-router adapter reads
  // `window.location.search` at mount and afterwards updates only on `popstate` or on nuqs's
  // own emitter — and the thing that connects react-router's `setSearchParams` to that emitter
  // is nuqs PATCHING `history.pushState`. Under MemoryRouter that patch has nothing to observe.
  //
  // So a case exercising a path where react-router writes the URL and nuqs must read it back
  // is, under MemoryRouter, testing a mechanism that is switched off. Measured: applying a
  // saved view produced ONE request under MemoryRouter and TWO under BrowserRouter, and the
  // page is identical. That is a harness that reports a defect the product does not have.
  //
  // Cases using this MUST seed `window.history.replaceState` themselves — BrowserRouter starts
  // wherever jsdom's URL happens to be, and `initialEntries` is meaningless to it.
  const Router = historyRouter ? BrowserRouter : MemoryRouter;
  const routerProps = historyRouter ? {} : { initialEntries };
  // NuqsAdapter MUST be inside MemoryRouter (consumes router context).
  return (
    <QueryClientProvider client={client}>
      {/* B-007 — a MESMA config do app (`lib/theme/loopscale-theme.ts`), e não uma
          cópia. Antes daqui a árvore de teste montava o `violetForge` cru e
          seguia o `prefers-color-scheme` do ambiente: a suíte inteira
          renderizava em modo CLARO, com um `--primary` que o app nunca mostra. */}
      <ThemeProvider {...TEMA_LOOPSCALE}>
        <Toaster>
          <Router {...routerProps}>
            <NuqsAdapter>
              <PageMetaProvider>{children}</PageMetaProvider>
            </NuqsAdapter>
          </Router>
        </Toaster>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
  /**
   * Mount under BrowserRouter instead of MemoryRouter (B-240).
   *
   * Opt in ONLY when the behaviour under test depends on the URL reaching `window.history` —
   * in practice, when react-router writes a search param that nuqs has to read back. Seed the
   * URL with `window.history.replaceState` first; `initialEntries` does not apply.
   */
  historyRouter?: boolean;
}

export function render(ui: ReactElement, options: CustomRenderOptions = {}) {
  const { initialEntries, historyRouter, ...rest } = options;
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <AllProviders initialEntries={initialEntries} historyRouter={historyRouter}>
        {children}
      </AllProviders>
    ),
    ...rest,
  });
}

export * from '@testing-library/react';
