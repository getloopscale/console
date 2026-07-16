---
slug: graphrag-in-ask-ui
generated_by: roadmap-feature
milestone_id: M9
date: 2026-07-16
status: completed
source: system UX audit (dashboard ask.tsx vs theo-rag retrieval strategies) + sponsor delegation
---

# Feature grill — M9 GraphRAG reachable in the Ask UI

> Answers derived from a grounded audit: theo-rag implements `strategy: vector|keyword|hybrid|graph|global`
> (community-detection/report/store + global/graph retrievers, exposed on SDK/MCP with fail-close-to-vector);
> `grep -i strategy dashboard/src/pages/rag/ask.tsx` = 0 — the dashboard Ask only calls the default `vector`.

## Q1 — What is this feature and why NOW?
Surface the retrieval strategy selector (including GraphRAG `global`/`graph`) in the dashboard Ask
page. Why now: GraphRAG is a real differentiator (Microsoft-GraphRAG-style global sensemaking),
fully built + tested in theo-rag, yet unreachable in the product because `ask.tsx` never sends a
`strategy`. A small BFF passthrough + one selector unlocks a headline capability at near-zero risk.

## Q2 — Dependencies
None. M8 is NOT required — the dashboard Ask journey already works end-to-end; this only exposes an
existing, backward-compatible param.

## Q3 — Definition of Done
See the M9 block in ROADMAP.md (4 DoD bullets): BFF forwards optional `strategy` (default `vector`);
`ask.tsx` gains an outcome-labelled Select (progressive-disclosure); the result surfaces which
strategy answered + router fallback (honest, no silent degrade); journey proves `global` on a
graph-enabled collection returns a community-grounded answer and fails-closed to vector otherwise.

## Q4 — Top 2 NEW risks
1. `global` needs the collection to have run graph extraction/community detection; exposing it
   without signaling that prerequisite invites degraded-answer confusion. Mitigation: UI shows the
   fail-close + (if the API exposes it) graph-readiness; copy sets expectations.
2. Five strategies can overwhelm the default journey. Mitigation: default stays `vector`, selector is
   advanced/progressive-disclosure, labels are outcome-shaped not internal jargon.

## Out-of-scope cross-check
No overlap with ROADMAP.md § Explicitly out of scope. PASS.
