// M58 P2.1 — pure OTel attribute grouping + promoted-badge extraction + conservative PII detection.
//
// The superiority surface of the trace-detail reader mode (ADR D4, blueprint §4): no peer groups a
// span's attributes by OTel namespace, and none does display-time PII masking. This module is the
// PURE, TOTAL core so the grouping / badge / PII logic is unit-testable independent of any render.
//
// All three functions are total: empty input never throws, unknown shapes degrade to a safe default.
// `detectPii` is deliberately CONSERVATIVE — a false negative leaks a raw value into the DOM, so the
// detector errs toward masking (matches → true). Non-string values are never PII.

import { formatCost, formatTokens } from './format';

export interface NamespaceGroup {
  namespace: string;
  entries: [string, unknown][];
}

export interface PromotedBadge {
  label: string;
  value: string;
}

const OTHER = 'other';

/**
 * Group a span's attributes by OTel namespace — the prefix before the FIRST `.`. Keys without a dot
 * fall into an `other` bucket. Namespaces are sorted alphabetically with `other` pinned last; within a
 * namespace the original key order is preserved. `{}` → `[]` (no throw).
 *
 *   groupByNamespace({ 'gen_ai.model': 'x', 'http.status': 200, foo: 1 })
 *     → [ { namespace: 'gen_ai', entries: [['gen_ai.model','x']] },
 *         { namespace: 'http',   entries: [['http.status',200]] },
 *         { namespace: 'other',  entries: [['foo',1]] } ]
 */
export function groupByNamespace(attrs: Record<string, unknown>): NamespaceGroup[] {
  const buckets = new Map<string, [string, unknown][]>();
  for (const key of Object.keys(attrs)) {
    const dot = key.indexOf('.');
    const namespace = dot > 0 ? key.slice(0, dot) : OTHER;
    const entries = buckets.get(namespace) ?? [];
    entries.push([key, attrs[key]]);
    buckets.set(namespace, entries);
  }
  return [...buckets.entries()]
    .map(([namespace, entries]) => ({ namespace, entries }))
    .sort((a, b) => {
      if (a.namespace === OTHER) return 1;
      if (b.namespace === OTHER) return -1;
      return a.namespace.localeCompare(b.namespace);
    });
}

// Allow-lists checked in order — the first present key wins for each promoted badge. These are the
// real Claude-Code / OTel GenAI semantic-convention wire keys already used across the repo
// (`gen_ai.usage.cost` in trace-layout.ts, `gen_ai.request.attempt` in the fixtures).
const MODEL_KEYS = ['gen_ai.request.model', 'llm.model', 'gen_ai.response.model'];
const INPUT_TOKEN_KEYS = ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens'];
const OUTPUT_TOKEN_KEYS = ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens'];
const COST_KEYS = ['gen_ai.usage.cost', 'gen_ai.usage.cost_usd', 'cost_usd', 'cost'];
const LEVEL_KEYS = ['level', 'gen_ai.response.status', 'status', 'log.level'];

function firstPresent(attrs: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (key in attrs) return attrs[key];
  return undefined;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the small promoted-badge subset (model / tokens / cost / level) from a span's attributes.
 * Absent keys are omitted. Tokens combine as `in→out` when either side is present (reusing
 * `formatTokens`); cost renders via `formatCost`. Total — `{}` → `[]`.
 */
export function promotedBadges(attrs: Record<string, unknown>): PromotedBadge[] {
  const badges: PromotedBadge[] = [];

  const model = firstPresent(attrs, MODEL_KEYS);
  if (model !== undefined && model !== null) badges.push({ label: 'model', value: String(model) });

  const input = asNumber(firstPresent(attrs, INPUT_TOKEN_KEYS));
  const output = asNumber(firstPresent(attrs, OUTPUT_TOKEN_KEYS));
  if (input !== null || output !== null) {
    badges.push({ label: 'tokens', value: `${formatTokens(input ?? 0)}→${formatTokens(output ?? 0)}` });
  }

  const cost = asNumber(firstPresent(attrs, COST_KEYS));
  if (cost !== null) badges.push({ label: 'cost', value: formatCost(cost) });

  const level = firstPresent(attrs, LEVEL_KEYS);
  if (level !== undefined && level !== null) badges.push({ label: 'level', value: String(level) });

  return badges;
}

// Conservative PII pattern set — email is the required signal; the bearer-token / long-secret shape is
// an obvious extension. The set is deliberately narrow to avoid false positives on ordinary values,
// but any match masks (err toward masking — a leak is worse than an over-mask, which Reveal recovers).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const BEARER = /\b(?:Bearer\s+)?(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9-_]{20,}/;
const PII_PATTERNS = [EMAIL, BEARER];

/**
 * Conservative PII detector — true when a string value matches any known PII pattern (email required;
 * bearer/secret-token shape included). Non-string values are never PII (`false`). Total — never throws.
 */
export function detectPii(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return PII_PATTERNS.some((re) => re.test(value));
}
