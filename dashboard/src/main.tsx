import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { TheoUIProvider, violetForge } from '@theokit/ui';
import App from './app';
import { RouteBoundary } from './components/error/route-boundary';
import { queryClient } from './lib/query-client';
import { initWebVitals } from './lib/rum';
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
if (import.meta.env.VITE_USE_MOCKS === 'true') {
  Promise.all([
    import('./lib/dev-mocks'),
    import('./lib/mocks'),
  ]).then(([devMocks, mocks]) => {
    devMocks.installKratosMocks();
    mocks.installAllMocks();
  });
}

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
 * TheoUIProvider — canonical entry point per @usetheo/ui API
 * (replaces hand-wired ThemeProvider + Toaster from earlier iterations).
 *
 * Composes <ThemeProvider> + <Toaster> with the right defaults so every
 * composite that depends on theme cascade + toast context works out of
 * the box. Single-theme override (`theme.themes={[violetForge]}`)
 * preserves the bundle-size win (drops 9 theme definitions, ~150KB).
 *
 * Trade-off: cannot switch themes at runtime. Acceptable per D1 (locked
 * single Violet Forge dark) — dashboard never offered theme picker.
 */
// Provider chain (order matters):
//   StrictMode
//     RouteBoundary (T0.1) — catches EXTREMAL crashes (Theo/Router init)
//       QueryClientProvider (T1.1) — server state cache, OUTSIDE TheoUI so
//                                    Theme crash não derruba queries
//         TheoUIProvider — design system + toaster
//           App
//             ReactQueryDevtools (dev only) — Cmd-Shift-Q inspect cache
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouteBoundary routePath="root">
      <QueryClientProvider client={queryClient}>
        <TheoUIProvider
          theme={{
            // Primary roxo Dracula neutro (sem brilho): croma reduzida (0.13) +
            // matiz Dracula (302). #8662b6 = ~4.73:1 vs branco (passa WCAG AA,
            // ao contrário do default oklch(0.628 0.225 296) = 3.87:1). O --primary
            // vem do tema via TheoUIProvider (o index.css NÃO tem efeito no primary).
            themes: [
              {
                ...violetForge,
                light: { ...violetForge.light, primary: 'oklch(0.57 0.13 302)' },
                // input: borda mais perceptível. O default violetForge.dark.input
                // (oklch(0.227)) fica a só 0.045 de luminosidade do bg-card
                // (oklch(0.182)) — borda quase invisível. 0.34 dá um contorno
                // cinza sutil mas legível, sem ser grosseiro.
                dark: {
                  ...violetForge.dark,
                  primary: 'oklch(0.57 0.13 302)',
                  input: 'oklch(0.34 0 0)',
                },
              },
            ],
            defaultTheme: 'violet-forge',
            defaultMode: 'dark',
            // Locked dark (D1): o dashboard nunca ofereceu theme picker.
            // - respectSystemMode:false → ignora o prefers-color-scheme do SO
            //   (default true faria um usuário com SO em light ver o app claro).
            // - storageKey:null → desliga a persistência em localStorage; sem isto,
            //   uma sessão anterior que seguiu o SO gravou mode=light e continuaria
            //   sobrescrevendo o defaultMode. Nada a persistir num tema travado.
            respectSystemMode: false,
            storageKey: null,
          }}
        >
          <App />
          {ReactQueryDevtools ? (
            <Suspense fallback={null}>
              <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
            </Suspense>
          ) : null}
        </TheoUIProvider>
      </QueryClientProvider>
    </RouteBoundary>
  </StrictMode>,
);
