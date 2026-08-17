import { engineFetch } from '@/lib/http/api';
import type { InstallationRepositoriesResponse, ProjectConnection } from '@/lib/api/types';

/**
 * The two GitHub-connect calls, as plain async functions.
 *
 * Deliberately not mutations or queries: the repository list is fetched from an effect keyed on the
 * installation id with its own cancellation flag, and the connect call runs inside a submit handler
 * that owns its busy state and its error copy. Wrapping either in TanStack would replace working
 * cancellation and error routing with a cache neither one reads.
 *
 * Both stay in the default `T | null` mode, and that is a decision rather than an omission. Each
 * caller already branches on `null` and renders a specific, actionable message — "we couldn't load
 * your repositories" and "couldn't connect repository" — so `throwOnError` would move that copy
 * into a catch without changing what the user sees. B-235 is about refusals that reach nobody; here
 * they reach a message.
 */
export function fetchInstallationRepositories(
  installationID: number,
): Promise<InstallationRepositoriesResponse | null> {
  return engineFetch<InstallationRepositoriesResponse>(
    `/api/v1/integrations/github/installations/${installationID}/repositories`,
  );
}

export function connectProjectRepository(
  projectName: string,
  body: { repo: string; installation_id: number; branch: string; auto_deploy: boolean },
): Promise<ProjectConnection | null> {
  return engineFetch<ProjectConnection>(
    `/api/v1/projects/${encodeURIComponent(projectName)}/connect`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * Disconnect a project's repository.
 *
 * M18 — a failed disconnect must NOT no-op silently: the repo stays connected and auto-deploying,
 * and the screen would say otherwise. The caller catches and surfaces, which is why this one is a
 * bare call rather than a contract — `engineFetch` already rejects on the network failure the
 * caller's catch is written for, and the caller checks nothing else.
 */
export function disconnectProjectRepository(projectName: string): Promise<unknown> {
  return engineFetch(`/api/v1/projects/${encodeURIComponent(projectName)}/connect`, {
    method: 'DELETE',
  });
}
