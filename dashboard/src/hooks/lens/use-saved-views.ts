import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

export interface SavedView {
  id: string;
  name: string;
  query_string: string;
}

export interface SavedViewsResult {
  saved_views: SavedView[];
  /**
   * B-114 — the server caps the list at 100 and now SAYS when the cap bit. Before that the 101st
   * view vanished in silence: the screen showed 100 and nothing indicated there were more.
   */
  has_more?: boolean;
}

const BASE = '/v1/dashboard/lens/saved-views';

const savedViewsKey = ['cloud', BASE] as const;

export function useSavedViews() {
  return useQuery({
    queryKey: savedViewsKey,
    queryFn: () =>
      cloudFetch<SavedViewsResult>(`${BASE}?limit=${LIST_SAFETY_CEILING}`, {}, { throwOnError: true }),
  });
}

/**
 * Save the current filter combination as a view.
 *
 * B-235 — no error contract. A refused POST resolved `null`, the dialog closed, the name field was
 * cleared and the list refreshed. The user's view was simply not there, which on a list that caps
 * at 100 reads as "I hit the limit" rather than "the server refused".
 */
export function useCreateSavedView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (view: { name: string; query_string: string }) =>
      cloudFetch<SavedView>(
        BASE,
        { method: 'POST', body: JSON.stringify(view) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: savedViewsKey });
    },
  });
}

export function useDeleteSavedView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<unknown>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: savedViewsKey });
    },
  });
}
