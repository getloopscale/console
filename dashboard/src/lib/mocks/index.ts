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
 * O sentinela mora em `./fixtures` — o modulo mais profundo da cadeia, para que
 * um import direto dele tambem acione o gate. Reexportado aqui por conveniencia
 * de quem consome o barrel. Ver o docblock la para o porque.
 */
export { MOCKS_BUNDLE_SENTINEL } from './fixtures';

/** Single-call install for main.tsx. Idempotent + env-gated. */
export function installAllMocks(): void {
  registerAllMockHandlers();
  installMocks();
  installSSEMocks();
}
