import { registerRoute } from './server';
import { makeProjectStatus } from './fixtures';
import type { ProjectStatusDetail, RollbackResponse } from '@/lib/api/types';

/**
 * Mock of the rollback and of the project status that reports how it ended.
 *
 * The two routes live together because they share state: the API answers the
 * rollback POST with 202 and the console then polls the status until
 * `active_release` is the release the 202 named. The mock completes an accepted
 * rollback on the next status read.
 */
const reactivatedReleases = new Map<string, string>();

/** Forgets the accepted rollbacks. Called by `resetMockDB()`. */
export function resetRollbackMocks(): void {
  reactivatedReleases.clear();
}

function err(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}

export function registerRollbackHandlers() {
  registerRoute('GET', '/api/v1/projects/{name}/status', async (_req, { name }) => {
    const status: ProjectStatusDetail = makeProjectStatus(name);
    const reactivated = reactivatedReleases.get(name);
    if (reactivated) {
      status.active_release = {
        id: reactivated,
        build_id: reactivated.replace(/^rel-/, ''),
        status: 'ACTIVE',
        created_at: status.last_deploy_at ?? '',
      };
    }
    return Response.json(status);
  });

  registerRoute('POST', '/api/v1/projects/{name}/rollback', async (req, { name }) => {
    const body = (await req.json()) as { build_id?: string; environment?: string };
    if (!body.build_id) return err('INVALID_INPUT', 'build_id required', 400);
    const accepted: RollbackResponse = {
      status: 'in_progress',
      rolled_back_release: 'rel-current',
      reactivated_release: `rel-${body.build_id}`,
      environment: body.environment ?? 'production',
      url: '',
    };
    reactivatedReleases.set(name, accepted.reactivated_release);
    return Response.json(accepted, { status: 202 });
  });
}
