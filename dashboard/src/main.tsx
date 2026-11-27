import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { LoopZeroUIProvider } from '@getloopscale/loopzero-ui';
import { TEMA_LOOPSCALE } from '@/lib/theme/loopscale-theme';
import App from './app';
import { RouteBoundary } from './components/error/route-boundary';
import { queryClient } from './lib/http/query-client';
import { installAuthChannel } from './lib/http/api';
import { initWebVitals } from './lib/telemetry/rum';
import './index.css';

// DevTools only em dev — Sprint 3 (#23) v1.1 ADR D3 defense in depth:
// switched from `import.meta.env.DEV` (which proved bypass-able in the
// dev-public prod build per QA evidence 2026-06-24) to a build-time
// `__DEV__` literal injected via Vite's `define:` block in vite.config.ts.
// The Vite define produces literal-text substitution → guaranteed
// statically eliminable by the tree-shaker. Bundle-grep test at
// `main.test.tsx` is the load-bearing companion gate.
declare const __DEV__: boolean;
const ReactQueryDevtools = __DEV__
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

// Mock infrastructure — gated by VITE_USE_MOCKS=true via dynamic import so
// Vite tree-shakes the entire mock layer (≈27 KB) out of production builds.
// In dev with VITE_USE_MOCKS=true: full Kratos + /api/v1/* + SSE mocks load.
// In prod (env var absent): the dynamic import is never executed, and the
// statically-resolvable env check lets Vite DCE the if-body to zero bytes.
// A instalacao e AGUARDADA antes do render. Ela era `.then(...)` solto, e o
// `createRoot().render()` logo abaixo e sincrono — entao as primeiras queries
// disparavam ANTES do interceptador existir e escapavam para a rede. Em dev sem
// backend isso vira 500 do proxy do Vite, e a tela abre com paineis em erro que
// nao tem nada a ver com o codigo sendo desenvolvido.
//
// Medido em 2026-08-07 com `VITE_USE_MOCKS=true` e sem backend: sete requisicoes
// escapavam (`/engine/api/v1/projects`, `/engine/api/v1/auth/whoami`,
// `/v1/dashboard/status/versions`, `/engine/api/v1/domains`, `/v1/billing`).
// O mock JA remove o prefixo `/engine` (server.ts:150) — o problema nunca foi
// casamento de rota, era ordem.
//
// Custo em producao: ZERO. O `if` e resolvido em tempo de build (a env e literal),
// entao o corpo inteiro — inclusive o await — some do bundle.
const readyToRender =
  import.meta.env.VITE_USE_MOCKS === 'true'
    ? Promise.all([import('./lib/mocks/dev-mocks'), import('./lib/mocks')]).then(
        ([devMocks, mocks]) => {
          devMocks.installKratosMocks();
          mocks.installAllMocks();
        },
      )
    : Promise.resolve();

// B-042 — o canal de coordenacao de logout entre abas e aberto AQUI, no boot,
// e nao como efeito colateral de importar lib/api. Aquele modulo tem 151
// importadores; abrir um BroadcastChannel e registrar um handler que redireciona
// a pagina a cada import era invisivel e sem teardown.
installAuthChannel();

// T-DR-5.2 v1.2 (Phase 5) — Web Vitals RUM reporter per ADR D8.
// Dev: console.log LCP/INP/CLS with verdict. Prod: ready to POST to
// /v1/telemetry/web-vitals when backend ships (zero consumer impact today).
initWebVitals();

// T4.2: Service Worker registration via Workbox.
// Prod only — dev has SW disabled in vite.config.ts (HMR conflicts).
// Dynamic import so virtual:pwa-register chunk is tree-shaken when
// not invoked.
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => {
    // Registration failure is non-fatal — app works without SW.
  });
}

/**
 * LoopZeroUIProvider — canonical entry point per @getloopscale/ui API
 * (replaces hand-wired ThemeProvider + Toaster from earlier iterations).
 *
 * Composes <ThemeProvider> + <Toaster> with the right defaults so every
 * composite that depends on theme cascade + toast context works out of
 * the box. The provider gets one theme, the LoopScale brand
 * (`lib/theme/loopscale-theme.ts`), so the other theme definitions of the
 * package stay out of the bundle.
 *
 * Trade-off: no theme or mode switch at runtime. The dashboard is dark only.
 */
// Provider chain (order matters):
//   StrictMode
//     RouteBoundary (T0.1) — catches EXTREMAL crashes (LoopScale/Router init)
//       QueryClientProvider (T1.1) — server state cache, OUTSIDE LoopScaleUI so
//                                    Theme crash não derruba queries
//         LoopZeroUIProvider — design system + toaster
//           App
//             ReactQueryDevtools (dev only) — Cmd-Shift-Q inspect cache
void readyToRender.then(() =>
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouteBoundary routePath="root">
      <QueryClientProvider client={queryClient}>
        <LoopZeroUIProvider theme={TEMA_LOOPSCALE}>
          <App />
          {ReactQueryDevtools ? (
            <Suspense fallback={null}>
              <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
            </Suspense>
          ) : null}
        </LoopZeroUIProvider>
      </QueryClientProvider>
    </RouteBoundary>
  </StrictMode>,
),
);
