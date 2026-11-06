import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/**
 * A board's widgets, kept opaque here on purpose.
 *
 * `Widget` is a rendering concern owned by `pages/lens/dashboards/`, and `src/hooks` may not import
 * from `src/pages` (the layer direction `eslint.config.js` enforces since B-070). Rather than move a
 * rendering type into the transport layer to satisfy the compiler, the row is generic over it: the
 * page supplies the type it already owns.
 */
export interface DashboardRow<W> {
  id: string;
  name: string;
  config: W[];
  createdBy?: string;
  createdAt?: string;
}

const BASE = '/v1/dashboard/lens/dashboards';

const dashboardsQueryKey = ['cloud', BASE] as const;

export function useDashboardList<W>() {
  return useQuery({
    queryKey: dashboardsQueryKey,
    queryFn: () =>
      cloudFetch<{ dashboards: DashboardRow<W>[] }>(
        `${BASE}?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}

export function useDashboard<W>(boardId: string) {
  return useQuery({
    queryKey: [...dashboardsQueryKey, boardId] as const,
    queryFn: () =>
      cloudFetch<DashboardRow<W>>(
        `${BASE}/${encodeURIComponent(boardId)}`,
        {},
        { throwOnError: true },
      ),
    enabled: boardId.length > 0,
  });
}

export function useCreateDashboard<W>() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (board: { name: string; config: W[] }) =>
      cloudFetch<DashboardRow<W>>(
        BASE,
        { method: 'POST', body: JSON.stringify(board) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardsQueryKey });
    },
  });
}

/**
 * Replace a board.
 *
 * The endpoint's PUT is a FULL replace, which is why the rename path on the list echoes the row's
 * existing `config` back rather than sending the name alone: a PUT carrying only `{ name }` blanks
 * the board's widgets. Both writes go through this one function so that rule has one place to be
 * stated and one place to be got wrong.
 */
export function useSaveDashboard<W>() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (board: { id: string; name: string; config: W[] }) =>
      cloudFetch<DashboardRow<W>>(
        `${BASE}/${encodeURIComponent(board.id)}`,
        { method: 'PUT', body: JSON.stringify({ name: board.name, config: board.config }) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: (_row, board) => {
      void queryClient.invalidateQueries({ queryKey: dashboardsQueryKey });
      void queryClient.invalidateQueries({ queryKey: [...dashboardsQueryKey, board.id] });
    },
  });
}

export function useDeleteDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<void>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardsQueryKey });
    },
  });
}
