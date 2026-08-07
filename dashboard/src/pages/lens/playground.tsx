import { useMemo, useRef, useState } from 'react';
import { GitCompareArrows, Play, Plus } from 'lucide-react';
import { Badge, Button } from '@usetheo/ui';

import type { TraceSpanNode } from '@/components/lens/trace-layout';
import { asChat } from './trace-detail/helpers';
import { TracePeekSheet } from './traces/peek-sheet';
import { BaselineColumn } from './playground/baseline-column';
import { VariantColumn, type VariantColumnHandle } from './playground/variant-column';
import { newVariant, type EditableMessage, type Variant } from './playground/variant-model';

/**
 * M62 — the side-by-side playground. From an LLM span, compare N editable variants (model / prompt)
 * next to the read-only original, each re-run against the real provider server-side (M55 path). The
 * SOTA default (Langfuse n-window / Opik 6 / Phoenix ≤4): a horizontal scroll row of state-isolated
 * columns (ADR D3), a **Run-all** that fans out one replay per variant (bounded by the variant cap +
 * the server per-workspace rate-limit — Top-risk-1), and a **View Trace** action that opens the
 * original span's detail in a Sheet (reuses M58 — ADR D4). The replay is ephemeral: it never mutates
 * the trace (M44); the only persist path is the per-variant opt-in save-as-dataset.
 */

const VARIANT_CAP = 4;
const ROLES = ['system', 'user', 'assistant'];

/** Prefill editable messages from the span's recorded input (a non-chat input → one user message). */
function initialMessages(span: TraceSpanNode): EditableMessage[] {
  const parsed = span.inputValue ? asChat(span.inputValue) : null;
  if (parsed && parsed.length > 0) {
    return parsed.map((m) => ({
      role: ROLES.includes(String(m.role)) ? String(m.role) : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }
  return [{ role: 'user', content: span.inputValue ?? '' }];
}

export function LensPlayground({ span }: { span: TraceSpanNode }) {
  const seed = useMemo(() => initialMessages(span), [span]);
  const [variants, setVariants] = useState<Variant[]>(() => [newVariant(seed, span.model ?? '')]);
  const [viewTrace, setViewTrace] = useState(false);
  const refs = useRef(new Map<string, VariantColumnHandle>());

  const setVariant = (v: Variant) => setVariants((prev) => prev.map((x) => (x.id === v.id ? v : x)));
  // Mark a completed run's key on the LATEST variant (functional — preserves any mid-flight edit, so a
  // run resolving after an edit correctly leaves the output stale instead of clobbering the new inputs).
  const markRan = (id: string, ranKey: string) =>
    setVariants((prev) => prev.map((x) => (x.id === id ? { ...x, lastRunKey: ranKey } : x)));
  const addVariant = () =>
    setVariants((prev) => (prev.length >= VARIANT_CAP ? prev : [...prev, newVariant(seed, span.model ?? '')]));
  const removeVariant = (id: string) => {
    refs.current.delete(id);
    setVariants((prev) => prev.filter((x) => x.id !== id));
  };
  const runAll = () => variants.forEach((v) => refs.current.get(v.id)?.run());

  return (
    <div className="mt-3 space-y-3" data-testid="playground">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Playground · compare</h3>
          <span className="text-xs text-muted-foreground">A new run — the original trace is unchanged.</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={runAll} disabled={variants.length === 0}>
            <Play className="mr-1 h-4 w-4" /> Run all
          </Button>
          <Button variant="secondary" size="sm" onClick={addVariant} disabled={variants.length >= VARIANT_CAP}>
            <Plus className="mr-1 h-4 w-4" /> Add variant
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setViewTrace(true)}>
            <GitCompareArrows className="mr-1 h-4 w-4" /> View Trace
          </Button>
          <Badge variant="outline" className="text-xs">
            {variants.length}/{VARIANT_CAP}
          </Badge>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2" data-testid="variant-row">
        <BaselineColumn span={span} />
        {variants.map((v) => (
          <VariantColumn
            key={v.id}
            ref={(h) => {
              if (h) refs.current.set(v.id, h);
              else refs.current.delete(v.id);
            }}
            variant={v}
            span={span}
            onChange={setVariant}
            onRan={(ranKey) => markRan(v.id, ranKey)}
            onRemove={() => removeVariant(v.id)}
            canRemove={variants.length > 1}
          />
        ))}
      </div>

      {/* View Trace — the original span's detail in a Sheet (M58 reuse); the playground stays mounted. */}
      <TracePeekSheet traceId={viewTrace ? span.traceId : null} onClose={() => setViewTrace(false)} />
    </div>
  );
}
