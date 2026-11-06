import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/** M131 — the Session Coherence verdict (GET/POST /v1/dashboard/lens/sessions/:id/coherence). */
export interface CoherenceVerdict {
  verdict: 'coherent' | 'incoherent' | null;
  score?: number;
  reasoning?: string;
  cached?: boolean;
}

const coherenceKey = (sessionId: string) =>
  ['cloud', '/v1/dashboard/lens/sessions', sessionId, 'coherence'] as const;

/**
 * One session's traces.
 *
 * Generic over the trace shape (owned by `pages/lens/traces/columns`; `src/hooks` may not import
 * from `src/pages`, B-070). The filter is the same `session_id=` the BFF already forwards to
 * theo-lens for the traces list's advanced filter — not a second endpoint.
 */
export function useSessionTraces<T>(sessionId: string) {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', 'session', sessionId] as const,
    queryFn: () =>
      cloudFetch<{ traces: T[] }>(
        `/v1/dashboard/lens/traces?session_id=${encodeURIComponent(sessionId)}`,
        {},
        { throwOnError: true },
      ),
    enabled: sessionId !== '',
  });
}

/** The CACHED verdict — `null` means not evaluated, which is not the same as incoherent. */
export function useSessionCoherence(sessionId: string) {
  return useQuery({
    queryKey: coherenceKey(sessionId),
    queryFn: () =>
      cloudFetch<CoherenceVerdict>(
        `/v1/dashboard/lens/sessions/${encodeURIComponent(sessionId)}/coherence`,
        {},
        { throwOnError: true },
      ),
    enabled: sessionId !== '',
  });
}

/**
 * Run the coherence judge on demand.
 *
 * Reading is cheap; running is BILLABLE and rate-limited upstream, which is why it is an explicit
 * action rather than something the page does on mount. `throwOnError` follows from that: a 429
 * (rate-limited) or a 502 (judge failed) must reject so the error surfaces. On a money-adjacent
 * action, a silent no-op is the one outcome that cannot be allowed — the operator would press the
 * button again.
 *
 * The result is written straight into the read's cache rather than invalidating it, so the fresh
 * verdict is shown without paying for a second round trip to fetch what was just returned.
 */
export function useRunSessionCoherence(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      cloudFetch<CoherenceVerdict>(
        `/v1/dashboard/lens/sessions/${encodeURIComponent(sessionId)}/coherence`,
        { method: 'POST' },
        { throwOnError: true },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(coherenceKey(sessionId), data);
    },
  });
}
