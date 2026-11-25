import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { ApiError, engineFetch } from '@/lib/http/api';
import type { ProjectConnection } from '@/lib/api/types';
/** GET /projects/{name}/connect. A 404 `NOT_CONNECTED` is the answer "no repository", not a failure. */
async function fetchProjectConnection(name: string): Promise<ProjectConnection> {
  try {
    const data = await engineFetch<ProjectConnection>(
      `/api/v1/projects/${encodeURIComponent(name)}/connect`,
      {},
      { throwOnError: true },
    );
    return data ?? { connected: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { connected: false };
    throw e;
  }
}

/**
 * The project's repository connection. A 404 is the answer "no repository", so the data is
 * `{ connected: false }` and not an error. The connect page and Readiness share this query.
 */
export function useProjectConnected(name: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.conexao(name ?? ''),
    queryFn: () => fetchProjectConnection(name ?? ''),
    enabled: !!name,
  });
}
