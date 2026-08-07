import { describe, it, expect } from 'vitest';

import { STARTER_PROMPTS, buildEntityMap, resolveCitations } from './ask-thread-model';
import type { TraceSpanNode } from '@/pages/lens/components/trace-layout';

/**
 * M61 P0 T0.1 — the pure thread helpers. `buildEntityMap` flattens the fetched span tree to
 * `spanId → name`; `resolveCitations` splits an answer into text/span segments — the load-bearing
 * invariant (R3) is that an id NOT in the entity map is left as plain text, never a fabricated citation.
 */

const node = (spanId: string, name: string, children?: TraceSpanNode[]): TraceSpanNode =>
  ({ spanId, traceId: 't1', name, children }) as TraceSpanNode;

describe('M61 buildEntityMap', () => {
  it('maps a single node (no children, no throw)', () => {
    const m = buildEntityMap(node('s1', 'root'));
    expect(m.size).toBe(1);
    expect(m.get('s1')).toBe('root');
  });

  it('maps every node of a nested tree', () => {
    const tree = node('s1', 'root', [node('s2', 'llm'), node('s3', 'tool', [node('s4', 'fetch')])]);
    const m = buildEntityMap(tree);
    expect(m.size).toBe(4);
    expect(m.get('s2')).toBe('llm');
    expect(m.get('s4')).toBe('fetch');
  });
});

describe('M61 resolveCitations', () => {
  it('splits a known [span:id] ref into text / span / text', () => {
    const segs = resolveCitations('see [span:s2] here', new Map([['s2', 'llm']]));
    expect(segs).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'span', spanId: 's2', name: 'llm' },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('resolves a known ref to a span segment', () => {
    expect(resolveCitations('x [span:s2]', new Map([['s2', 'llm']]))).toContainEqual({
      kind: 'span',
      spanId: 's2',
      name: 'llm',
    });
  });

  it('leaves an UNKNOWN ref as plain text (no fabrication — R3)', () => {
    const segs = resolveCitations('x [span:zzz] y', new Map());
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
    expect(segs.map((s) => (s.kind === 'text' ? s.text : '')).join('')).toBe('x [span:zzz] y');
  });

  it('returns one text segment for a plain answer', () => {
    expect(resolveCitations('plain answer', new Map([['s2', 'llm']]))).toEqual([
      { kind: 'text', text: 'plain answer' },
    ]);
  });
});

describe('M61 STARTER_PROMPTS', () => {
  it('has exactly four non-empty prompts', () => {
    expect(STARTER_PROMPTS).toHaveLength(4);
    expect(STARTER_PROMPTS.every((p) => p.trim().length > 0)).toBe(true);
  });
});
