import { useMutation } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/** One export job, as `/v1/dashboard/memory/exports` returns it. */
export interface MemoryExport {
  id: string;
  display_name?: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  created_at?: string;
  error_message?: string;
}

/**
 * Start an export of the memory store.
 *
 * B-244 — the page built this request itself, and B-264's defect was sitting in it. Without
 * `{ throwOnError: true }` a refused POST RESOLVED `null`, `onSuccess` fired with that `null`, and
 * the handler's first line was `if (!row?.id) return;`. So the user clicked "Create export",
 * nothing appeared in the list, and nothing said why — a swallowed failure wearing the clothes of
 * a no-op.
 *
 * `throwOnError` makes the refusal an `ApiError` the screen can name. The `null` that remains is a
 * 2xx with no body, which for a POST that exists to return the created job is a contract violation
 * rather than a job without an id — so it throws instead of handing the caller something to guess
 * about (B-235).
 */
export function useCreateMemoryExport() {
  return useMutation({
    mutationFn: async (): Promise<MemoryExport> => {
      const created = await cloudFetch<MemoryExport>(
        '/v1/dashboard/memory/exports',
        { method: 'POST', body: '{}' },
        { throwOnError: true },
      );
      if (created === null) {
        throw new Error('The export was accepted but the server did not say which one it is.');
      }
      return created;
    },
  });
}

/**
 * The current state of one export job.
 *
 * Deliberately a plain function and not a hook: the page polls N jobs at once from a single
 * `setInterval` that pauses when the tab is hidden, and that loop is UI timing rather than
 * transport. Moving it to react-query would mean `useQueries` and a rewrite of the visibility
 * gating — work this migration does not need and the item does not ask for (parsimony ladder,
 * rung 1).
 *
 * `throwOnError` changes no behaviour at the call site, which already wraps this in `.catch`: a
 * failed poll is tolerated on purpose, because one bad tick must not stop the loop. What it changes
 * is honesty — a 500 now arrives as a rejection instead of resolving `null`, so "the server
 * refused" stops being indistinguishable from "the server said nothing".
 */
export function fetchMemoryExportStatus(id: string): Promise<MemoryExport | null> {
  return cloudFetch<MemoryExport>(
    `/v1/dashboard/memory/exports/${encodeURIComponent(id)}/status`,
    {},
    { throwOnError: true },
  );
}
