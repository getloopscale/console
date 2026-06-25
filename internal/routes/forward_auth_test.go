// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// platform-api-gateway-edge-slice1 (M6) T0.2 — the ForwardAuth authz endpoint
// Traefik calls per request: validate the inbound theo_live_*, resolve the
// tenant, mint the per-tenant downstream key, and return it as an Authorization
// response header (200) — or fail closed (401/403/503) WITHOUT an Authorization.

package routes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// stubMinter is a test double for the per-tenant key broker.
type stubMinter struct {
	mu        sync.Mutex
	key       string
	err       error
	perTenant map[string]int
}

func (m *stubMinter) KeyForTenant(_ context.Context, tenantID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.perTenant == nil {
		m.perTenant = map[string]int{}
	}
	m.perTenant[tenantID]++
	return m.key, m.err
}

func resolveTo(uc *auth.UserContext, scopes []string, err error) APIKeyResolver {
	return func(_ context.Context, _ string) (*auth.UserContext, []string, error) {
		return uc, scopes, err
	}
}

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func serveForwardAuth(t *testing.T, h *ForwardAuthHandler) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/authz/forward", nil)
	req.Header.Set("Authorization", "Bearer theo_live_consumerKeyTenantA")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestForwardAuth_ValidKey_Returns200WithMintedAuthorization(t *testing.T) {
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{Subject: "u", TenantID: "tenant-a"}, []string{"memory:read"}, nil),
		&stubMinter{key: "theo_live_mintedForA"},
		"memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Authorization"); got != "Bearer theo_live_mintedForA" {
		t.Fatalf("want minted Authorization, got %q (must NOT be the client's key)", got)
	}
}

func TestForwardAuth_InvalidKey_Returns401_NoAuthorizationHeader(t *testing.T) {
	h := NewForwardAuthHandler(
		resolveTo(nil, nil, auth.ErrInvalidCredential),
		&stubMinter{key: "x"}, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	if got := rec.Header().Get("Authorization"); got != "" {
		t.Fatalf("a deny MUST NOT carry an Authorization header, got %q", got)
	}
}

func TestForwardAuth_DBError_Returns503_NotBadKey(t *testing.T) {
	// EC-1: an infra error is fail-closed (503), never 401 "bad key".
	h := NewForwardAuthHandler(
		resolveTo(nil, nil, auth.ErrBackendUnavailable),
		&stubMinter{key: "x"}, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 on backend-unavailable, got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatal("deny must not set Authorization")
	}
}

func TestForwardAuth_MintFailure_FailsClosed_NoAuthorization(t *testing.T) {
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{"memory:read"}, nil),
		&stubMinter{err: context.DeadlineExceeded}, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 on mint failure (fail-closed), got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatal("mint failure must NEVER set Authorization (fail-closed)")
	}
}

func TestForwardAuth_EmptyMint_FailsClosed(t *testing.T) {
	// EC-2: an empty minted key (broker returns "",nil) must fail-closed,
	// never inject "Bearer " (empty) upstream.
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{"memory:read"}, nil),
		&stubMinter{key: ""}, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 on empty mint, got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatalf("empty mint must not set Authorization, got %q", rec.Header().Get("Authorization"))
	}
}

func TestForwardAuth_MissingScope_Returns403(t *testing.T) {
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{"memory:write"}, nil),
		&stubMinter{key: "x"}, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 for missing scope, got %d", rec.Code)
	}
}

func TestForwardAuth_EmptyScopes_Returns403(t *testing.T) {
	// EC-8: a valid key with an empty scopes set yields 403, no panic.
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{}, nil),
		&stubMinter{key: "x"}, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 for empty scopes, got %d", rec.Code)
	}
}

func TestForwardAuth_ConcurrentRequestsSameTenant_MintOnce(t *testing.T) {
	// Race-aware: N concurrent ServeHTTP for the same tenant; assert all 200 and
	// the handler is race-free (run under -race). The mint-once singleflight
	// invariant itself is proven in themory/broker_test.go; here we assert the
	// handler does not corrupt the concurrent mint path.
	minter := &stubMinter{key: "theo_live_mintedForA"}
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{"memory:read"}, nil),
		minter, "memory:read", quietLogger(),
	)
	const n = 32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			rec := serveForwardAuth(t, h)
			if rec.Code != http.StatusOK {
				t.Errorf("concurrent request got %d", rec.Code)
			}
		}()
	}
	wg.Wait()
}
