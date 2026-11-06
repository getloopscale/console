import { engineFetch } from '@/lib/http/api';

/**
 * Delete a project.
 *
 * Left in the default `T | null` mode on purpose. The caller navigates away on completion, so a
 * refusal that resolved would land the user on the projects list — where the project they just
 * "deleted" is still listed. That is a visible contradiction rather than a silent one, which is
 * exactly the shape B-235 does NOT cover, and adding a contract here would mean designing the error
 * surface for a destructive action mid-refactor. Registered instead: B-275.
 */
export function deleteProject(name: string): Promise<unknown> {
  return engineFetch(`/api/v1/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
}
