import { engineFetch } from '@/lib/http/api';
import type { InstallationRepositoriesResponse, ProjectConnection } from '@/lib/api/types';

/** A GitHub App installation GitHub confirmed the team can use. */
export interface GitHubInstallation {
  id: number;
  account_login: string;
  account_type: string;
}

/**
 * The GitHub-connect calls, as plain async functions.
 *
 * The repository list is fetched from an effect keyed on the installation id with its own
 * cancellation flag, and the connect call runs inside a submit handler that owns its busy state
 * and its error copy.
 *
 * All of them reject with `ApiError` on a refusal. The page needs the status: the engine answers
 * 403 for an installation GitHub has not confirmed for the team, and the page then offers the
 * authorization instead of a retry.
 */

/** The installations GitHub confirmed for the signed-in user's team. Empty when there is none. */
export async function fetchGitHubInstallations(): Promise<GitHubInstallation[]> {
  const data = await engineFetch<{ installations: GitHubInstallation[] }>(
    '/api/v1/integrations/github/installations',
    {},
    { throwOnError: true },
  );
  return data?.installations ?? [];
}

export function fetchInstallationRepositories(
  installationID: number,
): Promise<InstallationRepositoriesResponse | null> {
  return engineFetch<InstallationRepositoriesResponse>(
    `/api/v1/integrations/github/installations/${installationID}/repositories`,
    {},
    { throwOnError: true },
  );
}

export function connectProjectRepository(
  projectName: string,
  body: { repo: string; installation_id: number; branch: string; auto_deploy: boolean },
): Promise<ProjectConnection | null> {
  return engineFetch<ProjectConnection>(
    `/api/v1/projects/${encodeURIComponent(projectName)}/connect`,
    { method: 'POST', body: JSON.stringify(body) },
    { throwOnError: true },
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
