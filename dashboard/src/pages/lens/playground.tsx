import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Input, Select, Textarea } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';
import { asChat, durationMs, type TraceSpanNode } from './trace-detail';

/**
 * M55 — the prompt playground / span replay. From an LLM span, edit the recorded input (messages +
 * model) and re-run it against the real provider (server-side, via the per-tenant BFF replay proxy),
 * showing the new output/tokens/latency next to the original. The replay is a NEW run — it never
 * mutates the immutable trace (M44 read-only body); the only persist path is the opt-in "Save as
 * dataset item" (reuses M44 datasets). Edited input is controlled text and the output is plain text —
 * never `dangerouslySetInnerHTML` (XSS-safe). A provider failure surfaces a typed error, not a hang.
 */

interface ReplayResult {
  output: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  model: string;
}
interface EditableMessage {
  role: string;
  content: string;
}
interface DatasetsResult {
  datasets: { id: string; name: string }[];
}

const ROLES = ['system', 'user', 'assistant'];

/** Prefill the editable messages from the span's recorded input (Phoenix span→form pattern). A span
 *  whose input does not parse as a chat array degrades to a single editable user message (never a crash). */
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
  const [messages, setMessages] = useState<EditableMessage[]>(() => initialMessages(span));
  const [model, setModel] = useState(span.model ?? '');
  const [dataset, setDataset] = useState('');

  const replay = useMutation({
    mutationFn: () =>
      cloudFetch<ReplayResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(span.traceId)}/replay`, {
        method: 'POST',
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          ...(model.trim() ? { model: model.trim() } : {}),
        }),
      }),
  });
  const result = replay.data ?? null;

  // Datasets for the opt-in save (loaded only once there's a result to save).
  const datasets = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets'] as const,
    queryFn: () => cloudFetch<DatasetsResult>('/v1/dashboard/lens/datasets'),
    enabled: !!result,
  });
  const datasetOptions = datasets.data?.datasets ?? [];
  const targetDataset = dataset || datasetOptions[0]?.id || '';

  const save = useMutation({
    mutationFn: (dsId: string) =>
      cloudFetch(`/v1/dashboard/lens/datasets/${encodeURIComponent(dsId)}/items`, {
        method: 'POST',
        // the replayed input + output — a new dataset item, NOT a mutation of the trace.
        body: JSON.stringify({ input: JSON.stringify(messages), output: result?.output ?? '' }),
      }),
  });

  const setMsg = (i: number, patch: Partial<EditableMessage>) =>
    setMessages((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const addMsg = () => setMessages((prev) => [...prev, { role: 'user', content: '' }]);
  const removeMsg = (i: number) => setMessages((prev) => prev.filter((_, j) => j !== i));

  const origTokens = (span.inputTokens ?? 0) + (span.outputTokens ?? 0);
  const origDuration = durationMs(span);

  return (
    <Card className="mt-3 space-y-3 p-3" data-testid="playground">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Playground · replay</h3>
        <span className="text-xs text-muted-foreground">A new run — the original trace is unchanged.</span>
      </div>

      {/* Editable messages (controlled inputs → plain text, XSS-safe). */}
      <div className="space-y-2">
        {messages.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <Select value={m.role} onValueChange={(v) => setMsg(i, { role: v })}>
              <Select.Trigger className="w-[130px]" aria-label={`Role for message ${i + 1}`}>
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
              className="min-h-[60px] flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" aria-label={`Remove message ${i + 1}`} onClick={() => removeMsg(i)} disabled={messages.length <= 1}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={addMsg}>
          <Plus className="mr-1 h-4 w-4" /> Add message
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="pg-model">
          Model
        </label>
        <Input
          id="pg-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="(default)"
          className="w-[220px] font-mono text-xs"
        />
        <Button size="sm" onClick={() => replay.mutate()} disabled={replay.isPending}>
          {replay.isPending ? 'Running…' : 'Run'}
        </Button>
      </div>

      {replay.isError ? (
        <Alert intent="warning" title="Replay failed" data-testid="replay-error">
          The provider is unavailable, rate-limited, or not configured — no output was produced.
        </Alert>
      ) : null}

      {/* Original vs replay, side by side. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">Original</h4>
          <pre data-testid="original-output" className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-xs">
            {span.outputValue ?? '—'}
          </pre>
          <div className="text-xs text-muted-foreground">
            {origTokens} tokens{origDuration !== null ? ` · ${origDuration} ms` : ''}
          </div>
        </div>
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">Replay</h4>
          {result ? (
            <>
              <pre data-testid="replay-output" className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-xs">
                {result.output}
              </pre>
              <div className="flex flex-wrap gap-1 text-xs" data-testid="replay-metrics">
                <Badge variant="outline">{result.totalTokens} tokens</Badge>
                <Badge variant="outline">{result.latencyMs} ms</Badge>
                {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Run to see the new output.</div>
          )}
        </div>
      </div>

      {/* Opt-in: save the replayed input+output as a synthetic dataset item (the only persist path). */}
      {result ? (
        <div className="space-y-1 border-t border-border/50 pt-2">
          <div className="flex items-center gap-2">
            {datasetOptions.length > 0 ? (
              <Select value={targetDataset} onValueChange={setDataset}>
                <Select.Trigger className="w-[200px]" aria-label="Dataset">
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
              <span className="text-xs text-muted-foreground">No datasets yet — create one first.</span>
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
          {save.isError ? (
            <Alert intent="warning" title="Could not save" data-testid="save-error">
              The dataset item was not saved — try again.
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
