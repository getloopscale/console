/**
 * M62 P1 — pure variant state model for the side-by-side playground (dependency-free leaf; ADR D3).
 * No React, no I/O. A `Variant` is one editable playground column (its messages + model override +
 * optional structured-output schema) plus the `runKey` captured at its last run. Staleness is the
 * only non-trivial logic — isolating it here (Top-risk-2 mitigation) makes the fragile N-column state
 * unit-testable without React. `newVariant`/`updateVariant` DEEP-COPY messages so editing a variant
 * never mutates the baseline it was seeded from (the M44 read-only invariant, proven in the leaf).
 */

export interface EditableMessage {
  role: string;
  content: string;
}

export interface Variant {
  id: string;
  messages: EditableMessage[];
  /** Optional model override ('' = provider default). */
  model: string;
  /** Optional structured-output JSON schema as raw text ('' = none). */
  responseSchema: string;
  /** `runKey` at the moment of the last successful run — undefined until the variant is run. */
  lastRunKey?: string;
}

let seq = 0;

/** A copy of the message list with per-element clones (never shares references with the seed). */
function cloneMessages(messages: EditableMessage[]): EditableMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** Build a fresh variant seeded from a message list. The messages are DEEP-COPIED so subsequent edits
 *  never mutate the seed (the baseline). `seq` gives a deterministic-per-session unique id. */
export function newVariant(seedMessages: EditableMessage[], model = ''): Variant {
  return {
    id: `variant-${++seq}`,
    messages: cloneMessages(seedMessages),
    model,
    responseSchema: '',
  };
}

/** Immutable update: returns a new variant with the patch applied (patched messages are deep-copied). */
export function updateVariant(v: Variant, patch: Partial<Omit<Variant, 'id'>>): Variant {
  return {
    ...v,
    ...patch,
    messages: patch.messages ? cloneMessages(patch.messages) : v.messages,
  };
}

/** A stable, id-agnostic key over a variant's EDITABLE inputs — two variants with identical messages +
 *  model + schema share a key (so a run can be detected stale after any edit). */
export function runKey(v: Variant): string {
  return JSON.stringify({ messages: v.messages, model: v.model.trim(), schema: v.responseSchema.trim() });
}

/** A variant is stale when it was run before AND its editable inputs changed since (its output should
 *  be greyed until re-run). A never-run variant is not stale (there is no output to grey). */
export function isStale(v: Variant): boolean {
  return v.lastRunKey !== undefined && v.lastRunKey !== runKey(v);
}
