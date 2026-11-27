import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Maximize2, Share2, ZoomIn, ZoomOut } from 'lucide-react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { Card, EmptyState, Tabs } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { Alert } from '@/components/ui/alert-guard';
import { SessionPicker } from '@/pages/memory/scope-switcher';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useMemoryGraph, type GraphResult } from '@/hooks/memory/use-graph';
import { themeColor, withAlpha } from '@/lib/theme/canvas-colors';

/**
 * loopmem-graph-gateway-dashboard — /memory/graph.
 *
 * Entity relation graph ({nodes, edges}) rendered as an interactive
 * force-directed view via `react-force-graph-2d` (ADR graph-viz-lib supersedes
 * the original dependency-free SVG ADR D1 — a static ring gave no zoom and no
 * clustering). Connected entities attract (clusters emerge from connectivity),
 * isolated extraction-noise recedes to the periphery in muted gray. Mirrors
 * entities.tsx for data flow:
 *  - 4 scope tabs (USER / SESSION / AGENT / REPO) via `useSearchParams('scope')`
 *  - react-query against the BFF `/v1/dashboard/memory/graph?scope=`
 *  - EmptyState when the active scope has no nodes (D5 — never null/NaN)
 */

const SCOPES = ['user', 'session', 'agent', 'repo'] as const;
type Scope = (typeof SCOPES)[number];

/** A node in the force simulation (react-force-graph augments with x/y/vx/vy). */
export interface ForceNode {
  id: string;
  memoryCount: number;
  /** connected-component index → cluster color; -1 for isolated nodes. */
  group: number;
  isolated: boolean;
  /** view-only hub root (not a real entity) — distinct shape, excluded from counts. */
  synthetic?: boolean;
  /** display label override (the hub renders "You" but keys off a sentinel id). */
  label?: string;
}
export interface ForceLink {
  source: string;
  target: string;
  relation: string;
  /** view-only spoke from the hub — dashed, no arrow, no relation label. */
  synthetic?: boolean;
  /** M1 — a superseded/invalidated edge (audit view): rendered dimmed + dashed. */
  superseded?: boolean;
}
export interface ForceGraphData {
  nodes: ForceNode[];
  links: ForceLink[];
}

/** Distinct cluster palette tuned for the dark dashboard surface (`--background`
 *  0 0% 4%). Connected components cycle through these so each cluster reads as
 *  its own color in addition to its spatial grouping. */
const CLUSTER_COLORS = [
  '#3ecf8e', // brand emerald
  '#60a5fa',
  '#f472b6',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#f87171',
  '#22d3ee',
  '#fb923c',
  '#c084fc',
];
const colorForGroup = (group: number): string => CLUSTER_COLORS[group % CLUSTER_COLORS.length] ?? CLUSTER_COLORS[0]!;

/**
 * Shape the {nodes, edges} REST payload into force-graph data:
 *  - drop self-loops and dangling edges (endpoint absent from nodes) so the
 *    simulation never references a missing node id (would throw / NaN).
 *  - union-find over the surviving links → assign each connected component a
 *    cluster index; nodes with degree 0 are `isolated` (group -1).
 * Pure + exported so it can be unit-tested without a canvas.
 */
/**
 * Conservative alias merge: a SINGLE-token node A folds into a multi-word node B
 * iff B's FIRST token equals A (case-insensitive) — i.e. A is the short form/prefix
 * of B ("Acme"→"Acme Corporation", "Phoenix"→"Phoenix project"). Prefix-only +
 * single-token-only deliberately AVOIDS false merges that a naive substring check
 * would make: "São Paulo" must NOT fold into "Universidade de São Paulo" (different
 * entities), nor "Acme" into "escritório da Acme" (the office, not the company).
 * Returns a map oldId→canonicalId; the longest matching B wins.
 */
function buildAliasMap(nodeIds: readonly string[]): Map<string, string> {
  const alias = new Map<string, string>();
  const multi = nodeIds.filter((id) => id.trim().includes(' '));
  for (const a of nodeIds) {
    if (a.includes(' ')) continue; // only single-token nodes fold
    const lowerA = a.toLowerCase();
    let best: string | undefined;
    for (const b of multi) {
      if (b === a) continue;
      const firstTokenB = b.trim().split(/\s+/)[0]?.toLowerCase();
      if (firstTokenB === lowerA && (best === undefined || b.length > best.length)) best = b;
    }
    if (best !== undefined) alias.set(a, best);
  }
  return alias;
}

export function toGraphData(result: GraphResult): ForceGraphData {
  // Fold short-form aliases into their canonical (longer) node before building.
  const aliasMap = buildAliasMap(result.nodes.map((n) => n.id));
  const canonical = (id: string): string => aliasMap.get(id) ?? id;

  // Merge node memory_count into the canonical node; drop the folded duplicates.
  const mergedCount = new Map<string, number>();
  for (const n of result.nodes) {
    const c = canonical(n.id);
    mergedCount.set(c, (mergedCount.get(c) ?? 0) + n.memory_count);
  }
  const mergedNodes = result.nodes
    .filter((n) => !aliasMap.has(n.id))
    .map((n) => ({ ...n, memory_count: mergedCount.get(n.id) ?? n.memory_count }));

  const ids = new Set(mergedNodes.map((n) => n.id));
  const links: ForceLink[] = result.edges
    .map((e) => ({
      source: canonical(e.source),
      target: canonical(e.target),
      relation: e.relation,
      // M1 — mark superseded edges (audit view) so they render dimmed + dashed.
      superseded: e.active === false,
    }))
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target));

  // union-find for connected components.
  const parent = new Map<string, string>();
  mergedNodes.forEach((n) => parent.set(n.id, n.id));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // path compression
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const l of links) {
    const ra = find(l.source);
    const rb = find(l.target);
    if (ra !== rb) parent.set(ra, rb);
  }

  const connected = new Set<string>();
  links.forEach((l) => {
    connected.add(l.source);
    connected.add(l.target);
  });

  const groupIndex = new Map<string, number>();
  let nextGroup = 0;
  const nodes: ForceNode[] = mergedNodes.map((n) => {
    const isolated = !connected.has(n.id);
    let group = -1;
    if (!isolated) {
      const root = find(n.id);
      if (!groupIndex.has(root)) groupIndex.set(root, nextGroup++);
      group = groupIndex.get(root)!;
    }
    return { id: n.id, memoryCount: n.memory_count, group, isolated };
  });

  return { nodes, links };
}

/** Sentinel id for the synthetic hub (avoids colliding with a real entity named
 *  "You"/"Você"); the node renders its `label` instead. */
const HUB_ID = '__loopmem_hub__';

/**
 * View-only UX aid: add a synthetic "hub" root so the graph reads as one star of
 * clusters instead of scattered islands. The hub connects (dashed, no arrow) to
 * ONE representative per connected component (highest memory_count) AND to every
 * isolated node. It is NOT a real entity — distinct shape, excluded from the
 * entity/relation counts, dropped if there is nothing to anchor.
 */
export function withHub(data: ForceGraphData, label: string): ForceGraphData {
  if (data.nodes.length === 0) return data;
  const repByGroup = new Map<number, ForceNode>();
  const isolated: ForceNode[] = [];
  for (const n of data.nodes) {
    if (n.isolated) {
      isolated.push(n);
      continue;
    }
    const cur = repByGroup.get(n.group);
    if (cur === undefined || n.memoryCount > cur.memoryCount) repByGroup.set(n.group, n);
  }
  const anchors = [...repByGroup.values(), ...isolated];
  if (anchors.length === 0) return data;
  const root: ForceNode = { id: HUB_ID, label, memoryCount: 0, group: -2, isolated: false, synthetic: true };
  const spokes: ForceLink[] = anchors.map((n) => ({ source: HUB_ID, target: n.id, relation: '', synthetic: true }));
  return { nodes: [root, ...data.nodes], links: [...data.links, ...spokes] };
}

/**
 * loop-console#254 — above this many nodes the unfiltered graph is a hairball, so the two mitigations
 * that already existed as buttons are ON by default. Below it the full graph is legible and stays
 * whole: a default that hides data on a 40-node workspace would be its own defect.
 *
 * 500 is the order of magnitude at which the reported screen became unreadable (4423 nodes), not a
 * measured optimum — it is a threshold chosen to separate "small" from "hairball", and both sides of
 * it are reversible by the buttons the operator can see.
 */
export const HAIRBALL_NODE_THRESHOLD = 500;

/** Labels drawn at the default zoom. Past this many nodes the text overlaps into a wash. */
export const LABEL_BUDGET = 40;


/**
 * loop-console#254 — whether unconnected (degree-0) nodes are shown on FIRST paint.
 *
 * 1266 of 4423 nodes (29%) were unconnected, occupying area and adding nothing to a graph whose whole
 * subject is relations. "Hide N unconnected" already existed; it was just off, so the operator had to
 * discover it. A default that requires discovery is not a default.
 */
export function defaultShowIsolated(nodeCount: number, isolatedCount: number): boolean {
  if (isolatedCount === 0) return true; // nothing to hide
  // Hiding must never blank the canvas. With every node unconnected, hiding leaves NOTHING — and an
  // empty graph over a populated workspace reads as "you have no entities", a worse lie than a
  // crowded one. Same principle as #250/#261: never assert absence you did not observe.
  if (nodeCount - isolatedCount === 0) return true;
  return nodeCount <= HAIRBALL_NODE_THRESHOLD;
}

/**
 * loop-console#254 — the ids whose label is drawn at the default zoom: the `limit` most-CONNECTED nodes.
 *
 * Every connected node used to be labelled unconditionally (`!n.isolated`), so 3157 labels overlapped
 * into an unreadable wash — the single largest contributor to the illegibility, and the one that
 * survives hiding the unconnected 29%.
 *
 * Degree, not `memoryCount`: this screen is about relations, so the nodes worth naming are the ones
 * the graph converges on. Zooming past the threshold still labels everything, so nothing is lost —
 * only deferred.
 */
export function topLabelIds(data: ForceGraphData, limit = LABEL_BUDGET): Set<string> {
  if (data.nodes.length <= limit) return new Set(data.nodes.map((n) => n.id));
  const degree = new Map<string, number>();
  for (const l of data.links) {
    for (const id of [endpointId(l.source), endpointId(l.target)]) {
      if (id !== '') degree.set(id, (degree.get(id) ?? 0) + 1);
    }
  }
  return new Set(
    [...data.nodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, limit)
      .map((n) => n.id),
  );
}

/** id of a link endpoint whether it is still a string, already resolved to a
 *  node object, or absent (the lib types source/target as possibly-undefined). */
function endpointId(end: string | number | NodeObject | undefined): string {
  if (end === undefined) return '';
  if (typeof end === 'object') return String(end.id);
  return String(end);
}

function GraphCanvas({ data, labelIds }: { data: ForceGraphData; labelIds: ReadonlySet<string> }) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [hover, setHover] = useState<string | null>(null);

  // Responsive sizing — the force canvas needs explicit px dimensions.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const h = Math.max(420, Math.min(window.innerHeight * 0.62, 640));
      setSize({ width: el.clientWidth || 800, height: h });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Theme colors (canvas cannot use Tailwind classes — read the CSS tokens once).
  const theme = useMemo(
    () => ({
      fg: themeColor('--foreground', '#e5e5e5'),
      muted: themeColor('--muted-foreground', '#8a8a8a'),
      border: themeColor('--border', '#2a2a2a'),
    }),
    [],
  );

  // Adjacency for hover neighbor-highlighting (built from the string-id links).
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    data.links.forEach((l) => {
      const s = endpointId(l.source);
      const t = endpointId(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    });
    return m;
  }, [data]);

  const isNodeActive = useCallback(
    (id: string): boolean => hover === null || hover === id || (adjacency.get(hover)?.has(id) ?? false),
    [hover, adjacency],
  );
  const isLinkActive = useCallback(
    (l: LinkObject): boolean => {
      if (hover === null) return true;
      return endpointId(l.source) === hover || endpointId(l.target) === hover;
    },
    [hover],
  );

  const paintNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as NodeObject & ForceNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (n.synthetic === true) {
        // hub root — SAME circle shape as entities, just larger and unlabeled
        // (view-only anchor; distinguished by size + central connectivity).
        const hr = 13;
        ctx.beginPath();
        ctx.arc(x, y, hr, 0, 2 * Math.PI);
        ctx.fillStyle = theme.fg;
        ctx.fill();
        ctx.lineWidth = 1.4 / scale;
        ctx.strokeStyle = theme.border;
        ctx.stroke();
        return;
      }

      const r = n.isolated ? 3 : 4 + Math.sqrt(Math.max(n.memoryCount, 1)) * 2.2;
      const active = isNodeActive(n.id);
      const base = n.isolated ? theme.muted : colorForGroup(n.group);

      ctx.globalAlpha = active ? 1 : 0.12;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeStyle = theme.border;
      ctx.stroke();

      // Labels: the label BUDGET at default zoom (#254 — every connected node used to be labelled,
      // so 3157 labels overlapped into a wash), and everything once zoomed in past the threshold.
      // Nothing is hidden permanently: zoom reveals the rest.
      const showLabel = active && (labelIds.has(n.id) || scale > 2.4);
      if (showLabel) {
        const fontSize = Math.max(10 / scale, 1.5);
        ctx.font = `${String(fontSize)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = theme.fg;
        ctx.fillText(n.id, x, y + r + 1.5);
      }
      ctx.globalAlpha = 1;
    },
    [isNodeActive, theme, labelIds],
  );

  const paintPointerArea = useCallback(
    (node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as NodeObject & ForceNode;
      const r = (n.synthetic === true ? 13 : n.isolated ? 3 : 4 + Math.sqrt(Math.max(n.memoryCount, 1)) * 2.2) + 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  const paintLinkLabel = useCallback(
    (link: LinkObject, ctx: CanvasRenderingContext2D, scale: number) => {
      if ((link as LinkObject & ForceLink).synthetic === true) return; // hub spokes carry no label
      if (scale < 1.8 || !isLinkActive(link)) return;
      const s = link.source;
      const t = link.target;
      if (typeof s !== 'object' || typeof t !== 'object') return;
      const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
      const my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
      const fontSize = Math.max(9 / scale, 1.4);
      ctx.font = `${String(fontSize)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.muted;
      ctx.fillText((link as LinkObject & ForceLink).relation, mx, my);
    },
    [isLinkActive, theme],
  );

  const zoomBy = (factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(fg.zoom() * factor, 250);
  };
  const fit = () => fgRef.current?.zoomToFit(400, 48);

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.4)}
          className="rounded-md border border-border bg-card/80 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.4)}
          className="rounded-md border border-border bg-card/80 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fit to view"
          onClick={fit}
          className="rounded-md border border-border bg-card/80 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        linkColor={(l) => {
          // both use the visible `muted` token (border is too dark on the dark
          // card → invisible); synthetic spokes are distinguished by the dash +
          // no arrow, not by an invisible color.
          const syn = (l as ForceLink).synthetic === true;
          // M1 — superseded edges render extra-dim so the audit view distinguishes
          // them from active ones.
          if ((l as ForceLink).superseded === true) {
            return withAlpha(theme.muted, isLinkActive(l) ? 0.28 : 0.05);
          }
          return withAlpha(theme.muted, isLinkActive(l) ? (syn ? 0.45 : 0.55) : 0.08);
        }}
        linkWidth={(l) => ((l as ForceLink).synthetic === true ? 1 : isLinkActive(l) ? 1.2 : 0.6)}
        linkLineDash={(l) =>
          (l as ForceLink).synthetic === true || (l as ForceLink).superseded === true ? [4, 3] : null
        }
        linkDirectionalArrowLength={(l) => ((l as ForceLink).synthetic === true ? 0 : 3.5)}
        linkDirectionalArrowRelPos={1}
        linkCanvasObjectMode={() => 'after'}
        linkCanvasObject={paintLinkLabel}
        cooldownTicks={120}
        d3VelocityDecay={0.3}
        onEngineStop={() => fgRef.current?.zoomToFit(400, 48)}
        onNodeHover={(n) => setHover(n ? String((n as NodeObject).id) : null)}
        onNodeClick={(n) => {
          const fg = fgRef.current;
          if (!fg) return;
          fg.centerAt(n.x ?? 0, n.y ?? 0, 400);
          fg.zoom(2.6, 400);
        }}
      />
    </div>
  );
}

export function GraphPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Graph'), [setPageTitle]);
  useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const scopeParam = searchParams.get('scope');
  const activeScope: Scope = SCOPES.includes(scopeParam as Scope) ? (scopeParam as Scope) : 'user';

  const setScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
  };

  // Session-separation (2026-07-23): the SESSION tab needs an instance.
  const session = searchParams.get('session') ?? '';
  const setSession = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('session', next);
    else params.delete('session');
    setSearchParams(params, { replace: true });
  };

  // M1 — audit view: include retired (superseded/invalidated) edges alongside the
  // active graph. Default OFF (active edges only).
  const [includeSuperseded, setIncludeSuperseded] = useState(false);

  // B-057 — TETO EXPLICITO. O request vinha sem limite: pedia o grafo inteiro do
  // escopo e o cliente e que reduzia (`topLabelIds`, linhas 270-281, mantem os de
  // maior grau). Isso e trabalho de rede e de memoria feito para ser jogado fora,
  // e cresce com o tamanho da memoria do agente — o custo aparece justamente em
  // quem mais usa o produto.
  //
  // Mesmo formato e mesmo valor de `pages/rag/graphrag.tsx:135`, que ja mandava
  // `limit=300` — a outra tela de grafo do produto, com o mesmo motor de render.
  //
  // Nao ha teto de NOS no cliente para espelhar: `LABEL_BUDGET = 40` limita
  // rotulos, nao nos. Entao 300 e uma escolha, nao uma derivacao — e o que
  // sustenta e a consistencia com a tela irma, mais o fato de que um grafo de
  // forca acima disso deixa de ser legivel antes de deixar de ser renderizavel.
  // Se a medicao mostrar que 300 corta grafos uteis, o numero muda; o que nao
  // volta e a ausencia de teto.
  const query = useMemoryGraph({ scope: activeScope, session, includeSuperseded });

  const result = query.data;
  const data = useMemo(() => (result ? toGraphData(result) : { nodes: [], links: [] }), [result]);

  // #3 — hide unconnected (degree-0) nodes. Links already only reference connected
  // nodes, so filtering isolated ones never leaves a dangling edge.
  const isolatedCount = useMemo(() => data.nodes.filter((n) => n.isolated).length, [data]);
  // #254 — the DEFAULT is derived from the graph that actually arrived, because the sensible default
  // depends on its size and the data is async. `null` means "operator has not decided", so a scope
  // switch that changes the graph's size re-derives; one click pins the choice and the derivation
  // stops overriding it. A plain `useState(false)` would hide nodes on a 3-node workspace, and a
  // `useEffect` that re-seeds on every fetch would fight the operator's own click.
  const [isolatedChoice, setIsolatedChoice] = useState<boolean | null>(null);
  const showIsolated = isolatedChoice ?? defaultShowIsolated(data.nodes.length, isolatedCount);
  const setShowIsolated = (next: (prev: boolean) => boolean) => setIsolatedChoice(next(showIsolated));
  const viewData = useMemo(
    () => (showIsolated ? data : { nodes: data.nodes.filter((n) => !n.isolated), links: data.links }),
    [data, showIsolated],
  );

  // View-only "hub" root that anchors clusters + orphans into one star (UX aid;
  // excluded from the entity/relation counts below).
  const [hub, setHub] = useState(true);
  const displayData = useMemo(() => (hub ? withHub(viewData, 'You') : viewData), [viewData, hub]);
  // #254 — computed on the DISPLAYED graph, so hiding the unconnected 29% frees label budget for the
  // nodes that remain instead of spending it on nodes nobody can see.
  const labelIds = useMemo(() => topLabelIds(displayData), [displayData]);

  return (
    <PageShell
      title="Graph"
      description="How the entities your agent remembers relate to each other — an interactive force-directed view of the relation graph."
    >
      <div className="space-y-4">
        <Tabs value={activeScope} onValueChange={(v) => setScope(v as Scope)}>
          <Tabs.List>
            <Tabs.Trigger value="user">USER</Tabs.Trigger>
            <Tabs.Trigger value="session">SESSION</Tabs.Trigger>
            <Tabs.Trigger value="agent">AGENT</Tabs.Trigger>
            <Tabs.Trigger value="repo">REPO</Tabs.Trigger>
          </Tabs.List>
        </Tabs>

        {activeScope === 'session' ? (
          <SessionPicker value={session} onChange={setSession} />
        ) : null}

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(e) => setIncludeSuperseded(e.target.checked)}
            aria-label="Include superseded edges"
          />
          Include superseded edges (audit view)
        </label>

        {query.isError ? (
          <Alert intent="warning" title="Could not load the graph">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : query.isLoading ? (
          <Card className="p-6 text-muted-foreground">Loading…</Card>
        ) : data.nodes.length === 0 ? (
          <EmptyState
            icon={Share2}
            title={`No graph under ${activeScope}`}
            description="Once your agent remembers facts with relations between entities, they appear here as a graph."
          />
        ) : (
          <>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHub((v) => !v)}
                className={`rounded-md border px-3 py-1.5 text-xs ${
                  hub
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                Hub view
              </button>
              {isolatedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowIsolated((v) => !v)}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showIsolated
                    ? `Hide ${String(isolatedCount)} unconnected`
                    : `Show ${String(isolatedCount)} unconnected`}
                </button>
              ) : null}
            </div>
            <Card className="overflow-hidden p-0">
              <GraphCanvas data={displayData} labelIds={labelIds} />
            </Card>
            <p className="text-xs text-muted-foreground">
              {viewData.nodes.length} entities · {viewData.links.length} relations · node size = how
              often it appears · color = cluster · hover to highlight connections · scroll to zoom, drag
              to pan, click a node to focus.
            </p>
          </>
        )}
      </div>
    </PageShell>
  );
}
