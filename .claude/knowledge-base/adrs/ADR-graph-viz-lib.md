# ADR — Graph view: adopt `react-force-graph-2d` (supersedes ADR D1 "dependency-free SVG")

**Date:** 2026-06-20
**Status:** Accepted (supersedes ADR D1 of `themory-graph-gateway-dashboard`)
**Scope:** `dashboard/src/pages/memory/graph.tsx` only. No gateway/BFF/API change.

## Context

The `themory-graph-gateway-dashboard` plan shipped the `/memory/graph` view as a
**dependency-free SVG node-link diagram** (ADR D1 — rejected cytoscape/react-flow
for KISS/YAGNI, scoped to "1–2 hop view"). Layout was a deterministic circle.

Live validation with a real LLM-populated graph (25 nodes, real relations)
exposed the SVG's UX ceiling, raised by the project owner verbatim:

> "Ela não tem clusters, não tem zoom-in/out, experiência ruim."

A static ring places every node on a circle regardless of connectivity, has no
zoom/pan, and gives isolated extraction-noise the same visual weight as real
clusters. Hand-rolling force layout + zoom/pan + clustering well is precisely the
wheel-reinvention that Inquebrável Rule 9 ("Não reinvente a roda") warns against.

## Decision

Adopt **`react-force-graph-2d`** (`^1.29.1`, peer `react: '*'`) for the graph
view. It provides, out of the box:

- **Force-directed layout** → connected entities attract; connected components
  separate → *clusters emerge from connectivity* (plus a per-component color).
- **Zoom / pan / drag** (wheel + drag), plus explicit Zoom-in / Zoom-out / Fit
  controls and click-to-focus.
- **Node size by `memory_count`**, hover **neighbor-highlight** (dims the rest),
  directional edges with relation labels (shown when zoomed in).
- Isolated (degree-0) nodes rendered small + muted so extraction-noise recedes.

The `{nodes, edges}` payload is shaped by a pure, unit-tested `toGraphData()`
(drops self-loops + dangling edges; union-find for cluster grouping). Canvas
rendering means view tests assert via a mocked `ForceGraph2D` + the pure shaper,
not DOM text.

## Alternatives considered

- **Cytoscape.js** — most powerful (Louvain community detection, expand/collapse,
  many layouts) but a heavier dep + verbose API; more than a 1–2 hop view needs
  (YAGNI). Rejected.
- **Keep dependency-free SVG, hand-roll zoom + force** — would pull `d3-force`
  anyway and reinvent a mature library partially, with worse polish. Rejected.
- **`@xyflow/react` (React Flow)** — DOM nodes (testable) but flowchart-shaped;
  auto-layout needs `dagre`/`elk` and clustering is not automatic. Rejected for a
  knowledge-graph use case.

## Consequences

- (+) Real graph UX (clusters + zoom) with less code than the SVG it replaces.
- (+) Canonical "knowledge-graph" look the CTO asked for.
- (−) One production dependency in the **dashboard** (38 transitive pkgs:
  `force-graph` + `d3-*`). Lazy-loaded route → isolated chunk; does not affect
  initial paint of other routes. Does NOT touch `@usetheo/memory` bundle
  isolation (different repo/bundle).
- (−) Canvas is not DOM-assertable → tests restructured (pure shaper + mock).
- Workbox precache now excludes `dist/bundle-stats.html` (the bigger dep graph
  pushed the visualizer artifact past the 2 MiB precache limit; it was never an
  app asset). See CHANGELOG `Fixed`.

## Validation

`tsc -b` 0 · `eslint` 0 · `vitest src/pages/memory/graph.test.tsx` 10/10 ·
`vite build` green (graph in its own lazy chunk). Live: real OpenAI-populated
graph (User↔Maria↔Carlos cluster, Acme↔DataFlow cluster) renders with clusters +
zoom at `http://localhost:5173/memory/graph`.
