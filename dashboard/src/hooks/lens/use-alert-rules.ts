import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  window_seconds: number;
  webhook_id: string;
  enabled: boolean;
  status: string;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
}

export interface AlertRulesResult {
  alert_rules: AlertRule[];
}

/** M84 — one firing in a rule's history (metric value at fire time vs threshold, when). */
export interface FiredAlert {
  id: string;
  metric: string;
  comparator: string;
  threshold: number;
  value: number;
  fired_at: string;
}

const BASE = '/v1/dashboard/lens/alert-rules';

const rulesQueryKey = ['cloud', BASE] as const;

export function useAlertRules() {
  return useQuery({
    queryKey: rulesQueryKey,
    queryFn: () => cloudFetch<AlertRulesResult>(BASE, {}, { throwOnError: true }),
  });
}

/**
 * One rule's firing history (M84), read lazily when the row is expanded.
 *
 * `throwOnError` is what keeps a load failure from rendering as "never fired" — the two are
 * opposite facts and the empty response cannot tell them apart.
 */
export function useAlertRuleHistory(ruleId: string) {
  return useQuery({
    queryKey: [...rulesQueryKey, ruleId, 'history'] as const,
    queryFn: () =>
      cloudFetch<{ firings: FiredAlert[]; total: number }>(
        `${BASE}/${encodeURIComponent(ruleId)}/history`,
        {},
        { throwOnError: true },
      ),
  });
}

export function useCreateAlertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      cloudFetch<AlertRule>(BASE, { method: 'POST', body: JSON.stringify(input) }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });
}

export function useDeleteAlertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<unknown>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });
}

/**
 * The On/Off toggle (M98, D-H3) — the one write on this screen that flips OPTIMISTICALLY, because a
 * binary control is where optimism clearly pays: no stale round-trip gap on a switch.
 *
 * The three callbacks are a unit and only work together, which is the reason they belong in one
 * module rather than being reassembled at a call site. `onMutate` flips the cached rule and returns
 * the snapshot; `onError` restores it, so a refused PATCH never leaves the switch showing a state
 * the server rejected (the M83 no-silent-divergence rule); `onSettled` re-syncs either way.
 *
 * Lose `onError` in a move and the defect is invisible in tests that only exercise the happy path:
 * the toggle keeps working, and only a refused write leaves the UI lying.
 */
export function useToggleAlertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (r: AlertRule) =>
      cloudFetch<unknown>(
        `${BASE}/${encodeURIComponent(r.id)}`,
        { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) },
        { throwOnError: true },
      ),
    retry: false,
    onMutate: async (r: AlertRule) => {
      await queryClient.cancelQueries({ queryKey: rulesQueryKey });
      const prev = queryClient.getQueryData<AlertRulesResult>(rulesQueryKey);
      queryClient.setQueryData<AlertRulesResult>(rulesQueryKey, (old) =>
        old
          ? {
              ...old,
              alert_rules: old.alert_rules.map((x) =>
                x.id === r.id ? { ...x, enabled: !x.enabled } : x,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _r, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(rulesQueryKey, ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });
}
