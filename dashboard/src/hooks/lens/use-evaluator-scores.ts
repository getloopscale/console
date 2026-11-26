import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * One bucket of the score-over-time series (M90).
 *
 * Declared here rather than in `pages/lens/components/lens-series.ts`, which now imports it: this
 * is the wire shape of a response, and the charting arithmetic is a consumer of it. Five modules
 * read `ScoreBucket`, and having the shape live with the endpoint means the next backend field
 * reaches all five from one edit.
 *
 * It is also the only way the hook can be typed at all — `src/hooks` may not import from
 * `src/pages` (the layer direction `eslint.config.js` enforces since B-070), and a response type
 * living under `pages/` is exactly the inversion that rule exists to catch.
 */
export interface ScoreBucket {
  periodStart: string;
  name: string;
  sampleCount: number;
  /** Mean of the numeric scores in this bucket — absent for a categorical-only evaluator. */
  avgScore?: number;
  labels: Record<string, number>;
}

export interface ScoresResult {
  range?: string;
  scores: ScoreBucket[];
}

/** The ranges looptrace whitelists. Passing anything else is a 400. */
export const SCORES_RANGES = ['1h', '24h', '7d', '30d'] as const;
export type ScoresRange = (typeof SCORES_RANGES)[number];

export const scoresQueryKey = ['cloud', '/v1/dashboard/lens/metrics/scores'] as const;

/**
 * Evaluator scores over a range.
 *
 * The range is part of the cache key, for the same reason the usage report's window is: without it
 * react-query answers a 30-day question with the 1-hour response and the chart states a period it
 * is not showing.
 */
export function useEvaluatorScores(range: ScoresRange) {
  return useQuery({
    queryKey: [...scoresQueryKey, range] as const,
    queryFn: () =>
      cloudFetch<ScoresResult>(
        `/v1/dashboard/lens/metrics/scores?range=${range}`,
        {},
        { throwOnError: true },
      ),
  });
}
