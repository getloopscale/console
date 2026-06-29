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

	"github.com/usetheodev/theo-cloud/internal/auth"
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
