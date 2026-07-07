import { describe, it, expect } from 'vitest';

import { newVariant, updateVariant, runKey, isStale, type EditableMessage } from './variant-model';

const seed: EditableMessage[] = [{ role: 'user', content: 'hello' }];

describe('M62 variant-model', () => {
  it('test_newVariant_clones_baseline_messages_not_by_reference', () => {
    // Editing a variant must NEVER mutate the baseline the variant was seeded from (M44 read-only).
    const v = newVariant(seed);
    expect(v.messages).toEqual(seed);
    expect(v.messages).not.toBe(seed); // array copy
    expect(v.messages[0]).not.toBe(seed[0]); // element copy
    v.messages[0].content = 'edited';
    expect(seed[0].content).toBe('hello'); // baseline untouched
  });

  it('test_newVariant_gives_each_variant_a_unique_id', () => {
    expect(newVariant(seed).id).not.toBe(newVariant(seed).id);
  });

  it('test_runKey_changes_when_editable_input_changes', () => {
    const v = newVariant(seed, 'gpt-x');
    const k0 = runKey(v);
    expect(runKey(newVariant(seed, 'gpt-x'))).toBe(k0); // same editable inputs → same key (id-agnostic)
    expect(runKey(updateVariant(v, { model: 'gpt-y' }))).not.toBe(k0); // model edit → new key
    expect(runKey(updateVariant(v, { messages: [{ role: 'user', content: 'changed' }] }))).not.toBe(k0);
    expect(runKey(updateVariant(v, { responseSchema: '{"type":"object"}' }))).not.toBe(k0); // schema edit → new key
  });

  it('test_isStale_true_when_runKey_diverges_from_last_run', () => {
    const v = newVariant(seed, 'gpt-x');
    expect(isStale(v)).toBe(false); // never run → not stale (no output to grey)
    const ran = updateVariant(v, { lastRunKey: runKey(v) });
    expect(isStale(ran)).toBe(false); // just ran → not stale
    const edited = updateVariant(ran, { model: 'gpt-y' });
    expect(isStale(edited)).toBe(true); // edited after the run → stale
  });

  it('test_updateVariant_deep_copies_patched_messages', () => {
    const v = newVariant(seed);
    const nextMsgs: EditableMessage[] = [{ role: 'system', content: 's' }];
    const u = updateVariant(v, { messages: nextMsgs });
    expect(u.messages).toEqual(nextMsgs);
    expect(u.messages).not.toBe(nextMsgs);
    expect(v.messages).toEqual(seed); // original variant unchanged (immutable update)
  });
});
