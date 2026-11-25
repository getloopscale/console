import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Secret } from '@/lib/api/types';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import { useEnvironments } from '@/hooks/use-environments';

/**
 * Raw shape returned by GET /api/v1/secrets — backend emits one row per
 * (key × env) tuple with `environment` SINGULAR. The UI groups by key so
 * each row shows all envs the secret is scoped to. LIVE 2026-06-10 catch
 * after `Secret` type lied about `environments: string[]`.
 */
interface RawSecretRow {
  name: string;
  environment: string;
  app: string;
}

/**
 * A secret row as the Secrets screen lists it. `app` is the app the secret is scoped to, absent
 * for a project-wide secret (the API's app ""). Delete and rotate address a secret by it.
 */
export interface ProjectSecret extends Secret {
  app?: string;
}

interface RawSecretListResponse {
  secrets: RawSecretRow[];
}

/**
 * use-secrets — TanStack Query.
 *
 * J-22 T2.1 + 2026-06-10 LIVE fixes:
 *   - Backend requires `project` + `env` to return non-empty results;
 *     with no filter, queries fan out over the project's environments as
 *     GET /api/v1/environments lists them (production and preview on a
 *     default project). A fixed list asked for envs the project does not
 *     have and skipped the ones it does.
 *   - Backend emits one row per (key × env); we group by `name` so the
 *     UI shows multi-env badges on a single row.
 */
export function useSecrets(opts: { project: string; env?: string }): {
  secrets: ProjectSecret[];
  loading: boolean;
  error: boolean;
  refetch: () => void;
  /** True only when every environment's list answered, so `secrets` is a measurement. */
  measured: boolean;
} {
  const { project, env } = opts;
  const queryClient = useQueryClient();
  const projectEnvs = useEnvironments(project);
  const envsToFetch = env ? [env] : projectEnvs.envs;
  const query = useQuery({
    queryKey: [...queryKeys.secrets.list(), { project, env: env ?? 'all', envs: envsToFetch }],
    enabled: project.length > 0 && envsToFetch.length > 0,
    // silent-null-ok: ESTE hook mapeia `null` resolvido para o campo `error` que ele devolve (`isError || (isFetched && data === null)`), entao a falha nao se perde AQUI. B-094: isso NAO garante que a tela leia esse `error` — medi e varias nao liam, e o onboarding chegava a afirmar 'faca login' a quem estava logado. Quem consome este hook e responsavel por ler `error`; o marcador cobre so a metade de cima. #274
    queryFn: async () => {
      const rows: RawSecretRow[] = [];
      for (const e of envsToFetch) {
        const params = new URLSearchParams({ project, env: e });
        const r = await engineFetch<RawSecretListResponse>(
          `/api/v1/secrets?${params.toString()}`,
          {},
          { throwOnError: true },
        );
        if (r && Array.isArray(r.secrets)) rows.push(...r.secrets);
      }
      // Group by (`app`, `name`) so the UI shows one row per key with the union of envs. The same
      // name in two apps is two secrets: delete and rotate address one of them by its app.
      const byKey = new Map<string, ProjectSecret>();
      for (const row of rows) {
        const key = `${row.app ?? ''}\u0000${row.name}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.environments.includes(row.environment)) {
            existing.environments.push(row.environment);
          }
        } else {
          byKey.set(key, {
            name: row.name,
            environments: [row.environment],
            ...(row.app ? { app: row.app } : {}),
          });
        }
      }
      return Array.from(byKey.values());
    },
  });
  return {
    secrets: query.data ?? [],
    loading: query.isLoading || (!env && projectEnvs.loading),
    error: query.isError || (query.isFetched && query.data === null),
    measured: query.isSuccess && !projectEnvs.error,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all });
    },
  };
}
