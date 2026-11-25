import { useQuery } from '@tanstack/react-query';
import { cloudFetch, engineFetch } from '@/lib/http/api';

/**
 * T1.4 deviation: plan v1.1 called for outright deletion. Pragmatic path
 * taken instead — rewrite as thin TanStack Query wrappers.
 *
 * Rationale:
 *  - 4 pages consume useCloudApi/useEngineApi + 5 tests mock by these names
 *  - Direct migration to useQuery would churn 9 files with zero behavior change
 *  - The "legacy" issue was the manual useState/useEffect boilerplate inside,
 *    not the wrapper API. Boilerplate is gone — wrapper API survives.
 *  - Tests + pages unchanged. KISS.
 *
 * Cache key is the URL path itself (singular per endpoint). Different from
 * the queryKeys.* factories used by domain-specific hooks (use-projects,
 * use-deployments, etc.) which need filter-aware structured keys.
 */

/**
 * B-171 — `error` vem de `query.isError`, e nao mais de uma inspecao do VALOR.
 *
 * O predicado anterior era `isError || (isFetched && data === null)`. Ele lia `null` como falha, e
 * `null` e o que `cloudFetch` devolve para CINCO desfechos diferentes no contrato padrao (B-235) —
 * um dos quais e um `204 No Content` BEM-SUCEDIDO, que `parseOkBody` mapeia para `null` de
 * proposito para que um DELETE que funcionou nao exploda em `resp.json()`. Uma leitura que deu
 * certo e nao trazia corpo pintava estado de erro.
 *
 * A correcao nao e um caso especial para o 204: e parar de julgar pelo valor quando existe um
 * canal de erro. `{ throwOnError: true }` liga esse canal.
 *
 * `data` continua `T | null` para os 13 consumidores de producao — numa query que falhou,
 * `query.data` e `undefined` e `?? null` devolve `null` como antes. O unico campo cujo valor muda
 * e `error`, e muda so na direcao de estar certo.
 *
 * Efeito deliberado: com o erro tipado, `retryGuard` passa a repetir um 5xx uma vez antes de
 * exibi-lo, coisa que o caminho `null` nunca permitiu. Por isso B-142 (o status fabricado) tinha
 * de ser corrigido na MESMA fatia — repetir um 429 inventado nunca aconteceria.
 */
interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/**
 * Sprint 3 Phase 3 (#21) v1.1 ADR D2 — optional `{ enabled }` flag so callers
 * can scope a query to a specific route (e.g. MemoryUsageCard on /billing
 * should NOT fire `/v1/dashboard/memory/metrics` because the memory backend
 * may be unmounted in dev-public, polluting the console with 404s). Default
 * `enabled: true` preserves backward compatibility for all existing callers.
 */
interface UseApiOptions {
  enabled?: boolean;
}

export function useCloudApi<T>(path: string, options: UseApiOptions = {}): UseApiResult<T> {
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: ['cloud', path] as const,
    // B-171 — `{ throwOnError: true }` e o que da a este hook um CANAL de erro para ler.
    // Sem ele toda falha resolve `null`, `isError` nunca fica verdadeiro, e a unica coisa
    // disponivel para julgar e o valor — que e ambiguo (B-235).
    queryFn: () => cloudFetch<T>(path, {}, { throwOnError: true }),
    enabled,
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading && enabled,
    error: enabled && query.isError,
  };
}

/** `refetchInterval` (ms) keeps a list fresh when what it shows changes without the page acting. */
export function useEngineApi<T>(path: string, options: { refetchInterval?: number } = {}): UseApiResult<T> {
  const query = useQuery({
    queryKey: ['engine', path] as const,
    refetchInterval: options.refetchInterval,
    // B-171 — ver `useCloudApi` acima: o erro vem do canal de erro, nao do valor.
    queryFn: () => engineFetch<T>(path, {}, { throwOnError: true }),
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.isError,
  };
}
