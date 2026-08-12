import { useQuery } from '@tanstack/react-query';
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
   * The evaluator's rule config — passed through verbatim from theo-lens (BFF `json.RawMessage`).
   * `rule` → `{ predicate }`; `llm_judge` → `{ prompt, model }`. Optional and loose because it is
   * an upstream shape this layer does not own.
   */
  config?: { predicate?: string; prompt?: string; model?: string };
}

export interface EvaluatorsResult {
  evaluators: Evaluator[];
}

const EVALUATORS_PATH = '/v1/dashboard/lens/evaluators';

export const evaluatorsQueryKey = ['cloud', EVALUATORS_PATH] as const;

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
