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

// M17 T3.1 — the /v1/dashboard/rag BFF route set is READ-ONLY: every registered route
// is a GET; a mutating verb (POST/PUT/PATCH/DELETE) must be structurally absent (the
// roadmap risk-1 guard). Walks the actual mounted routes via chi.Walk.
func TestRagDashboard_ReadOnlyRouteSet(t *testing.T) {
	r := chi.NewRouter()
	h := routes.NewRagDashboardHandler(nil, quietLogger())
	passthrough := func(next http.Handler) http.Handler { return next } // stand-in for requireJWT
	mountRagDashboard(r, h, passthrough)

	methods := map[string]int{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/v1/dashboard/rag") {
			methods[method]++
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if methods["GET"] == 0 {
		t.Fatal("expected GET routes under /v1/dashboard/rag")
	}
	for _, mutating := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		if methods[mutating] != 0 {
			t.Fatalf("MUTATING verb %s found under /v1/dashboard/rag — the BFF MUST be read-only (%d routes)", mutating, methods[mutating])
		}
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

// M17 T3.1 — the SHIPPED dashboard keyResolver mints a rag:READ-ONLY key from the JWT
// tenant (least privilege). A regression to full scopes or a param-derived tenant fails here.
func TestNewRagDashboardKeyResolver_MintsReadOnlyFromJWTTenant(t *testing.T) {
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
	if len(stub.gotScopes) != 1 || stub.gotScopes[0] != "rag:read" {
		t.Fatalf("dashboard key MUST be minted rag:read-only (least privilege), got %+v", stub.gotScopes)
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
