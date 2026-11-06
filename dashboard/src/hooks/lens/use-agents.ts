import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/** One agent, as `/v1/dashboard/lens/agents` returns it. */
export interface Agent {
  name: string;
  traceCount?: number;
}

export interface AgentsResult {
  agents: Agent[];
}

/**
 * The lens agents listing.
 *
 * B-244 — the page chose the URL, the row limit, the error policy and the cache key inside the
 * screen. Nothing here changes what the user sees; what changes is that the next fix to how agents
 * are read lands in one place instead of being looked for.
 *
 * `throwOnError` was already there and stays, for the reason `use-datasets.ts` states about its own
 * list: a failed read that resolves to an empty array shows "no agents" while the service is down,
 * and an operator reading that goes looking for what happened to their agents.
 */
export function useAgents() {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/agents'] as const,
    queryFn: () =>
      cloudFetch<AgentsResult>(
        `/v1/dashboard/lens/agents?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}
