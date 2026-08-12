// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// gateway-themory-integration T1.1 — the MCP-aware resolve endpoint the Theo MCP
// Gateway's BrokerResolver calls per request: validate the inbound theo_live_*,
// run the SAME 3 guards as ForwardAuth (resolve → scope → cross-account), mint the
// per-tenant key, and return the full PRINCIPAL as JSON {tenant_id, downstream_key,
// scopes} (200) — or fail closed (401/403/503) WITHOUT a principal.

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

func authzReturning(owns bool, err error) AccountTenantAuthorizer {
	return func(_ context.Context, _, _ string) (bool, error) { return owns, err }
}

// memoryCaps wires a single "memory" capability binding for the tests.
func memoryCaps(minter TenantKeyMinter) map[string]MCPCapabilityBinding {
	return map[string]MCPCapabilityBinding{"memory": {Minter: minter, RequiredScope: "memory:read"}}
}

func mcpRequest(capability, authHeader string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, AuthzMCPResolvePath, nil)
	if capability != "" {
		r.Header.Set("X-Theo-Capability", capability)
	}
	if authHeader != "" {
		r.Header.Set("Authorization", authHeader)
	}
	return r
}

// T1.1 — ALLOW returns the principal JSON {tenant_id, downstream_key, scopes}.
func TestMCPResolve_Allow_ReturnsPrincipalJSON(t *testing.T) {
	minter := &stubMinter{key: "theo_live_minted_for_t1"}
	h := NewMCPResolveHandler(
		resolveTo(&auth.UserContext{TenantID: "t1", AccountID: "acc1"}, []string{"memory:read"}, nil),
		authzReturning(true, nil),
		memoryCaps(minter),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, mcpRequest("memory", "Bearer theo_live_consumer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var p mcpPrincipal
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode principal: %v", err)
	}
	if p.TenantID != "t1" || p.DownstreamKey != "theo_live_minted_for_t1" {
		t.Fatalf("principal mismatch: %+v", p)
	}
	if len(p.Scopes) != 1 || p.Scopes[0] != "memory:read" {
		t.Fatalf("scopes mismatch: %+v", p.Scopes)
	}
	// least-privilege: the broker received the consumer's own scopes.
	if got := minter.lastScopes; len(got) != 1 || got[0] != "memory:read" {
		t.Fatalf("broker must receive the consumer scopes, got %+v", got)
	}
}

// theo-workspace#10 — when the capability carries a ScopeTools mapping, the
// principal's `scopes` field MUST be the TRANSLATED MCP tool names (the gateway maps
// `scopes` → its tool allowlist via exact name match), NOT the raw data scopes. The
// DOWNSTREAM key is still minted with the raw data scopes (themory's per-verb gate).
func TestMCPResolve_Allow_TranslatesDataScopesToTools(t *testing.T) {
	minter := &stubMinter{key: "theo_live_minted_for_t1"}
	caps := map[string]MCPCapabilityBinding{"memory": {
		Minter:        minter,
		RequiredScope: "memory:read",
		ScopeTools: map[string][]string{
			"memory:read":   {"recall", "episodes", "search_memory", "list_memories"},
			"memory:write":  {"remember", "reflect", "add_skill", "execute_skill", "add_memories"},
			"memory:delete": {"forget", "forget_skill", "delete_memories"},
		},
	}}
	h := NewMCPResolveHandler(
		resolveTo(&auth.UserContext{TenantID: "t1", AccountID: "acc1"}, []string{"memory:read", "memory:write"}, nil),
		authzReturning(true, nil),
		caps,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, mcpRequest("memory", "Bearer theo_live_consumer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var p mcpPrincipal
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode principal: %v", err)
	}
	got := map[string]bool{}
	for _, s := range p.Scopes {
		got[s] = true
	}
	// read+write tools present:
	for _, want := range []string{"recall", "episodes", "remember", "reflect", "add_skill"} {
		if !got[want] {
			t.Errorf("expected tool %q in translated scopes, got %+v", want, p.Scopes)
		}
	}
	// delete-only tools absent (key lacks memory:delete):
	for _, forbidden := range []string{"forget", "delete_memories"} {
		if got[forbidden] {
			t.Errorf("delete tool %q must be ABSENT (no memory:delete), got %+v", forbidden, p.Scopes)
		}
	}
	// raw data scopes must NOT leak through as "tools":
	if got["memory:read"] || got["memory:write"] {
		t.Errorf("raw data scopes must be translated, not passed through: %+v", p.Scopes)
	}
	// the DOWNSTREAM key is still minted with the raw data scopes (themory per-verb gate):
	if gotS := minter.lastScopes; len(gotS) != 2 || gotS[0] != "memory:read" || gotS[1] != "memory:write" {
		t.Fatalf("broker must mint with the raw data scopes, got %+v", gotS)
	}
}

// T1.1 — an unknown capability is denied 403 BEFORE any resolve (fail-closed).
func TestMCPResolve_UnknownCapability_403(t *testing.T) {
	resolved := false
	h := NewMCPResolveHandler(
		func(context.Context, string) (*auth.UserContext, []string, error) {
			resolved = true
			return nil, nil, nil
		},
		authzReturning(true, nil),
		memoryCaps(&stubMinter{key: "k"}),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, mcpRequest("bogus", "Bearer theo_live_consumer"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unknown capability must be 403, got %d", rec.Code)
	}
	if resolved {
		t.Fatal("resolve must NOT run for an unknown capability (fail-closed before validation)")
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatal("a deny must never carry an Authorization header")
	}
}

// T1.1 — the deny matrix mirrors ForwardAuth (503 infra / 401 invalid / 403 scope|cross-account / 503 mint).
func TestMCPResolve_DenyMatrix(t *testing.T) {
	cases := []struct {
		name    string
		resolve APIKeyResolver
		authz   AccountTenantAuthorizer
		minter  *stubMinter
		want    int
	}{
		{"backend-unavailable→503", resolveTo(nil, nil, auth.ErrBackendUnavailable), authzReturning(true, nil), &stubMinter{key: "k"}, http.StatusServiceUnavailable},
		{"invalid-key→401", resolveTo(nil, nil, errors.New("bad key")), authzReturning(true, nil), &stubMinter{key: "k"}, http.StatusUnauthorized},
		{"missing-scope→403", resolveTo(&auth.UserContext{TenantID: "t1"}, []string{"other:read"}, nil), authzReturning(true, nil), &stubMinter{key: "k"}, http.StatusForbidden},
		{"cross-account→403", resolveTo(&auth.UserContext{TenantID: "t1", AccountID: "acc1"}, []string{"memory:read"}, nil), authzReturning(false, nil), &stubMinter{key: "k"}, http.StatusForbidden},
		{"authorize-dberror→503", resolveTo(&auth.UserContext{TenantID: "t1", AccountID: "acc1"}, []string{"memory:read"}, nil), authzReturning(false, errors.New("db down")), &stubMinter{key: "k"}, http.StatusServiceUnavailable},
		{"mint-failure→503", resolveTo(&auth.UserContext{TenantID: "t1"}, []string{"memory:read"}, nil), authzReturning(true, nil), &stubMinter{err: errors.New("mint down")}, http.StatusServiceUnavailable},
		{"empty-mint→503", resolveTo(&auth.UserContext{TenantID: "t1"}, []string{"memory:read"}, nil), authzReturning(true, nil), &stubMinter{key: ""}, http.StatusServiceUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := NewMCPResolveHandler(tc.resolve, tc.authz, memoryCaps(tc.minter), slog.New(slog.NewTextHandler(io.Discard, nil)))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, mcpRequest("memory", "Bearer theo_live_consumer"))
			if rec.Code != tc.want {
				t.Fatalf("want %d, got %d", tc.want, rec.Code)
			}
			if rec.Header().Get("Authorization") != "" {
				t.Fatal("a deny must never carry an Authorization header")
			}
			if strings.Contains(rec.Body.String(), "downstream_key") {
				t.Fatal("a deny must never return a principal body")
			}
		})
	}
}

// T1.1 — the minted key and the consumer key are NEVER logged (secret-free).
func TestMCPResolve_NeverLogsSecret(t *testing.T) {
	var logbuf strings.Builder
	minter := &stubMinter{key: "theo_live_minted_secret"}
	h := NewMCPResolveHandler(
		resolveTo(&auth.UserContext{TenantID: "t1"}, []string{"memory:read"}, nil),
		authzReturning(true, nil),
		memoryCaps(minter),
		slog.New(slog.NewTextHandler(&logbuf, nil)),
	)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, mcpRequest("memory", "Bearer theo_live_consumer_secret"))
	out := logbuf.String()
	if strings.Contains(out, "theo_live_minted_secret") || strings.Contains(out, "theo_live_consumer_secret") {
		t.Fatalf("secret leaked into logs:\n%s", out)
	}
}

// M16 T2.2 — a rag:read key exposes ONLY read tools; a rag:read+rag:write key adds the
// write tools; NO write tool is ever reachable under read-only (the confused-deputy guard,
// roadmap risk 1). Uses the PRODUCTION RagScopeTools map (drift-proof).
func TestMCPResolve_Rag_TranslatesDataScopesToTools(t *testing.T) {
	minter := &stubMinter{key: "theo_live_minted_for_t1"}
	caps := map[string]MCPCapabilityBinding{"rag": {
		Minter:        minter,
		RequiredScope: "rag:read",
		ScopeTools:    RagScopeTools,
	}}

	// (1) read-only key → only read tools, NO write tool.
	hRead := NewMCPResolveHandler(
		resolveTo(&auth.UserContext{TenantID: "t1", AccountID: "acc1"}, []string{"rag:read"}, nil),
		authzReturning(true, nil),
		caps,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	rec := httptest.NewRecorder()
	hRead.ServeHTTP(rec, mcpRequest("rag", "Bearer theo_live_consumer"))
	if rec.Code != http.StatusOK {
		t.Fatalf("read: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var pr mcpPrincipal
	if err := json.Unmarshal(rec.Body.Bytes(), &pr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	gotRead := map[string]bool{}
	for _, s := range pr.Scopes {
		gotRead[s] = true
	}
	for _, want := range []string{"ask", "list_collections", "retrieve"} {
		if !gotRead[want] {
			t.Errorf("rag:read must grant %q, got %+v", want, pr.Scopes)
		}
	}
	for _, forbidden := range []string{"create_collection", "ingest_document"} {
		if gotRead[forbidden] {
			t.Errorf("write tool %q MUST be ABSENT under rag:read (confused-deputy), got %+v", forbidden, pr.Scopes)
		}
	}
	if gotRead["rag:read"] {
		t.Errorf("raw data scope must be translated, not passed through: %+v", pr.Scopes)
	}

	// (2) read+write key → write tools now present.
	hRW := NewMCPResolveHandler(
		resolveTo(&auth.UserContext{TenantID: "t1", AccountID: "acc1"}, []string{"rag:read", "rag:write"}, nil),
		authzReturning(true, nil),
		caps,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	rec2 := httptest.NewRecorder()
	hRW.ServeHTTP(rec2, mcpRequest("rag", "Bearer theo_live_consumer"))
	var prw mcpPrincipal
	_ = json.Unmarshal(rec2.Body.Bytes(), &prw)
	gotRW := map[string]bool{}
	for _, s := range prw.Scopes {
		gotRW[s] = true
	}
	for _, want := range []string{"create_collection", "ingest_document"} {
		if !gotRW[want] {
			t.Errorf("rag:read+rag:write must grant %q, got %+v", want, prw.Scopes)
		}
	}
}

// M16 T2.2 — every @usetheo/rag-mcp tool is in EXACTLY one RagScopeTools bucket: no tool
// unmapped, no tool double-mapped (the tool-drift guard, roadmap risk 2). Guards the
// PRODUCTION map against a new tool landing without a scope.
func TestRagScopeTools_EveryToolInExactlyOneBucket(t *testing.T) {
	seen := map[string]int{}
	for scope, tools := range RagScopeTools {
		for _, tool := range tools {
			seen[tool]++
			if seen[tool] > 1 {
				t.Errorf("tool %q is in more than one bucket (double-mapped) — scope %q", tool, scope)
			}
		}
	}
	// every canonical tool mapped exactly once
	for _, tool := range RagMCPTools {
		if seen[tool] == 0 {
			t.Errorf("tool %q is not mapped to any rag scope (tool drift — add it to RagScopeTools)", tool)
		}
	}
	// no bucket maps a tool that isn't a real @usetheo/rag-mcp tool
	canonical := map[string]bool{}
	for _, tool := range RagMCPTools {
		canonical[tool] = true
	}
	for tool := range seen {
		if !canonical[tool] {
			t.Errorf("RagScopeTools maps %q which is not a known @usetheo/rag-mcp tool (RagMCPTools)", tool)
		}
	}
	// count sanity: total mapped == total canonical (exactly-once ⇒ equal sizes)
	if len(seen) != len(RagMCPTools) {
		t.Errorf("mapped tool count %d != canonical tool count %d", len(seen), len(RagMCPTools))
	}
}
