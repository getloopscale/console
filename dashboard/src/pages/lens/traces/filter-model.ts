/**
 * M59 P2 T2.1 — the pure chip⇄URL filter model (ADR D1/D2). The traces list's active filters are
 * modeled as a list of removable **chips** (column → operator → value); this module maps `TraceFilters`
 * to chips and back to the EXACT existing `nuqs` URL param keys (`q`/`status`/`model`/`range`/
 * `cost_min`/`cost_max`/`tokens_min`/`tokens_max`/`session`) — so `buildTraceQuery` and the M49 BFF
 * whitelist are untouched (no BFF change). Pure + total + round-trip-safe (R4). No I/O, no React.
 */

export const RANGE_VALUES = ['all', '1h', '24h', '7d'] as const;
export type Range = (typeof RANGE_VALUES)[number];

export interface TraceFilters {
  q: string;
  status: 'all' | 'error';
  model: string;
  range: Range;
  costMin: string;
  costMax: string;
  tokensMin: string;
  tokensMax: string;
  session: string;
  /** M92 — the span-query DSL clause for an arbitrary attribute filter, e.g. `attr:tier=gold`. */
  spanQuery: string;
}

export const EMPTY_FILTERS: TraceFilters = {
  q: '',
  status: 'all',
  model: '',
  range: 'all',
  costMin: '',
  costMax: '',
  tokensMin: '',
  tokensMax: '',
  session: '',
  spanQuery: '',
};

/** One applied filter, rendered as a removable `Badge` chip in the filter bar. */
export interface Chip {
  id: string;
  column: string;
  operator: string;
  value: string;
}

/**
 * The single source of truth for the filter⇄param⇄chip mapping. Each spec knows: its stable chip id,
 * the `nuqs` URL param key it round-trips through, its display column/operator, how to read its active
 * value from `TraceFilters` (`''` = inactive), how to apply a value, and how to clear it. Declarative
 * so `filtersToChips`/`removeChip`/`chipToParam`/`paramsToFilters` stay DRY and provably consistent.
 */
interface FilterSpec {
  id: string;
  param: string;
  column: string;
  operator: string;
  read: (f: TraceFilters) => string;
  apply: (value: string) => Partial<TraceFilters>;
  cleared: Partial<TraceFilters>;
  fromParam: (value: string) => Partial<TraceFilters>;
}

const SPECS: FilterSpec[] = [
  {
    id: 'q',
    param: 'q',
    column: 'search',
    operator: 'contains',
    read: (f) => f.q.trim(),
    apply: (v) => ({ q: v }),
    cleared: { q: '' },
    fromParam: (v) => ({ q: v }),
  },
  {
    id: 'status',
    param: 'status',
    column: 'status',
    operator: 'is',
    read: (f) => (f.status === 'error' ? 'error' : ''),
    apply: () => ({ status: 'error' }),
    cleared: { status: 'all' },
    fromParam: (v) => (v === 'error' ? { status: 'error' } : {}),
  },
  {
    id: 'model',
    param: 'model',
    column: 'model',
    operator: 'is',
    read: (f) => f.model.trim(),
    apply: (v) => ({ model: v }),
    cleared: { model: '' },
    fromParam: (v) => ({ model: v }),
  },
  {
    id: 'range',
    param: 'range',
    column: 'time',
    operator: 'within',
    read: (f) => (f.range !== 'all' ? f.range : ''),
    apply: (v) => ({ range: (RANGE_VALUES as readonly string[]).includes(v) ? (v as Range) : 'all' }),
    cleared: { range: 'all' },
    fromParam: (v) => ((RANGE_VALUES as readonly string[]).includes(v) ? { range: v as Range } : {}),
  },
  {
    id: 'costMin',
    param: 'cost_min',
    column: 'cost',
    operator: '>=',
    read: (f) => f.costMin.trim(),
    apply: (v) => ({ costMin: v }),
    cleared: { costMin: '' },
    fromParam: (v) => ({ costMin: v }),
  },
  {
    id: 'costMax',
    param: 'cost_max',
    column: 'cost',
    operator: '<=',
    read: (f) => f.costMax.trim(),
    apply: (v) => ({ costMax: v }),
    cleared: { costMax: '' },
    fromParam: (v) => ({ costMax: v }),
  },
  {
    id: 'tokensMin',
    param: 'tokens_min',
    column: 'tokens',
    operator: '>=',
    read: (f) => f.tokensMin.trim(),
    apply: (v) => ({ tokensMin: v }),
    cleared: { tokensMin: '' },
    fromParam: (v) => ({ tokensMin: v }),
  },
  {
    id: 'tokensMax',
    param: 'tokens_max',
    column: 'tokens',
    operator: '<=',
    read: (f) => f.tokensMax.trim(),
    apply: (v) => ({ tokensMax: v }),
    cleared: { tokensMax: '' },
    fromParam: (v) => ({ tokensMax: v }),
  },
  {
    id: 'session',
    param: 'session',
    column: 'session',
    operator: 'is',
    read: (f) => f.session.trim(),
    apply: (v) => ({ session: v }),
    cleared: { session: '' },
    fromParam: (v) => ({ session: v }),
  },
  {
    // M92 — an arbitrary attribute filter. The value IS the full `attr:key=value` DSL clause,
    // round-tripped through the `span_query` URL param (chip/param/fetch all carry the same string).
    id: 'attr',
    param: 'span_query',
    column: 'attribute',
    operator: 'is',
    read: (f) => f.spanQuery.trim(),
    apply: (v) => ({ spanQuery: v.startsWith('attr:') ? v : `attr:${v}` }),
    cleared: { spanQuery: '' },
    fromParam: (v) => ({ spanQuery: v }),
  },
];

/** M92 — the human-facing form of an `attr:key=value` chip value (drop the DSL prefix for display). */
export function displayChipValue(chip: Chip): string {
  return chip.id === 'attr' ? chip.value.replace(/^attr:/, '') : chip.value;
}

const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]));

/** The columns a user can add a filter for (for the Add-filter menu). */
export function filterColumns(): { id: string; column: string; operator: string }[] {
  return SPECS.map((s) => ({ id: s.id, column: s.column, operator: s.operator }));
}

/** Apply a value to a filter column by its chip id — returns the partial to merge into filters. */
export function applyFilter(id: string, value: string): Partial<TraceFilters> {
  return SPEC_BY_ID.get(id)?.apply(value) ?? {};
}

/** One chip per ACTIVE filter (empty/`all` values omitted). Total; `[]` when nothing is active. */
export function filtersToChips(f: TraceFilters): Chip[] {
  const chips: Chip[] = [];
  for (const s of SPECS) {
    const value = s.read(f);
    if (value !== '') chips.push({ id: s.id, column: s.column, operator: s.operator, value });
  }
  return chips;
}

/** Clear exactly the targeted filter, leaving the rest intact. Unknown id → filters unchanged. */
export function removeChip(f: TraceFilters, chipId: string): TraceFilters {
  const spec = SPEC_BY_ID.get(chipId);
  return spec ? { ...f, ...spec.cleared } : f;
}

/** The partial that clears one filter (for the chip's × → merge into filters). Unknown id → `{}`. */
export function clearFilter(chipId: string): Partial<TraceFilters> {
  return SPEC_BY_ID.get(chipId)?.cleared ?? {};
}

/** Whether a column takes an enum value (needs a `Select`) vs a free-text/number `Input`. */
export function columnValueOptions(id: string): readonly string[] | null {
  if (id === 'status') return ['error'];
  if (id === 'range') return RANGE_VALUES.filter((r) => r !== 'all');
  return null;
}

/** The `[paramKey, value]` a chip round-trips through (the existing nuqs param — no new key). */
export function chipToParam(chip: Chip): [string, string] {
  const spec = SPEC_BY_ID.get(chip.id);
  return [spec?.param ?? chip.id, chip.value];
}

/** Reconstruct `TraceFilters` from URL params — unknown/legacy params are ignored (never thrown). */
export function paramsToFilters(params: URLSearchParams): TraceFilters {
  let f: TraceFilters = { ...EMPTY_FILTERS };
  for (const s of SPECS) {
    const raw = params.get(s.param);
    if (raw != null && raw !== '') f = { ...f, ...s.fromParam(raw) };
  }
  return f;
}
