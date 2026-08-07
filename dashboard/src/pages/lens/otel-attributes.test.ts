import { describe, it, expect } from 'vitest';

import { groupByNamespace, promotedBadges, detectPii } from './otel-attributes';

describe('groupByNamespace — split each key on the first dot, dot-less → "other"', () => {
  it('groups gen_ai.*/http.* by prefix and puts dot-less keys in "other"', () => {
    const groups = groupByNamespace({ 'gen_ai.model': 'x', 'http.status': 200, foo: 1 });
    const names = groups.map((g) => g.namespace);
    expect(names).toContain('gen_ai');
    expect(names).toContain('http');
    expect(names).toContain('other');
    const genAi = groups.find((g) => g.namespace === 'gen_ai');
    expect(genAi?.entries).toEqual([['gen_ai.model', 'x']]);
    const other = groups.find((g) => g.namespace === 'other');
    expect(other?.entries).toEqual([['foo', 1]]);
  });

  it('returns [] for {} without throwing', () => {
    expect(groupByNamespace({})).toEqual([]);
  });

  it('sorts namespaces stably (alphabetical, "other" last)', () => {
    const groups = groupByNamespace({ 'http.a': 1, 'gen_ai.b': 2, zed: 3, 'llm.c': 4 });
    expect(groups.map((g) => g.namespace)).toEqual(['gen_ai', 'http', 'llm', 'other']);
  });

  it('splits only on the FIRST dot (keeps nested suffix intact)', () => {
    const groups = groupByNamespace({ 'gen_ai.usage.input_tokens': 501 });
    expect(groups).toEqual([
      { namespace: 'gen_ai', entries: [['gen_ai.usage.input_tokens', 501]] },
    ]);
  });

  it('groups multiple keys under the same namespace, preserving order', () => {
    const groups = groupByNamespace({ 'http.method': 'GET', 'http.status': 200 });
    const http = groups.find((g) => g.namespace === 'http');
    expect(http?.entries).toEqual([
      ['http.method', 'GET'],
      ['http.status', 200],
    ]);
  });
});

describe('promotedBadges — extract model/tokens/cost/level allow-list, omit when absent', () => {
  it('extracts model from gen_ai.request.model', () => {
    const badges = promotedBadges({ 'gen_ai.request.model': 'claude-haiku-4-5' });
    expect(badges).toContainEqual({ label: 'model', value: 'claude-haiku-4-5' });
  });

  it('combines input+output tokens as in→out via formatTokens', () => {
    const badges = promotedBadges({
      'gen_ai.usage.input_tokens': 1501,
      'gen_ai.usage.output_tokens': 13,
    });
    expect(badges).toContainEqual({ label: 'tokens', value: '1,501→13' });
  });

  it('extracts cost from a *cost* key via formatCost', () => {
    const badges = promotedBadges({ 'gen_ai.usage.cost': 0.0072 });
    expect(badges).toContainEqual({ label: 'cost', value: '$0.0072' });
  });

  it('extracts level/status', () => {
    const badges = promotedBadges({ level: 'error' });
    expect(badges).toContainEqual({ label: 'level', value: 'error' });
  });

  it('extracts all four when present', () => {
    const badges = promotedBadges({
      'llm.model': 'gpt-4',
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.usage.output_tokens': 5,
      'gen_ai.usage.cost': 0.5,
      'gen_ai.response.status': 'ok',
    });
    expect(badges.map((b) => b.label).sort()).toEqual(['cost', 'level', 'model', 'tokens']);
  });

  it('omits absent keys (empty attrs → [])', () => {
    expect(promotedBadges({})).toEqual([]);
    expect(promotedBadges({ foo: 1 })).toEqual([]);
  });
});

describe('detectPii — conservative, err toward masking; non-string → false', () => {
  it('flags an email address', () => {
    expect(detectPii('a@b.com')).toBe(true);
    expect(detectPii('user@example.com')).toBe(true);
    expect(detectPii('  contact me at jane.doe@corp.co.uk please ')).toBe(true);
  });

  it('does not flag a plain non-PII string', () => {
    expect(detectPii('plain')).toBe(false);
    expect(detectPii('end_turn')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(detectPii(42)).toBe(false);
    expect(detectPii(null)).toBe(false);
    expect(detectPii(undefined)).toBe(false);
    expect(detectPii({ a: 1 })).toBe(false);
  });

  it('flags an obvious bearer-token shape (extensible set)', () => {
    expect(detectPii('Bearer sk-abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
  });
});
