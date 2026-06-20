/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

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
export default defineConfig({
  plugins: [
    // dev-only: relax the production CSP so localhost/127.0.0.1 login works under `make dev-up`.
    devCspRelax(),
    // T0.2: React Compiler (auto-memoization). React 19 GA, babel-plugin@1.0.
    // Auto-memoiza components + hooks sem useMemo/useCallback/memo() manuais.
    // Build-time only, zero runtime overhead. Existing 6 manual memos convivem.
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {}],
        ],
      },
    }),
    // T-DR-5.5 v1.2 (Phase 5) — Bundle analyzer per-route attribution.
    // Outputs dist/bundle-stats.html on every build (open via npm run bundle:analyze).
    // Resolves G5 FAANG gap (Vercel bundle analyzer parity).
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
        name: 'TheoCloud',
        short_name: 'Theo',
        description: 'CLI-first managed cloud for monorepo deployments.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: '/',
        // PWA manifest icons — use the real Theo mascot PNGs from public/.
        // Previously this was an inline SVG raio (#3ecf8e), shadowing the
        // brand assets. 192/512 sizes are the Android Chrome standard;
        // `maskable` on 512 lets Android's adaptive-icon system crop safely.
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
            purpose: 'any maskable',
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
        // The rollup-plugin-visualizer treemap (dist/bundle-stats.html) is a
        // build-analysis artifact, not an app asset — it must never enter the
        // SW precache manifest (and it exceeds the 2 MiB workbox limit, which
        // hard-fails the build). Exclude it explicitly.
        globIgnores: ['**/bundle-stats.html'],
        // EC-04: NEVER cache auth/session endpoints — would serve stale
        // tokens making user appear logged-in when session is gone.
        navigateFallbackDenylist: [
          /\/api\/v1\/auth\//,
          /\/sessions\//,
          /\/self-service\//,
          /\/oauth2\//,
        ],
        runtimeCaching: [
          // Auth/session — NetworkOnly (no fallback, no cache).
          {
            urlPattern: ({ url }) =>
              /\/api\/v1\/auth\//.test(url.pathname) ||
              /\/sessions\//.test(url.pathname) ||
              /\/self-service\//.test(url.pathname) ||
              /\/oauth2\//.test(url.pathname),
            handler: 'NetworkOnly',
          },
          // Generic API — NetworkFirst with 3s timeout, cache fallback.
          {
            urlPattern: /\/api\/v1\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'theo-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
            },
          },
          // Static assets — CacheFirst, 30 days.
          {
            urlPattern: /\.(js|css|woff2?|svg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'theo-assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // Runtime config — StaleWhileRevalidate (rarely changes but must
          // refresh eventually after rotation).
          {
            urlPattern: /\/__config\.js$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'theo-config' },
          },
        ],
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
        manualChunks(id) {
          if (id.includes('node_modules/@usetheo/ui')) return 'theo-ui';
          if (id.includes('node_modules/@radix-ui')) return 'radix';
          if (id.includes('node_modules/lucide-react')) return 'lucide';
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react-vendor';
          if (id.includes('node_modules/react-router')) return 'router';
          // All other vendor code → general vendor chunk
          if (id.includes('node_modules/')) return 'vendor';
        },
      },
    },
  },
  test: {
    // jsdom provides window/document so libs that touch the DOM at import time
    // (config.ts, BroadcastChannel) run under test (find_cicd_007).
    environment: 'jsdom',
  },
});
