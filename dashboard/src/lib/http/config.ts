// Runtime configuration loader.
//
// In production, the container entrypoint generates /__config.js from env vars.
// In development, the file in public/__config.js has empty defaults (same-origin).
// This module reads from window.__THEO_CONFIG__ (set by the script tag in index.html).

interface TheoConfig {
  API_URL: string;
  ENGINE_URL: string;
  AUTH_URL: string;
  ACCOUNTS_URL: string;
}

declare global {
  interface Window {
    __THEO_CONFIG__?: TheoConfig;
  }
}

function getConfig(): TheoConfig {
  return window.__THEO_CONFIG__ ?? {
    API_URL: "",
    ENGINE_URL: "",
    AUTH_URL: "",
    ACCOUNTS_URL: "",
  };
}

/** Base URL for API calls (cloud service). Empty = same-origin. */
export const API_URL = getConfig().API_URL;

/** Base URL for auth (Kratos). Empty = same-origin. */
export const AUTH_URL = getConfig().AUTH_URL;

/** Base URL for accounts. Empty = same-origin. */
export const ACCOUNTS_URL = getConfig().ACCOUNTS_URL;

/**
 * "A camada de mock de dev esta ativa?" — unica fonte de verdade.
 *
 * B-049: morava em `./dev-mocks`, o que obrigava `api.ts` e `auth.ts` (codigo de
 * PRODUCAO) a importar do modulo de fixtures so para ler uma env var. api.ts e o
 * modulo mais importado do repositorio (151 importadores), entao a aresta o
 * ligava — e ao seu grafo inteiro — a camada de mock. Aqui e o lugar certo: e a
 * mesma natureza de API_URL, que ja mora neste modulo.
 *
 * Continua gated por env em build-time, entao o Vite segue eliminando os ramos
 * de mock em producao (verificado pelo gate `tree-shake-check` no CI).
 */
export function mocksEnabled(): boolean {
  return import.meta.env.VITE_USE_MOCKS === 'true';
}
