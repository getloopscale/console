// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// platform-api-gateway-edge-slice1 (M6) T0.2 — the ForwardAuth authz endpoint
// Traefik calls per request: validate the inbound theo_live_*, resolve the
// tenant, mint the per-tenant downstream key, and return it as an Authorization
// response header (200) — or fail closed (401/403/503) WITHOUT an Authorization.

package routes

import (
	"context"
	"errors"
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
	mu          sync.Mutex
	key         string
	err         error
	perTenant   map[string]int
	lastAccount string   // M1: captured accountID threaded by the handler
	lastScopes  []string // captured for the least-privilege assertion
}

func (m *stubMinter) KeyForTenantScoped(_ context.Context, accountID, tenantID string, scopes []string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.perTenant == nil {
		m.perTenant = map[string]int{}
	}
	m.perTenant[tenantID]++
	m.lastAccount = accountID
	m.lastScopes = scopes
	return m.key, m.err
}

func (m *stubMinter) mintCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, c := range m.perTenant {
		n += c
	}
	return n
}

func resolveTo(uc *auth.UserContext, scopes []string, err error) APIKeyResolver {
	return func(_ context.Context, _ string) (*auth.UserContext, []string, error) {
		return uc, scopes, err
	}
}

// authReturns is a stub ownership authorizer. allowAuth is the default used by
// tests whose resolved UserContext has no AccountID (the check is skipped, so the
// authorizer is never actually invoked).
func authReturns(owns bool, err error) AccountTenantAuthorizer {
	return func(_ context.Context, _, _ string) (bool, error) { return owns, err }
}

var allowAuth = authReturns(true, nil)

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
		allowAuth, "memory:read", quietLogger(),
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
		&stubMinter{key: "x"}, allowAuth, "memory:read", quietLogger(),
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
		&stubMinter{key: "x"}, allowAuth, "memory:read", quietLogger(),
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
		&stubMinter{err: context.DeadlineExceeded}, allowAuth, "memory:read", quietLogger(),
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
		&stubMinter{key: ""}, allowAuth, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 on empty mint, got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatalf("empty mint must not set Authorization, got %q", rec.Header().Get("Authorization"))
	}
}

func TestForwardAuth_MintsWithConsumerScopes_NoEscalation(t *testing.T) {
	// /review HIGH (least privilege): a read-only consumer must NOT receive a
	// write/delete-capable minted key. The handler mints with the CONSUMER's own
	// scopes, not a fixed superset.
	minter := &stubMinter{key: "theo_live_mintedForA"}
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{"memory:read"}, nil),
		minter, allowAuth, "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if len(minter.lastScopes) != 1 || minter.lastScopes[0] != "memory:read" {
		t.Fatalf("SCOPE ESCALATION: minted with %v, want only the consumer's [memory:read]", minter.lastScopes)
	}
}

func TestForwardAuth_MissingScope_Returns403(t *testing.T) {
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a"}, []string{"memory:write"}, nil),
		&stubMinter{key: "x"}, allowAuth, "memory:read", quietLogger(),
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
		&stubMinter{key: "x"}, allowAuth, "memory:read", quietLogger(),
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
		minter, allowAuth, "memory:read", quietLogger(),
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

// --- M1: cross-account guard (lazy validation) --------------------------------

func TestForwardAuth_AccountOwnsTenant_Mints200_ThreadsAccount(t *testing.T) {
	minter := &stubMinter{key: "theo_live_minted"}
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a", AccountID: "acct-a"}, []string{"memory:read"}, nil),
		minter, authReturns(true, nil), "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 for account-owned tenant, got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "Bearer theo_live_minted" {
		t.Fatalf("want minted Authorization, got %q", rec.Header().Get("Authorization"))
	}
	if minter.lastAccount != "acct-a" {
		t.Fatalf("handler must thread accountID to the broker, got %q", minter.lastAccount)
	}
}

func TestForwardAuth_CrossAccount_Returns403_NoMint_NoAuthorization(t *testing.T) {
	minter := &stubMinter{key: "theo_live_minted"}
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a", AccountID: "acct-evil"}, []string{"memory:read"}, nil),
		minter, authReturns(false, nil), "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 for cross-account credential, got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatal("cross-account deny must NOT set Authorization")
	}
	if minter.mintCount() != 0 {
		t.Fatalf("cross-account must NOT mint, got %d mints", minter.mintCount())
	}
}

func TestForwardAuth_LegacyNullAccount_SkipsCheck_200(t *testing.T) {
	// A legacy key (AccountID == "") predates accounts; the ownership check is
	// skipped (M0 backward-compat) even if the authorizer would deny/error.
	minter := &stubMinter{key: "theo_live_minted"}
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a", AccountID: ""}, []string{"memory:read"}, nil),
		minter, authReturns(false, errors.New("must not be called")), "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("legacy NULL-account key must mint (200), got %d", rec.Code)
	}
}

func TestForwardAuth_AuthorizeDBError_FailsClosed503(t *testing.T) {
	minter := &stubMinter{key: "theo_live_minted"}
	h := NewForwardAuthHandler(
		resolveTo(&auth.UserContext{TenantID: "tenant-a", AccountID: "acct-a"}, []string{"memory:read"}, nil),
		minter, authReturns(false, errors.New("db down")), "memory:read", quietLogger(),
	)
	rec := serveForwardAuth(t, h)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("authorize DB error must fail closed (503), got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatal("authorize error must NOT set Authorization")
	}
	if minter.mintCount() != 0 {
		t.Fatalf("must not mint on authorize error, got %d", minter.mintCount())
	}
}
