import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * One point of the per-day series a row carries when `bucket=day` was requested.
 *
 * Field for field as `pages/lens/usage-series.ts` declared it, which now imports it from here. It
 * belongs with the endpoint: it is the wire shape of a response, and the arithmetic over it is a
 * consumer. Two declarations of one payload are two chances to disagree — the reason B-236 deleted
 * a duplicated `PlanLimitDetail`.
 *
 * My first version of this interface invented `{ t, v }`. `tsc` rejected it against the real one,
 * twice in a row for two different types in this same file. Guessing a payload shape instead of
 * reading it is exactly what `DomainRow` recorded, and the compiler is the only reason it cost
 * minutes instead of silently dropping fields the chart plots.
 */
export interface PontoDaSerie {
  periodStart: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/**
 * One row of per-user usage, field for field as the page already declared it.
 *
 * Copied from the screen rather than invented: my first version of this interface guessed a
 * narrower shape (`user`, `cost`) and `tsc` rejected it against the real one. That is the same trap
 * `DomainRow` recorded — adopting a guessed shape silently drops fields the UI renders, and the
 * only reason it did not here is that the compiler caught it.
 */
export interface UsageRow {
  userId: string;
  /** M144 — presente só quando a chamada pediu `bucket=day`. */
  series?: PontoDaSerie[];
  spans: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface UsageResult {
  users: UsageRow[];
  unpricedSpans: number;
  totalUsers: number;
  windowDays: number;
}

/**
 * Per-user usage over a window.
 *
 * B-244 — the page built this itself. The parameters are the interesting part and the reason this
 * was worth moving rather than leaving: `days`, `page` and `withSeries` are ALL part of the cache
 * key, because without them react-query answers a 30-day question with the 7-day response and the
 * screen states a period it is not showing.
 *
 * That agreement between the URL and the key is the kind that holds while one person maintains
 * both and breaks the first time someone adds a filter to the URL and not to the key. Here they are
 * built from the same arguments, in one place, so they cannot disagree.
 *
 * `throwOnError` keeps a failed read from arriving as an empty user list, which a screen renders as
 * "nobody used anything" — the most confidently wrong thing a usage report can say.
 */
export function useUsageByUser(params: {
  days: number;
  page: number;
  pageSize: number;
  withSeries: boolean;
}) {
  const { days, page, pageSize, withSeries } = params;
  const offset = (page - 1) * pageSize;

  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/usage-by-user', days, page, withSeries] as const,
    queryFn: () =>
      cloudFetch<UsageResult>(
        `/v1/dashboard/lens/usage-by-user?days=${String(days)}&limit=${String(pageSize)}` +
          `&offset=${String(offset)}${withSeries ? '&bucket=day' : ''}`,
        {},
        { throwOnError: true },
      ),
  });
}
