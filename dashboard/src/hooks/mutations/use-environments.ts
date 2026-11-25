import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import type { Environment } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Environments mutations — Plan J-10 v1.1.
 *
 * Backend endpoints (LIVE-verified T0.1 Recon 2026-06-06):
 *   - POST   /api/v1/environments              → 201 {name, status}
 *   - DELETE /api/v1/environments/{name}       → 200 {deleted}
 *   - POST   /api/v1/projects/{name}/promote   → 200 {from, to, ...}
 *
 * v1.1 changes:
 *   - All hooks invalidate `queryKeys.environments.all` (canonical key)
 *     instead of the legacy ad-hoc `['environments']`. v1.0 used a local
 *     ENVS_KEY because queryKeys.environments did not exist; v1.1 added
 *     it (see lib/api/query-keys.ts).
 *   - usePromoteEnvironment NEW — pattern de useRedeploy applied to the
 *     promote endpoint with {from, to} body.
 */

/**
 * useDeleteEnvironment — exclusão pela tupla (projeto, ambiente).
 *
 * A URL leva sempre `?project=<slug>` para o serviço filtrar pela tupla: apagar `staging` de
 * `web` NÃO toca o `staging` de `api`.
 *
 * DUAS CAMADAS DE LEGADO SAÍRAM AQUI (issue #377), e nenhuma tinha chamador:
 *
 *   1. a forma `string` solta, aceita "para chamadores v1.0";
 *   2. `project` opcional, cuja ausência caía numa busca sem projeto — a chamada que podia
 *      apagar o ambiente de OUTRO projeto com o mesmo nome.
 *
 * O segundo é o que pesa: uma exclusão é irreversível, e o caminho permissivo era justamente o
 * que menos identificava o alvo. Deixá-lo vivo "por segurança" invertia o sentido da palavra.
 */
export function useDeleteEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, project }: { name: string; project: string }) => {
      const url = `/api/v1/environments/${encodeURIComponent(name)}`;
      return engineFetch(`${url}?project=${encodeURIComponent(project)}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      // Canonical key tree for downstream consumers using queryKeys.environments.
      queryClient.invalidateQueries({ queryKey: queryKeys.environments.all });
      // LIVE catch 2026-06-06: pages today fetch via useEngineApi which uses
      // key `['engine', '/api/v1/environments']` (different tree). Without
      // a second invalidation, the table stays stale after delete/create.
      queryClient.invalidateQueries({ queryKey: ['engine'] });
    },
  });
}

/**
 * useCreateEnvironment — M2 v1.2 T5.1.
 *
 * Body shape (canonical post-M2): `{ name, project }` where project is the
 * project slug (NOT UUID). Backend returns 400 MISSING_FIELD when project
 * is missing — defense at the API layer; this hook is the second defence.
 */
export function useCreateEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    // Rejects on a non-2xx answer so the caller can tell a plan limit (402) from a failure.
    mutationFn: (input: { name: string; project: string; protected?: boolean }) =>
      engineFetch<Environment>(
        '/api/v1/environments',
        { method: 'POST', body: JSON.stringify(input) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      // Canonical key tree for downstream consumers using queryKeys.environments.
      queryClient.invalidateQueries({ queryKey: queryKeys.environments.all });
      // LIVE catch 2026-06-06: pages today fetch via useEngineApi which uses
      // key `['engine', '/api/v1/environments']` (different tree). Without
      // a second invalidation, the table stays stale after delete/create.
      queryClient.invalidateQueries({ queryKey: ['engine'] });
    },
  });
}

/**
 * usePromoteEnvironment — Plan J-10 v1.1 T1.3 (NEW).
 *
 * Promotes the active release of `from` env into `to` env (re-deploy with
 * same commit_sha, env-specific context). Backend handler is at
 * POST /api/v1/projects/{projectName}/promote with body {from, to}.
 *
 * The handler:
 *   - Verifies the source env has a terminal (ACTIVE) release.
 *   - Submits a new build cloning commit_sha + apps_spec from source.
 *   - On success the source release transitions to SUPERSEDED + the new
 *     release in target env transitions to ACTIVE atomically.
 *
 * Typed errors (UI maps to product-language banners per blueprint § 4.6):
 *   - BUILD_NOT_TERMINAL (409): source release still building
 *   - DEPLOY_IN_PROGRESS (409): another deploy in flight on target
 *   - PROJECT_NOT_FOUND  (404): wrong project name or cross-tenant
 *   - ENV_NOT_FOUND      (404): source or target env missing → UI surfaces
 *     "+ Create new..." sentinel per ADR D3 (create-on-the-fly)
 *
 * On success the environments list cache is invalidated so the KPI row
 * reflects the promoted release immediately.
 */
export function usePromoteEnvironment(projectName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string }) =>
      // M19: throwOnError so a typed 4xx (BUILD_NOT_TERMINAL / PROJECT_NOT_FOUND /
      // ENV_NOT_FOUND) reaches the dialog as a real error instead of resolving null
      // and forcing the UI to guess the cause (parity with useRedeploy).
      engineFetch(
        `/api/v1/projects/${encodeURIComponent(projectName)}/promote`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.environments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.builds.all });
      // LIVE catch 2026-06-06: useEngineApi key tree differs from canonical;
      // see useDeleteEnvironment comment for context.
      queryClient.invalidateQueries({ queryKey: ['engine'] });
    },
  });
}
