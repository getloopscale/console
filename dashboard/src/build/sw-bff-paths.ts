/**
 * Path patterns for BFF endpoints reached by TOP-LEVEL BROWSER NAVIGATION (not XHR).
 *
 * The PWA service worker's `navigateFallback` (Workbox) serves the precached SPA
 * `index.html` for any navigation it does not recognise. For these BFF paths that is
 * WRONG: React Router has no matching client route, so the shell renders "Page not
 * found" and the BFF (302 → provider / login / consent) is never reached.
 *
 * Every path here MUST be excluded from BOTH the SW navigation fallback
 * (`navigateFallbackDenylist`) AND cached `NetworkOnly` (the runtimeCaching predicate),
 * so the request always hits the network/BFF. This single source of truth removes the
 * denylist↔runtimeCaching duplication that let the same bug recur (an entry added to
 * one list but forgotten in the other, or a new BFF navigation path forgotten entirely).
 *
 * History — same bug class each time (an incomplete list):
 *  - theo-cloud#112: `/auth/*` (Hydra consent + `theo login --device-flow`) was missing.
 *  - theo-cloud#203: `/v1/rag-connect/*` (connector OAuth broker — "Connect with X") was missing.
 */
export const BFF_NAVIGATION_DENYLIST: readonly RegExp[] = [
  /^\/auth\//,
  /\/api\/v1\/auth\//,
  /\/sessions\//,
  /\/self-service\//,
  /\/oauth2\//,
  /^\/v1\/rag-connect\//, // theo-cloud#203 — OAuth "Connect with X" authorize + callback
];

/** True when the pathname is a BFF navigation endpoint that must bypass the SW SPA fallback. */
export function isBffNavigationPath(pathname: string): boolean {
  return BFF_NAVIGATION_DENYLIST.some((re) => re.test(pathname));
}

/**
 * A single RegExp union of the denylist, for use as the Workbox `runtimeCaching`
 * `urlPattern` (NetworkOnly for BFF paths).
 *
 * Why a RegExp VALUE and not the `isBffNavigationPath` FUNCTION: Workbox `generateSW`
 * stringifies the `urlPattern` into `sw.js` but does NOT bundle module imports. A
 * function urlPattern that calls `isBffNavigationPath(...)` therefore emits a free
 * identifier that is undefined at SW runtime → `ReferenceError: isBffNavigationPath is
 * not defined` inside `findMatchingRoute`, which crashes ALL SW routing (file uploads
 * included — the recurring #112/#203 bug class regressing into the upload path). A
 * RegExp serializes to a self-contained `/.../` literal, so it is safe to inline.
 *
 * Workbox tests a RegExp `urlPattern` against `url.href` (the full URL), not the bare
 * pathname, so the leading `^` pathname anchors are stripped and each pattern matches
 * the path segment anywhere in the href. Derived from the single source of truth above,
 * so a new BFF path added to the denylist is automatically covered here too.
 */
export const BFF_NAVIGATION_REGEXP: RegExp = new RegExp(
  BFF_NAVIGATION_DENYLIST.map((re) => re.source.replace(/^\^/, '')).join('|'),
);
