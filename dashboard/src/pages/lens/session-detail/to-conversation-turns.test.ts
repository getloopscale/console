import { describe, it, expect } from 'vitest';
import type { TraceSpanNode } from '@/pages/lens/trace-layout';
import { sortSessionTracesByStart, toConversationTurns, type SessionTraceRef } from './to-conversation-turns';

function node(o: Partial<TraceSpanNode> & { spanId: string }): TraceSpanNode {
  return { startTimeUnixNano: '100', endTimeUnixNano: '200', ...o } as TraceSpanNode;
}
const ref = (traceId: string, startTimeUnixNano: string, name?: string): SessionTraceRef => ({
  traceId,
  startTimeUnixNano,
  ...(name != null ? { name } : {}),
});

describe('toConversationTurns (M132 T1)', () => {
  it('extracts one Human→AI turn per trace, ordered by trace start (not input order)', () => {
    const traces = [ref('t2', '200', 'second'), ref('t1', '100', 'first')];
    const trees = new Map<string, TraceSpanNode | null>([
      ['t1', node({ spanId: 's1', inputValue: 'first Q', outputValue: 'first A' })],
      ['t2', node({ spanId: 's2', inputValue: 'second Q', outputValue: 'second A' })],
    ]);
    const turns = toConversationTurns(traces, trees);
    expect(turns.map((t) => t.traceId)).toEqual(['t1', 't2']); // ordered by start
    expect(turns[0]).toMatchObject({ index: 1, input: 'first Q', output: 'first A' });
    expect(turns[1]).toMatchObject({ index: 2, input: 'second Q', output: 'second A' });
  });

  it('is producer-agnostic: root has no I/O, a child carries it (Claude Code shape)', () => {
    const tree = node({
      spanId: 'root',
      name: 'claude_code.llm_request', // root carries NO input/output
      children: [node({ spanId: 'tool', startTimeUnixNano: '110', inputValue: 'the command', outputValue: 'the result' })],
    });
    const turns = toConversationTurns([ref('t1', '100')], new Map([['t1', tree]]));
    expect(turns[0].input).toBe('the command'); // walked into the child, not assumed on root
    expect(turns[0].output).toBe('the result');
  });

  it('picks the earliest input + the latest output across spans', () => {
    const tree = node({
      spanId: 'root',
      startTimeUnixNano: '100',
      inputValue: 'ROOT-IN',
      children: [
        node({ spanId: 'mid', startTimeUnixNano: '150', outputValue: 'MID-OUT' }),
        node({ spanId: 'late', startTimeUnixNano: '190', outputValue: 'FINAL-OUT' }),
      ],
    });
    const turns = toConversationTurns([ref('t1', '100')], new Map([['t1', tree]]));
    expect(turns[0].input).toBe('ROOT-IN'); // earliest non-empty input
    expect(turns[0].output).toBe('FINAL-OUT'); // latest non-empty output
  });

  it('absent I/O → undefined, never a throw (empty spans OR a failed/null tree)', () => {
    const turns = toConversationTurns([ref('t1', '100'), ref('t2', '200')], new Map([
      ['t1', node({ spanId: 's1' })], // spans with no input/output
      ['t2', null], // tree failed to load
    ]));
    expect(turns[0].input).toBeUndefined();
    expect(turns[0].output).toBeUndefined();
    expect(turns[1].input).toBeUndefined();
    expect(turns[1].loadFailed).toBe(true); // a null tree is flagged as a failed load (distinct from empty)
    expect(turns).toHaveLength(2);
  });

  it('sortSessionTracesByStart orders newest-first input into conversation order (review HIGH — cap-before-sort)', () => {
    // the session read is newest-first; sorting BEFORE the cap keeps the EARLIEST turns, not the latest.
    const newestFirst = [ref('t3', '300'), ref('t1', '100'), ref('t2', '200')];
    const ordered = sortSessionTracesByStart(newestFirst);
    expect(ordered.map((t) => t.traceId)).toEqual(['t1', 't2', 't3']); // earliest → latest
    // taking the first N of the SORTED list keeps the conversation's start (t1), not the newest (t3).
    expect(ordered.slice(0, 2).map((t) => t.traceId)).toEqual(['t1', 't2']);
  });

  it('whitespace-only I/O is treated as absent (never a blank card)', () => {
    const turns = toConversationTurns([ref('t1', '100')], new Map([
      ['t1', node({ spanId: 's1', inputValue: '   ', outputValue: '' })],
    ]));
    expect(turns[0].input).toBeUndefined();
    expect(turns[0].output).toBeUndefined();
  });
});
