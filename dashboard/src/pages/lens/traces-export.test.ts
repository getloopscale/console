import { describe, it, expect, vi } from 'vitest';
import {
  tracesToCsv,
  tracesToJson,
  fetchFilteredTraces,
  EXPORT_CAP,
  PAGE_SIZE,
  type ExportTrace,
} from './traces-export';

const trace = (over: Partial<ExportTrace> = {}): ExportTrace => ({ traceId: 'tr_1', ...over });

describe('tracesToCsv', () => {
  it('emits the column header + a machine-faithful row', () => {
    const csv = tracesToCsv([
      trace({ traceId: 'tr_1', name: 'checkout', model: 'claude-x', statusCode: '2', durationMs: 120, costUsd: 0.5, totalTokens: 300, sessionId: 's1' }),
    ]);
    const [header, row] = csv.split('\r\n');
    expect(header).toContain('traceId');
    expect(header).toContain('costUsd');
    expect(row).toContain('tr_1');
    expect(row).toContain('checkout');
    expect(row).toContain('300');
  });

  it('neutralizes a formula-injection payload in a user-authored field (CWE-1236)', () => {
    const csv = tracesToCsv([trace({ name: '=HYPERLINK("http://evil","x")' })]);
    expect(csv).toContain("'=HYPERLINK"); // apostrophe-prefixed → inert
  });

  it('emits only the header for an empty set', () => {
    expect(tracesToCsv([]).split('\r\n')).toHaveLength(1);
  });
});

describe('tracesToJson', () => {
  it('is the raw records array (machine-faithful, no reshape)', () => {
    const traces = [trace({ traceId: 'a', costUsd: 1 }), trace({ traceId: 'b' })];
    expect(JSON.parse(tracesToJson(traces))).toEqual(traces);
  });
});

describe('fetchFilteredTraces (bounded pagination + honest disclosure)', () => {
  // A fake pager over a synthetic dataset of `total` rows, paged by PAGE_SIZE.
  function pagerFor(total: number) {
    return vi.fn(async (queryWithPaging: string) => {
      const offset = Number(new URLSearchParams(queryWithPaging.split('?')[1] ?? '').get('offset') ?? '0');
      const n = Math.max(0, Math.min(PAGE_SIZE, total - offset));
      return Array.from({ length: n }, (_, i) => trace({ traceId: `tr_${offset + i}` }));
    });
  }

  it('returns the COMPLETE set (capped:false) when the last page is partial', async () => {
    const pager = pagerFor(700); // 500 + 200
    const { traces, capped } = await fetchFilteredTraces('?status=error', pager);
    expect(traces).toHaveLength(700);
    expect(capped).toBe(false);
    // WYSIWYG: every page carried the caller's filter query
    expect((pager.mock.calls[0]![0] as string)).toContain('status=error');
    expect((pager.mock.calls[0]![0] as string)).toContain('limit=500');
  });

  it('stops at EXPORT_CAP with capped:true when the set is larger', async () => {
    const { traces, capped } = await fetchFilteredTraces('', pagerFor(EXPORT_CAP + 500));
    expect(traces).toHaveLength(EXPORT_CAP);
    expect(capped).toBe(true);
  });

  it('appends limit+offset to an empty base query with a leading "?"', async () => {
    const pager = pagerFor(10);
    await fetchFilteredTraces('', pager);
    expect((pager.mock.calls[0]![0] as string)).toMatch(/^\?limit=500&offset=0/);
  });
});
