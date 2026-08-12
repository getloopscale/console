import type { TraceSpan } from '@usetheo/ui';
import { isSpanError } from '@/pages/lens/span-status';
import type { TraceSpanNode } from './helpers';

/**
 * M8 adoption — the boundary mapper from the theo-lens `TraceSpanNode` (OTLP-shaped: `spanId`,
 * `startTimeUnixNano`, `statusCode`) to the `@usetheo/ui` generic `TraceSpan` (`id`, `startTime`,
 * `status`). The lib's trace-native components (SpanTree, SpanWaterfall, TraceTranscript, SpanGraph,
 * AttributesTable, IOCards, TraceCompare) consume `TraceSpan`; this is the single place the two shapes
 * meet. Pure + total: preserves the honest error signal via `isSpanError` (the OTLP status vocabulary
 * is collapsed to the lib's OK/ERROR/UNSET), never throws.
 */
export function toTraceSpan(node: TraceSpanNode): TraceSpan {
  return {
    id: node.spanId,
    parentId: node.parentSpanId ?? null,
    name: node.name,
    kind: node.kind,
    startTime: node.startTimeUnixNano,
    endTime: node.endTimeUnixNano ?? null,
    status: isSpanError(node.statusCode) ? 'ERROR' : 'OK',
    model: node.model,
    provider: node.provider,
    inputTokens: node.inputTokens,
    outputTokens: node.outputTokens,
    cacheReadTokens: node.cacheReadTokens,
    cacheCreationTokens: node.cacheCreationTokens,
    ttftMs: node.ttftMs,
    costUsd: node.costUsd,
    inputValue: node.inputValue,
    outputValue: node.outputValue,
    attributes: node.attributes,
    events: node.events?.map((e) => ({ name: e.name, time: e.timeUnixNano, attributes: e.attributes })),
    children: node.children?.map(toTraceSpan),
  };
}
