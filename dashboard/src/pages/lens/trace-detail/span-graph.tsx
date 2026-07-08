import { Alert } from '@/components/ui/alert-guard';

import type { TraceSpanNode } from '@/lib/trace-layout';
import { buildTraceGraph, GRAPH_NODE_CAP, KIND_COLOR, KIND_LABEL } from './graph-layout';

/**
 * M67 — the Agent Graph tab. A thin SVG renderer over the pure `buildTraceGraph` (D1: deterministic
 * layered layout, no graph-viz lib). Nodes are kind-colored; the root→selected execution path is
 * highlighted; a node click selects the span via the M58 `onSelect(spanId)` contract; an oversize
 * trace shows an honest "too large to graph" state instead of the canvas.
 */

const NODE_W = 150;
const NODE_H = 46;
const PAD = 24;

export function SpanGraph({
  root,
  selectedId,
  onSelect,
}: {
  root: TraceSpanNode;
  selectedId: string;
  onSelect: (spanId: string) => void;
}) {
  const graph = buildTraceGraph(root, selectedId);

  if (graph.truncated) {
    return (
      <Alert
        intent="info"
        title={`Trace too large to graph (${graph.count} spans)`}
        description={`The agent graph renders up to ${GRAPH_NODE_CAP} spans — use the Tree or Transcript view for this trace.`}
        data-testid="graph-too-large"
      />
    );
  }

  const width = graph.width + NODE_W + PAD * 2;
  const height = graph.height + PAD * 2;
  const cx = (x: number) => x + PAD + NODE_W / 2;
  const cyTop = (y: number) => y + PAD;
  const cyBottom = (y: number) => y + PAD + NODE_H;
  const nodeById = new Map(graph.nodes.map((n) => [n.spanId, n]));

  return (
    <div className="max-h-[70vh] overflow-auto" data-testid="span-graph">
      <svg
        // M71 — role="group" (not "img"): the nodes are interactive controls, so AT must NOT treat the
        // graph as a single opaque image (which hid the clickable spans). A group exposes the buttons.
        role="group"
        aria-label={`Agent execution graph — ${graph.nodes.length} spans`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="font-sans"
      >
        {/* edges: parent bottom-center → child top-center; on-path edges are emphasized */}
        {graph.edges.map((e) => {
          const from = nodeById.get(e.from);
          const to = nodeById.get(e.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={cx(from.x)}
              y1={cyBottom(from.y)}
              x2={cx(to.x)}
              y2={cyTop(to.y)}
              // M71 — theme tokens (not raw hex) so the graph is legible in light + dark.
              className={e.onPath ? 'stroke-primary' : 'stroke-border'}
              strokeWidth={e.onPath ? 2 : 1}
              opacity={e.onPath ? 1 : 0.6}
            />
          );
        })}
        {/* nodes: a kind-colored rounded rect + a role badge dot; click → select the span */}
        {graph.nodes.map((n) => (
          <g
            key={n.spanId}
            data-testid="graph-node"
            data-selected={n.selected || undefined}
            data-on-path={n.onPath || undefined}
            data-kind={n.kind}
            role="button"
            tabIndex={0}
            aria-label={`${KIND_LABEL[n.kind]}: ${n.name}${n.selected ? ' (selected)' : ''}`}
            className="cursor-pointer"
            onClick={() => onSelect(n.spanId)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onSelect(n.spanId);
              }
            }}
          >
            <rect
              x={n.x + PAD}
              y={n.y + PAD}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              // M71 — theme tokens: fill card/muted, stroke primary (selected) / muted-fg (on-path) / border.
              className={
                n.selected
                  ? 'fill-muted stroke-primary'
                  : n.onPath
                    ? 'fill-card stroke-muted-foreground'
                    : 'fill-card stroke-border'
              }
              strokeWidth={n.selected ? 2 : 1}
            />
            <circle
              cx={n.x + PAD + 14}
              cy={n.y + PAD + NODE_H / 2}
              r={5}
              // an error dot uses the theme destructive; otherwise the semantic kind palette.
              className={n.error ? 'fill-destructive' : undefined}
              fill={n.error ? undefined : KIND_COLOR[n.kind]}
            />
            <text x={n.x + PAD + 26} y={n.y + PAD + 19} fontSize={11} className="fill-muted-foreground uppercase tracking-wider">
              {KIND_LABEL[n.kind]}
            </text>
            <text x={n.x + PAD + 26} y={n.y + PAD + 35} fontSize={12} className="fill-foreground">
              {n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}
            </text>
          </g>
        ))}
      </svg>
      {/* sr-only node summary — screen-reader parity for the visual graph (the MetricTrendChart pattern) */}
      <ul className="sr-only">
        {graph.nodes.map((n) => (
          <li key={n.spanId}>
            {KIND_LABEL[n.kind]}: {n.name}
            {n.onPath ? ' — on the execution path' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
