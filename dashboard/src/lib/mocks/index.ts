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

import { __setTransporte } from '@/hooks/deploy/shared-event-source';
import { MockEventSource as MockES, isSSEMockingEnabled as sseMockAtivo } from './sse';

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
  installSharedEventSourceTransport();
}

/**
 * O transporte SSE compartilhado NÃO passa por `window.EventSource`, e por isso escapava
 * dos mocks.
 *
 * `installSSEMocks()` funciona trocando `window.EventSource` pelo `MockEventSource`. Isso
 * cobria todo consumidor de SSE do dashboard até o **B-088** trocar o transporte por
 * `FetchEventSource` — feito para tirar o JWT da query string, e correto por si. O efeito
 * colateral não foi notado: `fetch` não é `window.EventSource`, então a timeline de deploy
 * passou a bater no proxy do Vite e receber `ECONNREFUSED 127.0.0.1:13002` → 500.
 *
 * Ficou invisível por dias porque a suíte de jornadas do Playwright não estava rodando
 * (um import quebrado a matava no carregamento, reportando "0 tests"). Quando ela voltou,
 * seis casos da timeline apareceram vermelhos de uma vez, todos travados em `queued` —
 * o que um usuário veria: um deploy que nunca sai do lugar, com o mock no lugar do backend.
 *
 * `__setTransporte` já existia como ponto de troca, criado no B-088 para os nove arquivos
 * de teste de SSE. Reusá-lo aqui é o degrau 4 da ladder de parcimônia: o seam existe, e a
 * alternativa seria ensinar a camada de mocks a interceptar `fetch` de SSE — reimplementar
 * um parser que `MockEventSource` já dispensa.
 *
 * Produção não vê nada disto: este módulo inteiro é tree-shaken quando `VITE_USE_MOCKS`
 * não é `'true'`, e o invariante tem gate próprio em CI (B-087).
 */
function installSharedEventSourceTransport(): void {
  if (!sseMockAtivo()) return;
  __setTransporte((url) => new MockES(url) as unknown as EventSource);
}
