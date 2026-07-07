import { describe, it, expect } from 'vitest';

import { formatCost } from '@/lib/format';
import {
  TRACING_OVERVIEW_TEMPLATE,
  WIDGET_TYPES,
  validateConfig,
  addWidget,
  removeWidget,
  moveWidget,
  bindKpi,
  bindTrend,
  bindTopN,
  MAX_WIDGETS,
  type Widget,
  type BoardData,
} from './widgets';

const OBS: NonNullable<BoardData['observability']> = {
  traffic: [
    { periodStart: '2026-07-07T00:00:00Z', traceCount: 100, errorCount: 5, errorRate: 0.05 },
    { periodStart: '2026-07-07T01:00:00Z', traceCount: 60, errorCount: 0, errorRate: 0 },
  ],
  latency: [
    { periodStart: '2026-07-07T00:00:00Z', p50Ms: 100, p95Ms: 400, p99Ms: 800 },
    { periodStart: '2026-07-07T01:00:00Z', p50Ms: 90, p95Ms: 350, p99Ms: 700 },
  ],
  tokensByModel: [
    { periodStart: '2026-07-07T00:00:00Z', model: 'gpt-4o', totalTokens: 1000, costUsd: 0.05 },
    { periodStart: '2026-07-07T00:00:00Z', model: 'gpt-4o-mini', totalTokens: 5000, costUsd: 0.01 },
    { periodStart: '2026-07-07T01:00:00Z', model: 'gpt-4o', totalTokens: 500, costUsd: 0.03 },
  ],
};
const DATA: BoardData = { observability: OBS, cost: { buckets: [{ costUsd: 0.05 }, { costUsd: 0.03 }] } };

describe('M66 widget model', () => {
  it('test_template_is_valid_and_covers_kpi_trend_topn', () => {
    expect(validateConfig('Tracing Overview', TRACING_OVERVIEW_TEMPLATE)).toBeNull();
    const types = new Set(TRACING_OVERVIEW_TEMPLATE.map((w) => w.type));
    for (const t of WIDGET_TYPES) expect(types.has(t)).toBe(true); // kpi + trend + topn all present
  });

  it('test_validateConfig_rejects_unknown_type_metric_and_oversize', () => {
    expect(validateConfig('', TRACING_OVERVIEW_TEMPLATE)).toMatch(/name is required/i); // negative: empty name
    expect(validateConfig('n', [])).toMatch(/at least one widget/i); // negative: empty
    expect(validateConfig('n', [{ type: 'pie' as unknown as Widget['type'], metric: 'traces' }])).toMatch(/unknown type/i);
    expect(validateConfig('n', [{ type: 'kpi', metric: 'revenue' as unknown as Widget['metric'] }])).toMatch(/unknown metric/i);
    const big = Array.from({ length: MAX_WIDGETS + 1 }, () => ({ type: 'kpi', metric: 'traces' }) as Widget);
    expect(validateConfig('n', big)).toMatch(/at most/i); // edge: one past the cap
  });

  it('test_bindKpi_maps_each_metric_from_the_shared_fetch', () => {
    expect(bindKpi('traces', DATA)).toBe('160'); // 100 + 60
    expect(bindKpi('error_rate', DATA)).toBe('3%'); // 5/160 ≈ 3%
    expect(bindKpi('p95_latency', DATA)).not.toBe('—'); // real p95 present
    expect(bindKpi('cost', DATA)).not.toBe('—'); // real cost present
  });

  it('test_bindKpi_absent_data_is_em_dash_not_a_fabricated_zero', () => {
    // negative: no observability/cost loaded → em-dash, NEVER "$0" / "0"
    expect(bindKpi('traces', {})).toBe('—');
    expect(bindKpi('cost', { observability: OBS })).toBe('—');
  });

  it('test_bindKpi_empty_but_present_series_rate_and_percentile_are_em_dash', () => {
    // the quiet-tenant case (fetch SUCCEEDED, arrays empty): a rate/percentile over an empty set is
    // UNDEFINED, so error_rate/p95_latency are em-dash — NOT a misleading "0%" / "0ms".
    const empty: BoardData = { observability: { traffic: [], latency: [], tokensByModel: [] }, cost: { buckets: [] } };
    expect(bindKpi('error_rate', empty)).toBe('—');
    expect(bindKpi('p95_latency', empty)).toBe('—');
    // a count/sum of zero IS a defined, honest measurement (matches the M60 Overview)
    expect(bindKpi('traces', empty)).toBe('0');
    expect(bindKpi('cost', empty)).toBe(formatCost(0));
  });

  it('test_bindTrend_maps_metric_or_empty_when_absent', () => {
    expect(bindTrend('traces', DATA).length).toBeGreaterThan(0);
    expect(bindTrend('p95_latency', DATA).length).toBeGreaterThan(0);
    expect(bindTrend('traces', {})).toEqual([]); // absent → empty, no fabricated line
  });

  it('test_bindTopN_ranks_models_by_cost_and_is_empty_when_absent', () => {
    const top = bindTopN(DATA);
    expect(top[0].model).toBe('gpt-4o'); // 0.05 + 0.03 = 0.08 > gpt-4o-mini 0.01
    expect(top[0].costUsd).toBeCloseTo(0.08, 6);
    expect(bindTopN({})).toEqual([]); // absent → empty
  });

  it('test_move_add_remove_are_pure_ordered_list_ops', () => {
    const base: Widget[] = [
      { type: 'kpi', metric: 'traces' },
      { type: 'trend', metric: 'traces' },
    ];
    expect(addWidget(base, { type: 'topn', metric: 'tokens_by_model' })).toHaveLength(3);
    expect(base).toHaveLength(2); // pure — original untouched
    expect(removeWidget(base, 0)).toEqual([{ type: 'trend', metric: 'traces' }]);
    expect(moveWidget(base, 0, 1)[0]).toEqual({ type: 'trend', metric: 'traces' }); // swapped
    expect(moveWidget(base, 0, -1)).toEqual(base); // edge: move-up at index 0 is a no-op
    expect(moveWidget(base, 1, 1)).toEqual(base); // edge: move-down at last index is a no-op
  });
});
