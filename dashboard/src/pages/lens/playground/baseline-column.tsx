import { Badge, Card } from '@usetheo/ui';

import { formatCost, formatDuration, formatTokens } from '@/lib/format';
import type { TraceSpanNode } from '@/lib/trace-layout';
import { durationMs } from '../trace-detail';

/**
 * M62 P2 — the read-only baseline column: the ORIGINAL span rendered next to the editable variants
 * (the compare anchor). It has NO editable control and never calls the provider — a structural proof
 * that the original is untouched (the M44 read-only invariant; ADR D3). Metrics reuse the M57
 * formatters; the output is plain text (XSS-safe).
 */
export function BaselineColumn({ span }: { span: TraceSpanNode }) {
  // Never-measured (both counts absent) → NaN so formatTokens renders "—" (not a
  // fabricated "0 tok"). A real measured 0 — or a partial where one half was
  // recorded — is a genuine value and renders as the sum. (M89 data-honesty.)
  const tokens =
    span.inputTokens === undefined && span.outputTokens === undefined
      ? NaN
      : (span.inputTokens ?? 0) + (span.outputTokens ?? 0);
  const latency = durationMs(span);
  return (
    <Card className="flex w-[320px] shrink-0 flex-col" data-testid="baseline-column">
      <Card.Body className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Original</span>
          <Badge variant="outline" className="text-xs">
            baseline · read-only
          </Badge>
        </div>
        <pre
          data-testid="baseline-output"
          className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-xs"
        >
          {span.outputValue ?? '—'}
        </pre>
        <div className="flex flex-wrap gap-1 text-xs" data-testid="baseline-metrics">
          {span.model ? <Badge variant="outline">{span.model}</Badge> : null}
          <Badge variant="outline">{formatDuration(latency ?? NaN)}</Badge>
          <Badge variant="outline">{formatTokens(tokens)} tok</Badge>
          <Badge variant="outline" data-testid="baseline-cost">
            {formatCost(span.costUsd ?? NaN)}
          </Badge>
        </div>
      </Card.Body>
    </Card>
  );
}
