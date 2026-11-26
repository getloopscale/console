import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * An evaluator, in the shape the endpoint returns it.
 *
 * B-244 — this was declared twice. `evaluators.tsx` had the full shape; `monitors.tsx` had a
 * SUBSET carrying only `id` and `name`, because that is all its picker rendered.
 *
 * `use-datasets.ts` recorded this exact pattern one file over, in the same feature, and named why
 * it is the quietest way duplication charges: the subset is not wrong today, so nothing fails. It
 * charges when the backend adds a field one screen needs — the author finds two declarations and
 * edits whichever was open, and the other screen keeps a shape that silently no longer matches.
 *
 * Third occurrence in this family. Declaring it once, next to the request that produces it, is the
 * only version of this that does not depend on somebody remembering.
 */
export interface Evaluator {
  id: string;
  name: string;
  kind?: string;
  enabled?: boolean;
  /**
   * The evaluator's rule config — passed through verbatim from looptrace (BFF `json.RawMessage`).
   * `rule` → `{ predicate }`; `llm_judge` → `{ prompt, model }`. Optional and loose because it is
   * an upstream shape this layer does not own.
   */
  config?: { predicate?: string; prompt?: string; model?: string };
}

export interface EvaluatorsResult {
  evaluators: Evaluator[];
}

const EVALUATORS_PATH = '/v1/dashboard/lens/evaluators';

const evaluatorsQueryKey = ['cloud', EVALUATORS_PATH] as const;

/**
 * The evaluators listing.
 *
 * `throwOnError` for the reason its sibling list states: a failed read arriving as an empty array
 * shows "no evaluators — create one first" while the service is down, which sends an operator to
 * create something that already exists. `lens/monitors.test.tsx:389` asserts exactly that message
 * is absent on a failed read, and that assertion exists because it happened.
 *
 * `retry` is the ONLY option, and it exists because it is the only thing that genuinely differed
 * between the two callers: `monitors.tsx` passed `retry: false`, `evaluators.tsx` did not. Picking
 * one for both would be changing a behaviour neither asked me to change, and defaulting it here
 * would hide that the difference is probably incidental rather than decided.
 */
export function useEvaluators(options?: { retry?: boolean }) {
  return useQuery({
    queryKey: evaluatorsQueryKey,
    queryFn: () => cloudFetch<EvaluatorsResult>(EVALUATORS_PATH, {}, { throwOnError: true }),
    retry: options?.retry,
  });
}

/** M133 — an async evaluator-run job: POST /run registers it (202) and the client polls for progress. */
export interface RunJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total: number;
  scored: number;
  skipped: number;
  errors: number;
  truncated: boolean;
  errorMessage?: string;
}

/**
 * Create an evaluator.
 *
 * B-244/B-235 — this carried no error contract, and it is the most expensive instance found so far.
 * A refused POST RESOLVED `null`, `onSuccess` fired, and the handler cleared FIVE fields and closed
 * the dialog: name, predicate, prompt, model and the open state. The user lost everything they had
 * typed, for an evaluator that was never created, with no error and nothing to recover.
 *
 * The trace annotation (also fixed this cycle) destroyed one textarea. This destroys a whole form.
 */
export function useCreateEvaluator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: unknown) =>
      cloudFetch<Evaluator>(
        EVALUATORS_PATH,
        { method: 'POST', body: JSON.stringify(body) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: evaluatorsQueryKey });
    },
  });
}

/**
 * Delete an evaluator.
 *
 * B-235 — same missing contract, familiar symptom: the confirmation closed and the evaluator came
 * back on the next read, which reads as the product undoing the user's action.
 */
export function useDeleteEvaluator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<null>(
        `${EVALUATORS_PATH}/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: evaluatorsQueryKey });
    },
  });
}

/** Rename an evaluator. `throwOnError` was already here — a 409 must reject so the typed Alert shows. */
export function useRenameEvaluator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (r: { id: string; name: string }) =>
      cloudFetch<Evaluator>(
        `${EVALUATORS_PATH}/${encodeURIComponent(r.id)}`,
        { method: 'PUT', body: JSON.stringify({ name: r.name }) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: evaluatorsQueryKey });
    },
  });
}

/** Start a manual run. Returns the queued job the caller then polls. */
export function useRunEvaluator() {
  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<RunJob>(
        `${EVALUATORS_PATH}/${encodeURIComponent(id)}/run`,
        { method: 'POST', body: JSON.stringify({ limit: 100 }) },
        { throwOnError: true },
      ),
    retry: false,
  });
}

/**
 * Poll one run job until it reaches a terminal state.
 *
 * The polling interval lives here because it is a property of the ENDPOINT's contract — the job is
 * asynchronous and reports progress — not of the screen that happens to show it. A second screen
 * polling the same job at a different cadence would be two answers to one question.
 */
export function useEvaluatorRunJob(jobId: string | null) {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/evaluator-run-jobs', jobId] as const,
    queryFn: () =>
      cloudFetch<RunJob>(
        `/v1/dashboard/lens/evaluator-run-jobs/${encodeURIComponent(jobId ?? '')}`,
        {},
        { throwOnError: true },
      ),
    enabled: jobId !== null,
    refetchInterval: (q) => {
      const status = (q.state.data as RunJob | undefined)?.status;
      return status === 'completed' || status === 'failed' ? false : 1500;
    },
  });
}
