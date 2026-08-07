# Blueprint — Graduate `rag:*` to customer-issuable scopes (theo-cloud #168)

**Cycle:** DISCOVER (2026-07-05) — direct-code research against the `observability:*` graduation precedent (the most accurate source for an internal parity change).
**Issue:** theo-cloud #168 — the dashboard "Create API Key" dialog lists `RAG:READ`/`RAG:WRITE` as "Reserved for future surfaces", so a customer cannot self-serve a `theo_live_*` key with `rag:*` scopes, even though the RAG edge broker is GA.

## § 1 — Root finding: the exact scope set to activate

The RAG data-plane broker + BFF define the supported customer scope set as **`rag:read`, `rag:write`, `rag:delete`** (NOT `rag:admin` — that is the broker-held key-lifecycle scope, never customer-issuable):

- `cmd/main.go:66-67` — `rag.NewBroker(ragAdmin, 1024, time.Hour, []string{"rag:read", "rag:write", "rag:delete"})` (the broker's supported/intersect set).
- `cmd/main.go:71` — `NewForwardAuthHandler(..., "rag:read", ...)` (the forward-auth-rag required scope).
- `cmd/main.go:146` — the BFF dashboard-rag minter uses `[]string{"rag:read", "rag:write", "rag:delete"}`.
- theo-rag data plane (per its CLAUDE.md) enforces `rag:read|write|delete` per verb; `rag:admin` = key lifecycle only.

The broker "intersects the consumer's scopes with the gateway's supported set" (`internal/routes/forward_auth.go:116-118`), so a consumer key carrying `rag:read/write/delete` is minted per-tenant at least-privilege — no change needed to the broker; only the **customer-issuance gate** (`validScopes`) + the **dashboard UI** need to graduate `rag:*`.

## § 2 — The precedent: how `observability:*` graduated (M37-M46)

Per the theo-cloud CHANGELOG ("Activate the `observability:*` customer key scope"), the graduation touched exactly two sites:

1. `internal/routes/api_keys.go` — `validScopes` gained `observability:read/write/delete/admin`; `traces:*` removed from `reservedScopes`.
2. `dashboard/src/pages/api-keys.tsx` — observability scopes moved from the reserved list to `ACTIVE_SCOPES` (checkboxes) with descriptions.

`rag:*` follows the identical shape.

## § 3 — Current state (both edit sites)

**Backend — `internal/routes/api_keys.go`:**
- `validScopes` (`:90-99`): memory:read/write/delete/admin + observability:read/write/delete/admin. **No rag.**
- `reservedScopes` (`:105-112`): `rag:read`, `rag:write`, agents:read/invoke, deploys:read/write. **Missing `rag:delete`** (the reserved list is incomplete vs the broker's supported set).
- Validation loop (`:334-345`): `reservedScopes[s]` → 503 `scope_not_yet_active`; `!validScopes[s]` → 400 `UNKNOWN_SCOPE`.

**Dashboard — `dashboard/src/pages/api-keys.tsx`:**
- `ACTIVE_SCOPES` (`:65-74`): memory:* + observability:* (id, label, description).
- `RESERVED_SCOPES` (`:76-79`): `{id:'rag:read', vertical:'Retrieval'}`, `{id:'rag:write', vertical:'Retrieval'}` (+ agents/deploys elsewhere).

## § 4 — Test gap (coverage finding)

There is **no `api_keys_test.go`** in `internal/routes/` — the `CreateKey` scope-validation (reserved→503, unknown→400, empty→400, valid→proceed) is **untested**. The fix will close this gap with a hermetic handler test.

**Test infra available (parsimony rung 4 — reuse):**
- `github.com/DATA-DOG/go-sqlmock v1.5.2` (in go.mod) — mock `*sql.DB`.
- `auth.WithUser(ctx, &auth.UserContext{...})` injects the session user (pattern in `internal/routes/me_test.go:30`).
- `httptest.NewRequest` + `httptest.NewRecorder`.
- Negative scope cases return BEFORE any DB op (validation precedes INSERT), so a sqlmock with no expectations suffices; the positive case expects the INSERT.

The dashboard has `dashboard/src/pages/api-keys.test.tsx` (vitest) — extend it to assert rag scopes render as selectable active scopes.

## § 5 — ADRs

### ADR-1 — Activate `rag:read` + `rag:write` + `rag:delete` (NOT `rag:admin`)
**Decision:** graduate the three data scopes the broker + BFF + theo-rag actually support.
**Rationale:** the broker's supported set is `[rag:read, rag:write, rag:delete]` (`cmd/main.go:66-67`); `rag:admin` is theo-rag's key-lifecycle scope held only by the platform-admin/broker, never minted to a consumer (least privilege / CWE-441 anti-escalation). The current `reservedScopes` omission of `rag:delete` is a pre-existing incompleteness this fix corrects.
**Rejected — also activate `rag:admin`:** scope-creep beyond the broker's set; a customer key with `rag:admin` could not be minted per-tenant anyway (not in the intersect set) → dead scope. **Rejected — activate only read+write (issue's literal ask):** would leave `rag:delete` unusable despite the broker supporting it — an incomplete surface.

### ADR-2 — Two-site edit + close the test gap (no broker/edge change)
**Decision:** edit `validScopes`/`reservedScopes` (Go) + `ACTIVE_SCOPES`/`RESERVED_SCOPES` (dashboard); add a hermetic `api_keys_test.go` + extend `api-keys.test.tsx`.
**Rationale:** the edge (`forward-auth-rag`) already intersects consumer scopes — no broker change (KISS / the precedent did the same). The missing scope-validation test is a real gap closed as part of the fix (TDD proves the graduation).
**Rejected — extract a `validateScopes` function:** unnecessary refactor; the handler-level test reaches the same branches via sqlmock (YAGNI).

## § 6 — Citations (all verified during discovery)

- `internal/routes/api_keys.go` (:86-112 scope maps, :277-345 CreateKey + validation, :122-141 handler struct).
- `cmd/main.go` (:65-71 rag broker wiring + required scope, :146 BFF minter scopes).
- `internal/routes/forward_auth.go` (:44-50, :116-118 intersect/least-privilege).
- `dashboard/src/pages/api-keys.tsx` (:65-79 ACTIVE_SCOPES + RESERVED_SCOPES).
- `internal/routes/me_test.go` (:29-30 auth.WithUser + sqlmock pattern).
- `go.mod` (DATA-DOG/go-sqlmock v1.5.2).
- theo-cloud `CHANGELOG.md` (observability:* graduation entry — the precedent).
