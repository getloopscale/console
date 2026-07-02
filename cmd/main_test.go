// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/config"
	"github.com/usetheodev/theo-cloud/internal/routes"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func stubResolve(context.Context, string) (*auth.UserContext, []string, error) {
	return nil, nil, nil
}
func stubAuthorize(context.Context, string, string) (bool, error) { return true, nil }

// M14 T4.1 — buildRagForwardAuth is nil (feature off) when RAG_BASE_URL is unset.
// M16 T2.1 — the broker is ALSO nil when unset (no MCP binding either).
func TestBuildRagForwardAuth_Disabled_WhenBaseURLUnset(t *testing.T) {
	h, broker, err := buildRagForwardAuth(config.Config{RagBaseURL: ""}, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when RAG_BASE_URL unset: %v", err)
	}
	if h != nil {
		t.Fatal("handler should be nil (feature off) when RAG_BASE_URL is unset")
	}
	if broker != nil {
		t.Fatal("broker should be nil (feature off) when RAG_BASE_URL is unset")
	}
}

// M14 T4.1 — when RAG_BASE_URL is set (with a platform key), the handler is wired.
// M16 T2.1 (D2) — the broker is ALSO returned so the SAME broker can serve both the
// REST ForwardAuth handler AND the MCP-resolve rag binding (one mint cache).
func TestBuildRagForwardAuth_Wired_WhenConfigured(t *testing.T) {
	cfg := config.Config{
		RagBaseURL:          "http://theo-rag:8787",
		RagPlatformAdminKey: config.Secret("rag_live_platform"),
	}
	h, broker, err := buildRagForwardAuth(cfg, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when configured: %v", err)
	}
	if h == nil {
		t.Fatal("handler should be non-nil when RAG_BASE_URL is configured")
	}
	if broker == nil {
		t.Fatal("broker should be non-nil when configured (M16 D2 — exposed for the MCP binding)")
	}
}

// M21 T1.2 — the /v1/dashboard/rag BFF route set is READ+WRITE (lifted from the M17
// read-only): the reads (GET collections/analytics) AND the writes (POST collections,
// DELETE collections/{id}, POST documents, DELETE documents/{id}, POST answers) are all
// mounted, and NO unexpected verb slips in. Walks the actual mounted routes via chi.Walk.
func TestRagDashboard_ReadWriteRouteSet(t *testing.T) {
	r := chi.NewRouter()
	h := routes.NewRagDashboardHandler(nil, quietLogger())
	passthrough := func(next http.Handler) http.Handler { return next } // stand-in for requireJWT
	mountRagDashboard(r, h, passthrough)

	got := map[string]bool{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/v1/dashboard/rag") {
			got[method+" "+route] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	want := []string{
		"GET /v1/dashboard/rag/collections",
		"GET /v1/dashboard/rag/analytics",
		"POST /v1/dashboard/rag/collections",
		"DELETE /v1/dashboard/rag/collections/{id}",
		"POST /v1/dashboard/rag/documents",
		"DELETE /v1/dashboard/rag/documents/{id}",
		"POST /v1/dashboard/rag/answers",
	}
	for _, w := range want {
		if !got[w] {
			t.Fatalf("expected route %q mounted under /v1/dashboard/rag; got %+v", w, got)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("unexpected extra route under /v1/dashboard/rag: got %d routes, want %d (%+v)", len(got), len(want), got)
	}
}

// stubDashMinter records the args the SHIPPED newRagDashboardKeyResolver passes.
type stubDashMinter struct {
	gotAccount string
	gotTenant  string
	gotScopes  []string
	calls      int
}

func (s *stubDashMinter) KeyForTenantScoped(_ context.Context, accountID, tenantID string, scopes []string) (string, error) {
	s.calls++
	s.gotAccount, s.gotTenant, s.gotScopes = accountID, tenantID, scopes
	return "rag_live_" + tenantID, nil
}

// M21 T1.2 — the SHIPPED dashboard keyResolver mints a rag:read+write+delete key from the
// JWT tenant (the UI manages RAG). The tenant/account MUST come from the JWT, never a param.
func TestNewRagDashboardKeyResolver_MintsReadWriteFromJWTTenant(t *testing.T) {
	stub := &stubDashMinter{}
	resolve := newRagDashboardKeyResolver(stub)

	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"})
	key, err := resolve(ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if key != "rag_live_tenantA" {
		t.Fatalf("key = %q, want rag_live_tenantA", key)
	}
	if stub.gotTenant != "tenantA" || stub.gotAccount != "accA" {
		t.Fatalf("resolver must mint from the JWT tenant/account, got tenant=%q account=%q", stub.gotTenant, stub.gotAccount)
	}
	want := map[string]bool{"rag:read": true, "rag:write": true, "rag:delete": true}
	if len(stub.gotScopes) != len(want) {
		t.Fatalf("dashboard key MUST be minted rag:read+write+delete, got %+v", stub.gotScopes)
	}
	for _, s := range stub.gotScopes {
		if !want[s] {
			t.Fatalf("unexpected scope %q in the dashboard key (want exactly read+write+delete), got %+v", s, stub.gotScopes)
		}
	}
}

// M17 T3.1 — cross-tenant isolation on the SHIPPED resolver: tenant A resolves A's key,
// tenant B resolves B's — never a shared/cross key.
func TestNewRagDashboardKeyResolver_CrossTenantIsolation(t *testing.T) {
	resolve := newRagDashboardKeyResolver(&stubDashMinter{})
	keyA, _ := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"}))
	keyB, _ := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantB", AccountID: "accB"}))
	if keyA == keyB {
		t.Fatalf("cross-tenant leak: A and B resolved the same key %q", keyA)
	}
}

// M17 T3.1 — fail-closed on the SHIPPED resolver: no JWT tenant → error, minter NOT called.
func TestNewRagDashboardKeyResolver_FailsClosed(t *testing.T) {
	stub := &stubDashMinter{}
	resolve := newRagDashboardKeyResolver(stub)
	for _, ctx := range []context.Context{
		context.Background(),
		auth.WithUser(context.Background(), &auth.UserContext{TenantID: ""}),
	} {
		if _, err := resolve(ctx); err == nil {
			t.Fatal("expected error with no authenticated tenant (fail-closed)")
		}
	}
	if stub.calls != 0 {
		t.Fatalf("minter MUST NOT be called without a tenant, got %d calls", stub.calls)
	}
}
