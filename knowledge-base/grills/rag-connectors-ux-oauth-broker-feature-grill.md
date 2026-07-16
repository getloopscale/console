---
slug: rag-connectors-ux-oauth-broker
generated_by: roadmap-feature
milestone_id: M8
date: 2026-07-16
status: completed
source: system UX audit (API+SDK+MCP+UI surface parity) + sponsor delegation ("gere milestones via /roadmap-feature")
---

# Feature grill — M8 RAG Connectors reach real users

> Answers derived from a grounded UX audit of the shipped system, not a live interview:
> the sponsor delegated milestone generation after asking "temos as jornadas mapeadas? como
> fazemos o connect?". Evidence traced end-to-end (theo-rag connectors handler → SDK → MCP →
> theo-cloud BFF/dashboard).

## Q1 — What is this feature and why NOW?
A Connectors journey in the dashboard: a Connectors page + a BFF proxy of `/v1/rag/connectors` +
the missing **OAuth authorization broker** at the edge. Why now: theo-rag#97 just closed — the
12-provider connectors platform is complete, reachable via SDK/MCP, and LIVE-proven — yet a human
cannot connect a source anywhere in the product. theo-rag's connect handler ONLY accepts a
pre-obtained `refresh_token` by design ("the app secret + browser redirect live at the edge",
`connectors.ts:5`), and that edge does not exist: there is no `/authorize`, `/callback`, or
code-exchange anywhere, and `grep connector dashboard/src` = 0. The engine is done; the on-ramp is
the last mile between "built" and "usable".

## Q2 — Dependencies (which milestones must be [x])?
M1 (Model-B per-Account-scoped mint) — the per-tenant `theo_live_*` key the BFF injects to reach
theo-rag. theo-rag#97 (SDK/MCP surface) is prior art, NOT a blocker. theo-cloud#191 (page+proxy) is
subsumed by this milestone.

## Q3 — Definition of Done
See the M8 block in ROADMAP.md (6 DoD bullets): BFF proxy with Model-B mint + scopes; OAuth
authorization broker (signed tenant-bound state + PKCE, edge-only secrets, server-to-server
refresh_token) for the 8 OAuth providers; server-side credential form for the 6 non-OAuth providers;
`connectors.tsx` page + nav; secret-safety (no credential to browser/log); LIVE dogfood J-connectors
(OAuth round-trip + paste-credential) per the Cleanroom mandate.

## Q4 — Top 2 NEW risks
1. OAuth app registration + secret custody for up to 8 providers is real operational surface.
   Mitigation: broker 1-2 highest-demand providers first (Google Drive, Dropbox); rest stay
   paste-credential until their OAuth app is registered; secrets in the edge secret store only.
2. `state`/PKCE + per-tenant binding must be airtight or a callback attaches a source to the wrong
   tenant/collection (OAuth mix-up/CSRF). Mitigation: signed single-use tenant-bound state; validate
   state→tenant BEFORE the connect POST; negative-case test for forged/stale state.

## Out-of-scope cross-check
No overlap with ROADMAP.md § Explicitly out of scope (account-members RBAC / JWT bump / data-plane
workspace semantics). PASS.
