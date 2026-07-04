import { useMutation, useQueryClient } from '@tanstack/react-query';

import { engineFetch } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * use-bulk-delete-projects (J-07 D4) — bulk-delete the selected projects with a
 * type-to-confirm guard at the call site. Best-effort: one project's failure MUST
 * NOT abort the rest — the dialog reports exactly which succeeded and which failed
 * (honest partial-failure surface, never a silent all-or-nothing).
 */
export interface BulkDeleteResult {
  succeeded: string[];
  failed: { name: string; error: string }[];
}

/**
 * Pure, deterministic core: delete each project in order via `deleteOne`,
 * collecting per-project outcomes. Extracted from the hook so the partial-failure
 * behaviour is unit-testable without React Query / network.
 */
export async function bulkDeleteProjects(
  names: string[],
  deleteOne: (name: string) => Promise<void>,
): Promise<BulkDeleteResult> {
  const succeeded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const name of names) {
    try {
      await deleteOne(name);
      succeeded.push(name);
    } catch (e) {
      failed.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { succeeded, failed };
}

export function useBulkDeleteProjects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (names: string[]) =>
      bulkDeleteProjects(names, async (name) => {
        // throwOnError so a non-2xx becomes a caught failure for THIS project,
        // recorded in `failed` — the loop continues to the next.
        await engineFetch(
          `/api/v1/projects/${encodeURIComponent(name)}`,
          { method: 'DELETE' },
          { throwOnError: true },
        );
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
  });
}
