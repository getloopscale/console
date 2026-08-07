// Barrel export for mock infrastructure — Plan v1.0 Phase 0.
//
// Single entry point: call `installAllMocks()` from main.tsx after env check.
// This wires:
//   - fetch interceptor (server.ts) for /api/v1/* routes
//   - EventSource shim (sse.ts) for SSE log streams
//   - 47 endpoint handlers (handlers.ts) covering full API surface
//
// All gated by VITE_USE_MOCKS=true. Production builds tree-shake everything.

import { installMocks } from './server';
import { installSSEMocks } from './sse';
import { registerAllMockHandlers } from './handlers';

export {
  installMocks,
  uninstallMocks,
  registerRoute,
  matchRoute,
  resetRoutes,
  getRegisteredRouteCount,
  isMockingEnabled,
} from './server';

export {
  installSSEMocks,
  uninstallSSEMocks,
  MockEventSource,
  registerSSE,
  resetSSERegistrations,
  getSSERegistrationCount,
  isSSEMockingEnabled,
} from './sse';

export { registerAllMockHandlers, resetMockDB } from './handlers';

/**
 * Sentinela de contencao — o observavel que torna o tree-shake VERIFICAVEL.
 *
 * O gate de CI (`quality.yml`, passo "Tree-shake check") procurava a string
 * `lib/mocks` no `dist/`. Com `sourcemap: false` e minificacao, um caminho de
 * modulo NUNCA sobrevive ao bundle — o grep nao podia casar nem quando os mocks
 * estavam la. Dois revisores independentes provaram: injetaram um import
 * estatico dos mocks, rebuildaram, e o gate imprimiu PASS nos DOIS estados.
 * Um gate que nao distingue os casos que existe para distinguir e tautologia.
 *
 * Literal de string sobrevive a minificacao; caminho de modulo nao. Por isso o
 * sentinela e uma string, e por isso ela e CONSUMIDA aqui — um const so
 * atribuido seria descartado pelo minificador e reintroduziria o mesmo furo por
 * outro caminho.
 */
export const MOCKS_BUNDLE_SENTINEL = '__theo_mocks_present_in_bundle__';

/** Single-call install for main.tsx. Idempotent + env-gated. */
export function installAllMocks(): void {
  // O sentinela e lido aqui de proposito: torna a string alcancavel a partir do
  // unico caminho que arrasta os mocks para o bundle.
  (globalThis as Record<string, unknown>).__theoMocks = MOCKS_BUNDLE_SENTINEL;
  registerAllMockHandlers();
  installMocks();
  installSSEMocks();
}
