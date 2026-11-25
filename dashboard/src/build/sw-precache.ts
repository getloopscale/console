/**
 * Files the service worker precache must never hold, passed to workbox `globIgnores`.
 *
 * Kept out of `vite.config.ts` for the same reason as `sw-bff-paths.ts`: a list inside the build
 * config cannot be tested, and `sw-precache.test.ts` checks it against workbox's own manifest
 * generator.
 */
export const SW_PRECACHE_GLOB_IGNORES: readonly string[] = [
  // The rollup-plugin-visualizer treemap (dist/bundle-stats.html) is a build-analysis artifact,
  // not an app asset. It also exceeds the 2 MiB workbox limit, which hard-fails the build.
  '**/bundle-stats.html',
  // The container writes /__config.js at start-up (Helm ConfigMap or docker-entrypoint.sh), but
  // the build also copies public/__config.js into dist. Precached, that build-time copy answers
  // before the runtime rule in sw-runtime-caching.ts and has no OAUTH_URL/AUTH_URL, so the auth
  // host is missing from SAFE_REDIRECT_ORIGINS and sign-in fails for every returning user.
  '**/__config.js',
];
