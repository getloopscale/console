// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  EMPTY_FILTERS,
  applyFilter,
  displayChipValue,
  filtersToChips,
  removeChip,
  chipToParam,
  paramsToFilters,
  type TraceFilters,
} from './filter-model';

/**
 * M59 P2 T2.1 — the pure chip⇄URL filter model. Round-trip identity is the load-bearing invariant
 * (R4): the chip UI must never change a URL param, so `paramsToFilters(chips.map(chipToParam))` MUST
 * reconstruct the original filters. Also: add/remove one filter without disturbing the others, and
 * ignore unknown/legacy params without throwing.
 */

const active: TraceFilters = {
  ...EMPTY_FILTERS,
  q: 'checkout',
  status: 'error',
  model: 'claude-sonnet-4-6',
  range: '24h',
  costMin: '0.1',
  tokensMax: '5000',
  session: 'sess-42',
};

describe('M59 filter-model — filtersToChips', () => {
  it('yields one chip per active filter (count == active filter count)', () => {
    // q, status, model, range, costMin, tokensMax, session = 7 active.
    expect(filtersToChips(active)).toHaveLength(7);
  });

  it('returns [] for all-empty filters (no throw)', () => {
    expect(filtersToChips(EMPTY_FILTERS)).toEqual([]);
  });

  it('models status as "status is error" and cost as "cost >= 0.1"', () => {
    const chips = filtersToChips(active);
    expect(chips).toContainEqual({ id: 'status', column: 'status', operator: 'is', value: 'error' });
    expect(chips).toContainEqual({ id: 'costMin', column: 'cost', operator: '>=', value: '0.1' });
  });
});

describe('M59 filter-model — removeChip', () => {
  it('clears exactly the targeted filter, leaving the rest intact', () => {
    const next = removeChip(active, 'status');
    expect(next.status).toBe('all'); // removed
    expect(next.q).toBe('checkout'); // untouched
    expect(next.costMin).toBe('0.1'); // untouched
    // exactly one field changed.
    expect(filtersToChips(next)).toHaveLength(filtersToChips(active).length - 1);
  });

  it('returns filters unchanged for an unknown chip id', () => {
    expect(removeChip(active, 'nope')).toEqual(active);
  });
});

describe('M59 filter-model — round-trip identity (R4)', () => {
  it('paramsToFilters(chips.map(chipToParam)) deep-equals the original filters', () => {
    const chips = filtersToChips(active);
    const params = new URLSearchParams(chips.map(chipToParam));
    expect(paramsToFilters(params)).toEqual(active);
  });

  it('paramsToFilters ignores an unknown/legacy param without throwing', () => {
    const params = new URLSearchParams([
      ['status', 'error'],
      ['legacy_unknown', 'x'],
    ]);
    const f = paramsToFilters(params);
    expect(f.status).toBe('error');
    expect(f).toEqual({ ...EMPTY_FILTERS, status: 'error' });
  });
});

describe('M92 filter-model — attribute filter (span_query DSL clause)', () => {
  it('applyFilter wraps a key=value into an attr: DSL clause', () => {
    expect(applyFilter('attr', 'tier=gold')).toEqual({ spanQuery: 'attr:tier=gold' });
    // idempotent — an already-prefixed value is not double-wrapped
    expect(applyFilter('attr', 'attr:tier=gold')).toEqual({ spanQuery: 'attr:tier=gold' });
  });

  it('renders one chip whose displayed value drops the attr: prefix', () => {
    const f = { ...EMPTY_FILTERS, spanQuery: 'attr:tier=gold' };
    const chips = filtersToChips(f);
    const attrChip = chips.find((c) => c.id === 'attr');
    expect(attrChip).toEqual({ id: 'attr', column: 'attribute', operator: 'is', value: 'attr:tier=gold' });
    expect(displayChipValue(attrChip!)).toBe('tier=gold'); // human-facing form
  });

  it('round-trips through the span_query URL param (chip → param → filters)', () => {
    const f = { ...EMPTY_FILTERS, spanQuery: 'attr:gen_ai.request.temperature=0.7' };
    const chips = filtersToChips(f);
    const params = new URLSearchParams(chips.map(chipToParam));
    expect(params.get('span_query')).toBe('attr:gen_ai.request.temperature=0.7'); // FULL clause in the URL
    expect(paramsToFilters(params)).toEqual(f);
  });

  it('removeChip clears the attribute filter', () => {
    const f = { ...EMPTY_FILTERS, spanQuery: 'attr:tier=gold' };
    expect(removeChip(f, 'attr').spanQuery).toBe('');
  });
});
