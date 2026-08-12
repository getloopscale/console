import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

export interface Monitor {
  id: string;
  evaluatorId?: string;
  operator?: string;
  threshold?: number;
}

export interface MonitorsResult {
  monitors: Monitor[];
}

/**
 * theo-cloud#259 — the slice of an alert rule this screen needs to show a monitor's live state.
 *
 * A monitor lives in theo-lens; the state of the thing that WATCHES it lives here, in theo-cloud's
 * `lens_alert_rules` (the M135 evaluator writes `status` / `last_evaluated_at` on its 60s tick).
 * `stale` is derived server-side — the rule is enabled but has gone unevaluated for several ticks.
 */
export interface MonitorRule {
  monitor_id?: string;
  enabled: boolean;
  status: string;
  stale: boolean;
  last_evaluated_at: string | null;
}

export interface AlertRulesResult {
  alert_rules: MonitorRule[];
}

const MONITORS_PATH = '/v1/dashboard/lens/monitors';

const monitorsQueryKey = ['cloud', MONITORS_PATH] as const;

export function useMonitors() {
  return useQuery({
    queryKey: monitorsQueryKey,
    queryFn: () =>
      cloudFetch<MonitorsResult>(
        `${MONITORS_PATH}?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
    retry: false,
  });
}

/**
 * The live state of every alert rule.
 *
 * `throwOnError` is NOT optional here, and the page's own comment explains why better than a new
 * one could: without it a 502 resolves to `null`, the query reports SUCCESS, and every monitor
 * renders "Not monitored" — the screen asserting, from an outage, that nothing is watching. That
 * is the precise failure the Unknown state exists to prevent, and it survived the unit tests
 * because the mock throws where the real client returns null. Found by driving the live stack.
 */
export function useAlertRules() {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/alert-rules'] as const,
    queryFn: () =>
      cloudFetch<AlertRulesResult>(
        '/v1/dashboard/lens/alert-rules',
        {},
        { throwOnError: true },
      ),
    retry: false,
  });
}

/** M77 — the breaches read (flag-only) for one open monitor. Fetched on demand. */
export function useMonitorBreaches(monitorId: string | null) {
  return useQuery({
    queryKey: [...monitorsQueryKey, monitorId, 'breaches'] as const,
    queryFn: () =>
      cloudFetch<{ traceIds: string[] }>(
        `${MONITORS_PATH}/${encodeURIComponent(monitorId ?? '')}/breaches`,
        {},
        { throwOnError: true },
      ),
    enabled: monitorId !== null,
  });
}

export interface MonitorInput {
  evaluatorId: string;
  operator: string;
  threshold?: number;
}

/**
 * Create a monitor.
 *
 * B-244/B-235 — no error contract, and the same shape as the evaluator create it sits beside: a
 * refusal RESOLVED `null`, `onSuccess` fired, and the handler cleared the evaluator, the operator,
 * the threshold and the dialog. The user lost the form for a monitor that was never created.
 *
 * The body omits `threshold` entirely for a label match rather than sending `0`. That distinction
 * is the endpoint's, not the form's — a fabricated zero is a threshold the user never set, and it
 * would compare as one.
 */
export function useCreateMonitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MonitorInput) =>
      cloudFetch<Monitor>(
        MONITORS_PATH,
        {
          method: 'POST',
          body: JSON.stringify(
            input.threshold === undefined
              ? { evaluatorId: input.evaluatorId, operator: input.operator }
              : input,
          ),
        },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
    },
  });
}

/**
 * Delete a monitor.
 *
 * B-235 — the familiar opposite symptom: the confirmation closed and the monitor came back on the
 * next read, which reads as the product undoing the user's action.
 */
export function useDeleteMonitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<null>(
        `${MONITORS_PATH}/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
    },
  });
}
