import { lensErrorMessage } from '@/pages/lens/lens-error';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Braces, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Input, Select, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { cloudFetch } from '@/lib/api';
import { formatCost, formatDuration, formatTokens } from '@/lib/format';
import type { TraceSpanNode } from '@/components/lens/trace-layout';
import { type EditableMessage, isStale, runKey, updateVariant, type Variant } from './variant-model';

/**
 * M62 P2 — one editable variant column, reused N times with ISOLATED state (ADR D3). It owns its own
 * replay mutation over the M55 provider path (`retry:false` — a billable call is never auto-retried;
 * fail-closed to a typed Alert on 502/503/429/404, never a fabricated output). The output card shows
 * `{provider·model, latency, tokens, cost}` via the M57 formatters (cost is the real provider `costUsd`
 * or an em-dash — never `$0`); it GREYS when the editable inputs changed since the last run (stale).
 * The output is plain text (XSS-safe — no `dangerouslySetInnerHTML`). An optional structured-output
 * JSON schema is validated client-side (invalid → Run disabled) and forwarded to the server. The only
 * persist path is the opt-in save-as-dataset (reuses M44 — the original trace is never mutated).
 */

interface ReplayResult {
  output: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  model: string;
  costUsd?: number;
}
interface DatasetsResult {
  datasets: { id: string; name: string }[];
}

const ROLES = ['system', 'user', 'assistant'];

/** Parse the optional schema text: empty → ok/no-schema; a plain JSON object → ok/value; else invalid. */
function parseSchema(text: string): { ok: boolean; value?: object } {
  const t = text.trim();
  if (t === '') return { ok: true };
  try {
    const v: unknown = JSON.parse(t);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return { ok: true, value: v };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface VariantColumnHandle {
  /** Imperatively trigger this variant's replay (used by the orchestrator's Run-all). */
  run: () => void;
}

/** Map the M55 fail-closed HTTP status to an honest, typed message (duck-typed `.status`, robust across
 *  module boundaries). A cross-tenant 404 is deliberately non-committal (never leaks trace existence). */
export function errorMessage(err: unknown): string {
  return lensErrorMessage(
    err,
    {
      503: 'The replay provider is not configured right now.',
      502: 'The provider failed to answer — try again shortly.',
      429: 'Rate limit reached for this workspace — wait a moment before running again.',
      404: 'This trace is not available (it may belong to another workspace).',
    },
    'The provider is unavailable — no output was produced.',
  );
}

export const VariantColumn = forwardRef<
  VariantColumnHandle,
  {
    variant: Variant;
    span: TraceSpanNode;
    onChange: (v: Variant) => void;
    /** Record a completed run's key on the LATEST variant (a functional parent update that preserves any
     *  edits made while the replay was in flight — never clobbers the current variant). */
    onRan: (ranKey: string) => void;
    onRemove: () => void;
    canRemove: boolean;
  }
>(function VariantColumn({ variant, span, onChange, onRan, onRemove, canRemove }, ref) {
  const [showSchema, setShowSchema] = useState(false);
  const [dataset, setDataset] = useState('');
  const schema = parseSchema(variant.responseSchema);

  const replay = useMutation({
    // The run carries the runKey it was invoked with (`ranKey`) so a resolving run marks the LATEST
    // variant stale-or-fresh against the inputs AT RUN TIME — an edit made mid-flight is preserved and
    // correctly shows the output as stale (ADR D3; the run never rebuilds the variant from a stale closure).
    mutationFn: (_vars: { ranKey: string }) =>
      cloudFetch<ReplayResult>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(span.traceId)}/replay`,
        {
          method: 'POST',
          body: JSON.stringify({
            messages: variant.messages.map((m) => ({ role: m.role, content: m.content })),
            ...(variant.model.trim() ? { model: variant.model.trim() } : {}),
            ...(schema.value ? { responseSchema: schema.value } : {}),
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: (_data, vars) => onRan(vars.ranKey),
  });

  const run = () => {
    if (replay.isPending || !schema.ok) return;
    replay.mutate({ ranKey: runKey(variant) });
  };
  useImperativeHandle(ref, () => ({ run }), [run]);

  // Datasets for the opt-in save (loaded only once there's a result to save; shared across columns by key).
  const datasets = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets'] as const,
    queryFn: () => cloudFetch<DatasetsResult>('/v1/dashboard/lens/datasets', {}, { throwOnError: true }),
    enabled: replay.isSuccess,
  });
  const datasetOptions = datasets.data?.datasets ?? [];
  const targetDataset = dataset || datasetOptions[0]?.id || '';
  const save = useMutation({
    mutationFn: (dsId: string) =>
      cloudFetch(
        `/v1/dashboard/lens/datasets/${encodeURIComponent(dsId)}/items`,
        { method: 'POST', body: JSON.stringify({ input: JSON.stringify(variant.messages), output: replay.data?.output ?? '' }) },
        { throwOnError: true },
      ),
    retry: false,
  });

  const setMsg = (i: number, patch: Partial<EditableMessage>) =>
    onChange(updateVariant(variant, { messages: variant.messages.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const addMsg = () => onChange(updateVariant(variant, { messages: [...variant.messages, { role: 'user', content: '' }] }));
  const removeMsg = (i: number) =>
    onChange(updateVariant(variant, { messages: variant.messages.filter((_, j) => j !== i) }));

  const result = replay.data ?? null;
  const stale = isStale(variant);

  return (
    <Card className="flex w-[340px] shrink-0 flex-col" data-testid="variant-column">
      <Card.Body className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Variant</span>
          <Button variant="ghost" size="sm" aria-label="Remove variant" onClick={onRemove} disabled={!canRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Editable messages (controlled → plain text, XSS-safe). */}
        <div className="space-y-2">
          {variant.messages.map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              <Select value={m.role} onValueChange={(v) => setMsg(i, { role: v })}>
                <Select.Trigger className="w-[120px]" aria-label={`Role for message ${i + 1}`}>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {ROLES.map((r) => (
                    <Select.Item key={r} value={r}>
                      {r}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Textarea
                value={m.content}
                onChange={(e) => setMsg(i, { content: e.target.value })}
                aria-label={`Content for message ${i + 1}`}
                className="min-h-[52px] flex-1 font-mono text-xs"
              />
              <Button variant="ghost" size="sm" aria-label={`Remove message ${i + 1}`} onClick={() => removeMsg(i)} disabled={variant.messages.length <= 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addMsg}>
            <Plus className="mr-1 h-4 w-4" /> Add message
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={variant.model}
            onChange={(e) => onChange(updateVariant(variant, { model: e.target.value }))}
            placeholder="model (default)"
            aria-label="Model override"
            className="w-full font-mono text-xs"
          />
        </div>

        {/* Optional structured output (JSON schema → response_format). */}
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowSchema((s) => !s)}>
            <Braces className="mr-1 h-4 w-4" /> Structured output
          </Button>
          {showSchema ? (
            <div className="space-y-1">
              <Textarea
                value={variant.responseSchema}
                onChange={(e) => onChange(updateVariant(variant, { responseSchema: e.target.value }))}
                aria-label="JSON schema (structured output)"
                placeholder='{"type":"object","properties":{...}}'
                className="min-h-[52px] font-mono text-xs"
              />
              {!schema.ok ? <p className="text-xs text-destructive">Invalid JSON schema — must be a JSON object.</p> : null}
            </div>
          ) : null}
        </div>

        <Button size="sm" onClick={run} disabled={replay.isPending || !schema.ok}>
          {replay.isPending ? 'Running…' : 'Run'}
        </Button>

        {replay.isError ? (
          <Alert intent="warning" title="Replay failed" data-testid="variant-error">
            {errorMessage(replay.error)}
          </Alert>
        ) : null}

        {result ? (
          <div
            data-testid="variant-output"
            data-stale={String(stale)}
            className={`space-y-1 rounded border border-border/50 p-2 ${stale ? 'opacity-50' : ''}`}
          >
            {stale ? <p className="text-xs text-muted-foreground">Inputs changed — re-run to refresh.</p> : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs">{result.output}</pre>
            <div className="flex flex-wrap gap-1 text-xs">
              <Badge variant="outline">{result.model}</Badge>
              <Badge variant="outline">{formatDuration(result.latencyMs)}</Badge>
              <Badge variant="outline">{formatTokens(result.totalTokens)} tok</Badge>
              <Badge variant="outline" data-testid="variant-cost">
                {formatCost(result.costUsd ?? NaN)}
              </Badge>
            </div>
            {/* Opt-in save — the only persist path (reuses M44; the trace is never mutated). */}
            <div className="flex items-center gap-2 border-t border-border/50 pt-2">
              {datasetOptions.length > 0 ? (
                <Select value={targetDataset} onValueChange={setDataset}>
                  <Select.Trigger className="w-[160px]" aria-label="Dataset">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {datasetOptions.map((d) => (
                      <Select.Item key={d.id} value={d.id}>
                        {d.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground">No datasets yet.</span>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={!targetDataset || save.isPending}
                onClick={() => targetDataset && save.mutate(targetDataset)}
              >
                {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save as dataset item'}
              </Button>
            </div>
            {/* M72 — the save must not fail silently. */}
            {save.isError ? (
              <Alert
                intent="warning"
                title="Could not save to the dataset"
                description="The item was not saved — try again, or pick a different dataset."
                data-testid="variant-save-error"
                className="mt-2"
              />
            ) : null}
          </div>
        ) : null}
      </Card.Body>
    </Card>
  );
});
