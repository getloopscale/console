import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Project, ProjectCreateInput } from '@/lib/api/types';

/**
 * Create a project.
 *
 * B-244 — the form built this request itself, with its own `submitting` and `error` state and a
 * `res === null` branch. Three things came out of moving it here:
 *
 *   - `isPending` and `error` come from the mutation, so the form stops maintaining a second
 *     copy of state react-query already tracks;
 *   - `throwOnError: true` removes the `res === null` branch entirely. Without it `engineFetch`
 *     resolves `null` on a non-2xx, and the caller has to invent a message for a failure it
 *     cannot describe — the ambiguity B-235 records one layer down;
 *   - the projects list is invalidated on success, which the form did not do. It called
 *     `onCreated` and left it to the caller; a caller that forgot showed a stale list.
 *
 * B-260 — the body is typed with `ProjectCreateInput`, which existed in `lib/api/types.ts` and
 * was imported by nobody. The dashboard created projects while the type describing a creation
 * request sat unused, so nothing checked the description against what is actually sent. Typing
 * it here is what makes the contract enforceable rather than decorative.
 */
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProjectCreateInput): Promise<Project> => {
      const created = await engineFetch<Project>(
        '/api/v1/projects',
        { method: 'POST', body: JSON.stringify(input) },
        { throwOnError: true },
      );
      // B-235, met head-on. `engineFetch` is typed `T | null` even with `throwOnError: true`,
      // because the signature does not narrow — the ambiguity that item records. With
      // `throwOnError` a non-2xx REJECTS, so the only `null` left is a 2xx with no body, which
      // for POST /projects means the server said "created" and did not say what. That is a
      // contract violation, and failing loudly here is the honest reading: the alternative is
      // handing every caller a `Project | null` and letting each invent a meaning for `null`.
      if (created === null) {
        throw new Error(
          'The server accepted the project but returned no body — nothing can confirm what was created.',
        );
      }
      return created;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}
