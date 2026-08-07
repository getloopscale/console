import type { TraceSpanNode } from '@/pages/lens/trace-layout';

/**
 * M61 P0 — pure Ask-copilot thread helpers (dependency-free leaf; ADR D2/D4). No React, no I/O. The
 * copilot thread lives client-side (the M33 endpoint is single-turn + stateless — ADR D1); this module
 * supplies the starter prompts, the `spanId → name` entity map (built once over the fetched trace tree),
 * and the citation resolver that turns an answer string into renderable segments. Span-citations are
 * HONEST: only an id present in the entity map becomes a linked span — an unknown `[span:<id>]` marker
 * is left as plain text, never fabricated (R3).
 */

/** A rendered turn's answer split into plain-text and span-link segments (the `resolveCitations` output). */
type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'span'; spanId: string; name: string };

/** One conversation turn. `spanId` grounds the turn on a span (the M33 `spanId?` param); `feedback` is a thumbs toggle. */
export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  spanId?: string;
  feedback?: 'up' | 'down';
}

/** The four canned starter prompts (Opik `TraceAIViewer`). */
export const STARTER_PROMPTS = [
  'Give me a summary of this trace',
  'What went wrong or looks suspicious here?',
  'Where did errors or unexpected behavior occur?',
  'How can I reduce costs?',
] as const;

/** Walk the fetched span tree into a `spanId → name` map (for span-citation link-back). Total; never throws. */
export function buildEntityMap(root: TraceSpanNode): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (node: TraceSpanNode) => {
    map.set(node.spanId, node.name);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return map;
}

const SPAN_MARKER = /\[span:([^\]]+)\]/g;

/**
 * Split an answer into text / span-link segments. A `[span:<id>]` marker whose id is in `entityMap`
 * becomes a `span` segment linking the span name; an unknown id is left as literal text (no fabrication
 * — R3). An answer with no marker → a single text segment. Total; never throws.
 */
export function resolveCitations(answer: string, entityMap: Map<string, string>): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of answer.matchAll(SPAN_MARKER)) {
    const [marker, id] = match;
    const start = match.index;
    const name = entityMap.get(id);
    if (name === undefined) continue; // unknown id → leave the marker inside the surrounding text
    if (start > lastIndex) segments.push({ kind: 'text', text: answer.slice(lastIndex, start) });
    segments.push({ kind: 'span', spanId: id, name });
    lastIndex = start + marker.length;
  }
  if (lastIndex < answer.length || segments.length === 0) {
    segments.push({ kind: 'text', text: answer.slice(lastIndex) });
  }
  return segments;
}
