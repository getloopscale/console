# Review: M8 (RAG Connectors UX + OAuth broker) + M9 (GraphRAG strategy)

**Date:** 2026-07-16
**Branch:** develop @ `ad123eb`
**Reviewers (spawned agents):** 2 — `auth-guardian` (security), `api-domain-architect` (architecture/wiring/contract)
**Verdict:** **NEEDS_FIXES** (1 BLOCKER on M8 OAuth broker; M9 clean)
**Tracking issue:** usetheodev/theo-cloud#199

## Consolidated findings (severity-ranked)

| # | Sev | Area | Finding | File:line |
|---|---|---|---|---|
| B1 | BLOCKER | security | `Callback`/`Authorize` mounted under Bearer-only `requireJWT`, but they are browser top-level redirects → 401 in prod, or JWT-leak-to-provider if operator adds `?token=`. Use the GitHub-integration Kratos session-cookie model (root mount, cookie→whoami→tenant). | `rag_connectors_oauth.go:205-208`, `cmd/main.go` rag group |
| H1a | HIGH | deploy | `redirectBase` defaults to `AppPublicURL` (dashboard origin) but `Callback` is on the BFF origin → split-subdomain callback 404 + cookies not delivered. Frontend `authorizeHref` correctly uses the BFF (`getApiBase()`). | `cmd/main.go` redirectBase default; `connectors.tsx:73` |
| H1b | HIGH | security | CSRF `state` is neither signed nor tenant-bound (contradicts the file's own doc); `collection_id` comes from a cookie. Re-verify against the cookie-resolved tenant. | `rag_connectors_oauth.go:175,217,244` |
| H2 | HIGH | security | `state` equality is not timing-safe → `subtle.ConstantTimeCompare`. | `rag_connectors_oauth.go:217` |
| M1 | MEDIUM | security | Cookies `Path:"/"` → PKCE verifier + collection exposed on every request for 10 min; scope to the callback path. | `rag_connectors_oauth.go:143-148` |
| M2a | MEDIUM | contract | Connector-provider enum in 3 hand-maintained places (OAuth 8 / connect 14 / theo-rag) with no contract test. | `rag_connectors_oauth.go:49-60`, `rag_dashboard.go:197-201` |
| M2b | MEDIUM | security | `Authorize`/`Callback` accept any map member; gate on `ClientID != ""` (match the advertised list). | `rag_connectors_oauth.go:165-169` |
| L4 | LOW | UX | `Callback` returns raw JSON on error to a browser; redirect to `/rag/connectors?connect_error=…`. | `rag_connectors_oauth.go:218-247` |
| L1/L2 | LOW | tests | No `Callback`-unauthed test + no tenant-binding assertion (would have surfaced B1). | `rag_connectors_oauth_test.go` |

## What both reviewers confirmed SOLID (no fix needed)

- `client_secret` confined to the exchanger, never in the handler struct, never logged (Rule 8). ✅
- `refresh_token` never reaches the browser (server-to-server connect). ✅
- No SSRF (provider URLs are server constants) / no open-redirect (targets are server config + allowlisted provider). ✅
- Provider gating: unconfigured provider → 422, never a half-configured consent or 5xx. ✅
- Wiring triad complete for every new symbol; DIP seams (`TokenExchanger`, `connectPoster`) justified by real second impls. ✅
- **M9 strategy passthrough is CLEAN:** fail-fast 422 enum validation, `omitempty` backward-compat proven byte-identical to pre-M9. Independently shippable. ✅

## Decision

- **M9** → READY (independently shippable).
- **M8 OAuth broker** → NEEDS_FIXES. The BLOCKER + HIGHs are the same root cause (browser-redirect endpoints treated as Bearer API). Fix design captured in #199; it is a security-sensitive rework that must go through `/to-plan` → `/implement` → `/review` and be validated in the LIVE Cleanroom+JUNTOS ceremony (a subtle auth bug is exactly what hermetic same-origin tests miss).
- The connect proxy (Slice 1) + providers endpoint + connectors page (non-OAuth parts) are sound; only the OAuth authorize/callback auth seam is blocked.

## Resolution (same day)

The BLOCKER + all HIGH/MEDIUM security findings were fixed in-slice (auth-model rework #199):
authorize/callback → root-mounted cookie-session auth (`KratosSessionTenantResolver`, fail-closed),
connect runs as the cookie-resolved tenant (`auth.WithUser`), `redirectBase` → BFF origin
(`CLOUD_PUBLIC_URL`), constant-time state compare, cookies scoped to `/v1/rag-connect`, `registered()`
(ClientID) guard, error-redirect to `?connect_error=`. New: 4 resolver fail-closed tests +
callback-unauthed + CSRF-not-called. **Independent re-review verdict: READY_TO_MERGE.**
Go 26/26 + vet + tsc + eslint clean. Residuals (cookie-clear-on-error hygiene, extra whoami
round-trip) are non-gating follow-ups. LIVE proof remains gated on Cleanroom+JUNTOS.
