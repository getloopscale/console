/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// manualChunks extracted to a pure, unit-tested module (dashboard-manualchunks-tdz-fix,
// ADR D1/D2) — keeps the react+react-dom+scheduler co-location invariant testable.
import { manualChunks } from './src/build/manual-chunks';
// SW navigation denylist extracted to a pure, unit-tested module (theo-cloud#203) —
// single source of truth shared by navigateFallbackDenylist + the NetworkOnly
// runtimeCaching predicate, so a BFF navigation path can never be added to one and
// forgotten in the other (the recurring #112/#203 bug class).
import { BFF_NAVIGATION_DENYLIST } from './src/build/sw-bff-paths';
import { SW_PRECACHE_GLOB_IGNORES } from './src/build/sw-precache';
import { SW_RUNTIME_CACHING } from './src/build/sw-runtime-caching';

/**
 * Dev-only CSP relaxation. The index.html `<meta>` CSP is PRODUCTION-shaped
 * (`form-action 'self' https://auth.usetheo.dev …`). In the local dev stack the
 * login/registration forms POST to the vite-proxied Kratos at the dev origin
 * (localhost:5173 → kratos:14433). When the page is opened via 127.0.0.1 (vite
 * `--host` binds 0.0.0.0), `'self'` no longer matches the localhost form-action
 * URL and the browser blocks the login POST. This plugin runs ONLY in `vite dev`
 * (apply:'serve') and injects the dev origins into `form-action` + `connect-src`
 * so `make dev-up` login works from localhost AND 127.0.0.1. The production
 * build never runs this transform — the shipped CSP is unchanged.
 */
function devCspRelax(): Plugin {
  const devOrigins =
    'http://localhost:5173 http://127.0.0.1:5173 http://localhost:14433 http://127.0.0.1:14433';
  return {
    name: 'dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("form-action 'self'", `form-action 'self' ${devOrigins}`)
        .replace("connect-src 'self' ws: wss:", `connect-src 'self' ws: wss: ${devOrigins}`);
    },
  };
}

/**
 * Vite config with manualChunks vendor split (T-H.3 final optimization).
 *
 * Splits @usetheo/ui + Radix + Lucide into dedicated vendor chunk so the
 * browser caches it independently of app code. Reduces re-download cost
 * on subsequent visits + parallelizes parsing.
 *
 * Initial paint cost stays the same (browser fetches both chunks) but
 * after first visit, design-system code is cached separately from app
 * code that changes more frequently.
 */
export default defineConfig(({ mode }) => ({
  // Sprint 3 (#23) v1.1 ADR D3 defense in depth: replace the runtime
  // `import.meta.env.DEV` check (proved bypass-able in dev-public per QA)
  // with a literal `__DEV__` substitution at build time. Vite's `define:`
  // produces text replacement → guaranteed eliminable by the tree-shaker.
  // Bundle-grep test at `src/main.test.tsx` is the load-bearing companion.
  define: {
    __DEV__: JSON.stringify(mode === 'development'),
  },
  plugins: [
    // dev-only: relax the production CSP so localhost/127.0.0.1 login works under `make dev-up`.
    devCspRelax(),
    // T0.2: React Compiler (auto-memoization). React 19 GA, babel-plugin@1.0.
    // Auto-memoiza components + hooks sem useMemo/useCallback/memo() manuais.
    //
    // MEDIDO em 2026-08-08 (B-075), porque "zero runtime overhead" era afirmacao
    // e nao numero — e ela estava ERRADA:
    //
    //   memoizacao:  170 de 207 componentes .tsx (rodando o babel-plugin sobre
    //                cada arquivo e procurando `useMemoCache` na saida)
    //   bundle:      306,47 kB com · 301,00 kB sem  ->  +5,5 kB EAGER
    //   build:       34,0s com · 22,7s sem          ->  +50%
    //
    // Os 5,5 kB sao o codigo de memoizacao emitido nos componentes; o helper
    // `useMemoCache` vem do proprio React 19 (nao ha dependencia de
    // `react-compiler-runtime`). Entao ha custo de runtime em BYTES, ainda que
    // nao em trabalho por render.
    //
    // A decisao de manter esta no ADR-0012. O comentario anterior dizia "zero
    // runtime overhead" — quem lesse isso ao caçar bytes descartaria este
    // plugin da lista de suspeitos sem medir.
    //
    // Os 6 memos manuais existentes convivem.
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {}],
        ],
      },
    }),
    // T-DR-5.5 v1.2 (Phase 5) — Bundle analyzer per-route attribution. GATED behind
    // ANALYZE=true (`npm run bundle:analyze`) so the build-internals treemap
    // (dist/bundle-stats.html) is NOT emitted into the served/deployed bundle — it
    // would otherwise be reachable at GET /bundle-stats.html through the edge and
    // leak the module graph (review SEC-tdz-01; same class as slice-3a SEC-3a-06).
    process.env.ANALYZE === 'true' &&
      visualizer({
        filename: 'dist/bundle-stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
      }),
    // T4.2: Service Worker via vite-plugin-pwa + Workbox.
    // EC-04 critical: auth endpoints MUST NEVER cache — stale token =
    // security hole (user sees logged-in UI but session is expired).
    // skipWaiting + clientsClaim = new build propaga em next page load
    // (without these, SW waits ALL tabs to close — SPA user keeps tab
    // open dias, never sees update).
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LoopScale',
        short_name: 'LoopScale',
        description: 'CLI-first managed cloud for monorepo deployments.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: '/',
        // PWA manifest icons: the LoopScale brand PNGs from public/.
        // Previously this was an inline SVG raio (#3ecf8e), shadowing the
        // brand assets. 192/512 sizes are the Android Chrome standard; the
        // maskable icon keeps the mark inside the safe zone Android crops to.
        icons: [
          {
            src: '/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // Files that must never enter the precache manifest (the visualizer
        // treemap and the runtime config); see src/build/sw-precache.ts.
        globIgnores: [...SW_PRECACHE_GLOB_IGNORES],
        // EC-04: NEVER cache auth/session endpoints — would serve stale
        // tokens making user appear logged-in when session is gone.
        //
        // Red Team theo-cloud#112 caveat closure (2026-06-28): include
        // /auth/* — the BFF Hydra consent/device-flow routes
        // (/auth/login, /auth/login/complete, /auth/consent, /auth/device).
        // Without this entry, the SW from any tab that opened the
        // dashboard before the #112 fix landed serves the SPA shell from
        // precache → React Router has no `/auth/login` route → "Page
        // not found" → CLI `theo login --device-flow` chain breaks for
        // every existing user with a warm SW (same class as #100 MIME
        // outage). Mirror in runtimeCaching below as NetworkOnly so the
        // path never enters any cache, even after warmup.
        navigateFallbackDenylist: [...BFF_NAVIGATION_DENYLIST],
        runtimeCaching: [...SW_RUNTIME_CACHING],
        // skipWaiting + clientsClaim: new SW activates immediately em next
        // page load. Without these, SW waits all tabs close → SPA user com
        // tab aberta nunca recebe update.
        skipWaiting: true,
        clientsClaim: true,
      },
      // Dev: SW disabled (Vite HMR conflicts with caching).
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force a single React instance across the dependency graph.
    // Without this, pnpm's content-addressable store can resolve `react` and
    // `react-dom` from `@usetheo/ui`'s own pkg dir (via its peer entry) while
    // the app code resolves from the workspace root — producing two distinct
    // module identities and the "Invalid hook call" runtime error from
    // useContext returning null.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Pre-bundle @usetheo/ui to a single optimized artifact so Vite doesn't
    // re-discover it on every page (the heavy library was triggering serial
    // re-optimizations and 504s on outdated optimize-dep). Listing it here
    // pins the entry to the app's React, not @usetheo/ui's peer copy.
    include: ['@usetheo/ui', 'react', 'react-dom', 'react-dom/client', 'react-force-graph-2d'],
  },
  // Dev-only: same-origin against the local theo-cloud + Kratos port-forwards
  // via vite proxy (avoids browser CORS). In prod, the dashboard is served
  // from cloud.{domain} (MEET-040). `allowedHosts` whitelists the public
  // Caddy-fronted hostname so vite's DNS-rebinding guard doesn't 403 us.
  server: {
    host: true,
    allowedHosts: ['localhost', 'app.usetheo.dev', '.usetheo.dev'],
    proxy: {
      '/v1':           { target: 'http://localhost:13002', changeOrigin: true },
      '/engine':       { target: 'http://localhost:13002', changeOrigin: true },
      '/auth':         { target: 'http://localhost:13002', changeOrigin: true },
      '/self-service': { target: 'http://localhost:14433', changeOrigin: true },
      '/sessions':     { target: 'http://localhost:14433', changeOrigin: true },
      '/oauth2':       { target: 'http://localhost:14444', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // The split logic (incl. the react+react-dom+scheduler co-location that fixes
        // the unstable_now TDZ crash) lives in src/build/manual-chunks.ts and is
        // unit-tested in src/build/manual-chunks.test.ts. NOTE (F-fe-1, deferred): the
        // react-force-graph-2d + d3 family still lands in the app-wide `vendor` chunk;
        // true route-isolation needs dedicated work (non-blocking perf hygiene).
        manualChunks,
        // B-022 — o entry ganha nome PROPRIO (`app-*`) em vez do `index-*` padrao.
        //
        // O motivo e concreto: 15 chunks lazy tambem se chamam `index-*` (todo
        // modulo `.../index.tsx` vira um), entao o glob `dist/assets/index-*.js`
        // do orcamento de bundle somava o entry MAIS quatorze chunks que o
        // usuario nunca baixa no primeiro paint. A entrada chamada "app entry"
        // media 69 kB quando o entry tem 23. Um nome distinto e o que torna o
        // glob capaz de dizer a verdade.
        //
        // `app-` NAO era distinto o bastante, e a primeira tentativa repetiu o
        // defeito que corrigia. Trocar `entryFileNames` sem trocar
        // `chunkFileNames` deixa qualquer chunk cujo nome comece com "app"
        // dentro do glob: `components/ui/app-modal.tsx` vira `app-modal-*.js`,
        // um chunk LAZY somado no orcamento EAGER. Medido no HEAD: o gate passava
        // com 0,48 kB de folga contando 2,1 kB que nao pertencem ali — passar por
        // pouco somando o arquivo errado nao e passar.
        //
        // `entry-` nao colide: nenhum modulo em src/ comeca com "entry".
        entryFileNames: 'assets/entry-[hash].js',
      },
    },
  },
  test: {
    // jsdom provides window/document so libs that touch the DOM at import time
    // (config.ts, BroadcastChannel) run under test (find_cicd_007).
    environment: 'jsdom',
  },
}));
