import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AttributesTable, Badge, Button, IOCards, TokenCostBreakdown } from '@usetheo/ui';
import { ClipboardCheck } from 'lucide-react';

import { cloudFetch } from '@/lib/api';
import { formatCost, formatDate, formatDuration, formatScore } from '@/lib/format';
import { spanOwnCostUsd } from '@/lib/trace-layout';
import { detectPii } from '@/lib/otel-attributes';
import { LensPlayground } from '../playground';
import { durationMs, type TraceSpanNode } from './helpers';
import { Markdown } from './markdown';
import { toTraceSpan } from './to-trace-span';

/**
 * Right pane — everything the user came for about ONE span (M8 adoption). The attribute panel and the
 * input/output rendering now come from `@usetheo/ui` (`AttributesTable` + `IOCards`); the lens-specific
 * surfaces (machine evaluations, the Playground replay, the labeling-queue enqueue) stay here. The lens
 * `Markdown` (react-markdown + rehype-sanitize) is injected into `IOCards` via its `renderMarkdown` slot
 * — the sanitizer lives in the consumer (ADR D2), not the design system.
 */
export function SpanDetail({ span }: { span: TraceSpanNode }) {
  const dur = durationMs(span);
  // M15 — cache tokens honestly: sum read + creation, but stay `undefined` (→ em-dash) when BOTH are
  // absent, so an absent cache is never fabricated as a zero.
  const cacheTokens =
    span.cacheReadTokens !== undefined || span.cacheCreationTokens !== undefined
      ? (span.cacheReadTokens ?? 0) + (span.cacheCreationTokens ?? 0)
      : undefined;
  const hasAttrs = Object.keys(span.attributes ?? {}).length > 0;
  const events = span.events ?? [];
  const canReplay = !!span.inputValue;
  const [pgOpen, setPgOpen] = useState(false);
  const enqueue = useMutation({
    mutationFn: () =>
      cloudFetch(
        `/v1/dashboard/lens/traces/${encodeURIComponent(span.traceId)}/enqueue-for-labeling`,
        { method: 'POST', body: JSON.stringify({ spanId: span.spanId }) },
        { throwOnError: true },
      ),
    retry: false,
  });
  const renderMarkdown = (text: string) => <Markdown source={text} />;

  return (
    <div data-testid="span-detail" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{span.name}</span>
        {span.model ? <Badge variant="outline">{span.model}</Badge> : null}
        {span.provider ? <Badge variant="outline">{span.provider}</Badge> : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={`Add ${span.name} to labeling queue`}
          disabled={enqueue.isPending || enqueue.isSuccess}
          onClick={() => enqueue.mutate()}
        >
          <ClipboardCheck className="mr-1 h-4 w-4" />
          {enqueue.isSuccess ? 'Queued' : enqueue.isPending ? 'Queuing…' : 'Add to labeling queue'}
        </Button>
        {canReplay ? (
          <Button variant="secondary" size="sm" onClick={() => setPgOpen((v) => !v)}>
            {pgOpen ? 'Close playground' : 'Playground'}
          </Button>
        ) : null}
      </div>
      {enqueue.isError ? (
        <Badge variant="destructive" data-testid="enqueue-error">
          Could not add to queue
        </Badge>
      ) : null}
      {canReplay && pgOpen ? <LensPlayground span={span} /> : null}

      {/* M15 — consolidated token/cost view. Honest zeros: a real 0 renders 0/$0.0000; an ABSENT field
          renders an em-dash (never a fabricated zero). `cacheTokens` sums read + creation only when at
          least one is present. `costUsd` is the per-span cost field; the subtree ∑-cost badge stays on
          the tree. Timing (TTFT / latency) is NOT token/cost — it keeps its own `<dl>` below. */}
      <TokenCostBreakdown
        inputTokens={span.inputTokens}
        outputTokens={span.outputTokens}
        cacheTokens={cacheTokens}
        costUsd={spanOwnCostUsd(span)}
        formatCostUsd={(usd) => formatCost(usd, 4)}
        data-testid="span-detail-cost"
      />

      {span.ttftMs !== undefined || dur !== null ? (
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {span.ttftMs !== undefined ? (
            <div>
              <dt className="text-muted-foreground">TTFT</dt>
              <dd className="font-medium">{formatDuration(span.ttftMs ?? 0)}</dd>
            </div>
          ) : null}
          {dur !== null ? (
            <div>
              <dt className="text-muted-foreground">Latency</dt>
              <dd className="font-medium">{formatDuration(dur)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {span.evaluations && span.evaluations.length > 0 ? (
        <section className="space-y-1" data-testid="span-evaluations">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Evaluations</h3>
          <ul className="space-y-1">
            {span.evaluations.map((ev, i) => (
              <li key={`${ev.name}-${i}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{ev.name}</span>
                {ev.label != null ? <Badge variant="outline">{ev.label}</Badge> : null}
                {ev.score != null ? <span className="font-mono text-xs">{formatScore(ev.score)}</span> : null}
                {ev.label == null && ev.score == null ? <span className="text-muted-foreground">—</span> : null}
                {ev.explanation ? <span className="text-xs text-muted-foreground">{ev.explanation}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Input</h3>
        <IOCards key={`in-${span.spanId}`} value={span.inputValue} renderMarkdown={renderMarkdown} data-testid="span-input" />
      </section>
      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Output</h3>
        <IOCards key={`out-${span.spanId}`} value={span.outputValue} renderMarkdown={renderMarkdown} data-testid="span-output" />
      </section>

      {hasAttrs ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Attributes</h3>
          {/* M8 — the @usetheo/ui AttributesTable. `canReveal` stays fail-closed (false); the raw PII
              value never enters the DOM pre-reveal. `maskedKeys` reuses the lens `detectPii`. */}
          <AttributesTable
            attrs={toTraceSpan(span).attributes}
            maskedKeys={(key) => detectPii(span.attributes?.[key])}
            canReveal={false}
          />
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Events</h3>
          <ul className="space-y-2 text-xs">
            {events.map((e, i) => {
              const iso =
                e.timeUnixNano && /^\d+$/.test(e.timeUnixNano)
                  ? new Date(Number(BigInt(e.timeUnixNano) / 1_000_000n)).toISOString()
                  : undefined;
              const attrs = Object.entries(e.attributes ?? {});
              return (
                <li key={`${e.name}-${i}`} className="space-y-0.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-medium">{e.name}</span>
                    {iso ? <span className="text-muted-foreground">{formatDate(iso, 'datetime')}</span> : null}
                  </div>
                  {attrs.length > 0 ? (
                    <dl className="ml-2 space-y-0.5">
                      {attrs.map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="shrink-0 text-muted-foreground">{k}</dt>
                          <dd className="whitespace-pre-wrap break-all font-mono">
                            {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
