import { useMutation } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

const tracePath = (traceId: string) => `/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}`;

/**
 * Every write launched from a trace, and every one of them carries `retry: false`.
 *
 * That is the through-line worth stating once here rather than five times apart. Three of these are
 * BILLABLE provider calls (`ask`, `replay`) or upstream work (`enqueue`), and the other two record
 * a human's vote. Neither class may be re-sent silently: ADR D1 / R4 — a billable provider call is
 * NEVER auto-retried, and a re-sent vote is a vote counted twice.
 *
 * They all take `throwOnError` for the matching reason: a refusal on a paid action has to reach the
 * screen, or the operator presses the button again for something the server already declined.
 */

/** Add a span to the labeling queue. */
export function useEnqueueForLabeling(traceId: string) {
  return useMutation({
    mutationFn: (spanId: string) =>
      cloudFetch(
        `${tracePath(traceId)}/enqueue-for-labeling`,
        { method: 'POST', body: JSON.stringify({ spanId }) },
        { throwOnError: true },
      ),
    retry: false,
  });
}

/**
 * Ask a question about a trace (M33).
 *
 * The trace id travels in the VARIABLES rather than being closed over, which is R1: a resolving
 * answer must be matchable against the still-docked trace, so an answer never lands under a
 * different trace the user opened mid-flight. The caller compares and drops the stale one — this
 * hook's job is only to make sure the id it was asked with survives the round trip.
 */
export function useAskTrace() {
  return useMutation({
    mutationFn: (vars: { question: string; spanId?: string; askedTraceId: string }) =>
      cloudFetch<{ answer: string }>(
        `${tracePath(vars.askedTraceId)}/ask`,
        {
          method: 'POST',
          body: JSON.stringify({
            question: vars.question,
            ...(vars.spanId ? { spanId: vars.spanId } : {}),
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
  });
}

/**
 * Record thumbs feedback on one answer (M83).
 *
 * Deliberately independent of the ask (risk-2): a 502 on the provider call never blocks feedback,
 * and vice-versa. The caller applies the toggle optimistically and reverts on error — which only
 * works because this rejects rather than resolving `null`, since a resolved refusal would leave the
 * thumb pressed on a vote the store never took.
 */
export function useAskFeedback(traceId: string) {
  return useMutation({
    mutationFn: (vars: { turnId: string; label: 'up' | 'down'; spanId?: string }) =>
      cloudFetch<{ label: string }>(
        `${tracePath(traceId)}/ask/feedback`,
        {
          method: 'POST',
          body: JSON.stringify({
            turnId: vars.turnId,
            label: vars.label,
            ...(vars.spanId ? { spanId: vars.spanId } : {}),
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
  });
}

/** Retract a vote (M83) — persisted so the store never diverges from the shown thumb (review H-1). */
export function useClearAskFeedback(traceId: string) {
  return useMutation({
    mutationFn: (vars: { turnId: string }) =>
      cloudFetch<void>(
        `${tracePath(traceId)}/ask/feedback?turnId=${encodeURIComponent(vars.turnId)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    retry: false,
  });
}

/**
 * Replay a span against edited prompt variants (the playground).
 *
 * Like the ask, the run key travels in the variables: a resolving run marks the LATEST variant
 * stale-or-fresh against the inputs AT RUN TIME, so an edit made mid-flight is preserved and
 * correctly shown as stale (ADR D3). The run never rebuilds the variant from a stale closure.
 */
export function useReplaySpan<R>(traceId: string) {
  return useMutation({
    mutationFn: (vars: {
      ranKey: string;
      messages: { role: string; content: string }[];
      model?: string;
      responseSchema?: unknown;
    }) =>
      cloudFetch<R>(
        `${tracePath(traceId)}/replay`,
        {
          method: 'POST',
          body: JSON.stringify({
            messages: vars.messages,
            ...(vars.model ? { model: vars.model } : {}),
            ...(vars.responseSchema ? { responseSchema: vars.responseSchema } : {}),
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
  });
}

/** Save a replay's output into a dataset (the opt-in "keep this" on the playground). */
export function useSaveToDataset() {
  return useMutation({
    mutationFn: (vars: { datasetId: string; input: string; output: string }) =>
      cloudFetch(
        `/v1/dashboard/lens/datasets/${encodeURIComponent(vars.datasetId)}/items`,
        { method: 'POST', body: JSON.stringify({ input: vars.input, output: vars.output }) },
        { throwOnError: true },
      ),
    retry: false,
  });
}
