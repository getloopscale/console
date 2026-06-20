# Edge Case Review — themory-graph-gateway-dashboard

Date: 2026-06-20 · Tasks analyzed: 7 · Edge cases: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## SHOULD TEST
- EC-1 (T1.2): upstream themory `/graph` returns null nodes/edges → client+handler must coerce nil→[] (D5). Test: contract `{}` response → `len(Edges)==0 && Edges != nil`.
- EC-2 (T2.1): an edge whose source/target is NOT in `nodes` → SVG render must skip it (no crash / no NaN coords). Test: fixture with a dangling edge → renders nodes, skips the orphan edge.

## DOCUMENT
- EC-3 (T3.1): dev `mock-openai` may not emit `relations` → e2e asserts `edges` array PRESENT (non-empty only when the LLM emits relations); the unit/contract layer fully covers the logic deps-free. Resolved at T0.1.
- EC-4 (T1.1): `scope != "user"` → empty graph (shared-key model, D3) — not an error. Mirror of entities `:422`.

**Verdict:** PLAN OK — 0 MUST FIX (mirror of a shipped pattern). EC-1/EC-2 folded into T1.x/T2.1 TDD.
