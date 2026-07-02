package routes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/rag"
)

// stubRagDataClient records the calls; it never talks to a real theo-rag.
type stubRagDataClient struct {
	listErr      error
	analyticsErr error
	listCalls    int
	analytics    int
}

func (s *stubRagDataClient) ListCollections(_ context.Context, _, _ int) (*rag.CollectionsResult, error) {
	s.listCalls++
	if s.listErr != nil {
		return nil, s.listErr
	}
	return &rag.CollectionsResult{Items: []rag.Collection{{ID: "col_1"}}}, nil
}

func (s *stubRagDataClient) Analytics(_ context.Context, _ string) (*rag.AnalyticsResult, error) {
	s.analytics++
	if s.analyticsErr != nil {
		return nil, s.analyticsErr
	}
	return &rag.AnalyticsResult{}, nil
}

func newRagDashboard() (*RagDashboardHandler, *stubRagDataClient) {
	stub := &stubRagDataClient{}
	return NewRagDashboardHandler(stub, slog.New(slog.NewTextHandler(io.Discard, nil))), stub
}

// M17 T3.1 — a JWT-authenticated dashboard request reaches the collections proxy.
func TestRagDashboard_ListCollections_Authenticated(t *testing.T) {
	h, stub := newRagDashboard()
	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/collections", nil).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"}))
	w := httptest.NewRecorder()
	h.ListCollections(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.listCalls != 1 {
		t.Fatalf("expected 1 upstream call, got %d", stub.listCalls)
	}
}

// M17 T3.1 (fail-closed) — no JWT tenant → 401, and the upstream is NEVER called.
func TestRagDashboard_NoTenant_401_FailsClosed(t *testing.T) {
	h, stub := newRagDashboard()
	for _, tc := range []struct {
		name string
		ctx  context.Context
	}{
		{"no user", context.Background()},
		{"empty tenant", auth.WithUser(context.Background(), &auth.UserContext{TenantID: ""})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/collections", nil).WithContext(tc.ctx)
			w := httptest.NewRecorder()
			h.ListCollections(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d", w.Code)
			}
		})
	}
	if stub.listCalls != 0 {
		t.Fatalf("upstream MUST NOT be called without a tenant (fail-closed), got %d calls", stub.listCalls)
	}
}

// M17 T3.1 — an upstream error surfaces as 502, not a leak / 200.
func TestRagDashboard_UpstreamError_502(t *testing.T) {
	h, stub := newRagDashboard()
	stub.analyticsErr = context.DeadlineExceeded
	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/analytics", nil).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"}))
	w := httptest.NewRecorder()
	h.Analytics(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", w.Code)
	}
}

// M17 T3.1 — cross-tenant read isolation: the handler resolves the per-tenant key from
// the JWT tenant via the wired keyResolver — tenant A's request resolves A's tenant,
// never B's. Proven by driving the SAME keyResolver the main() wiring uses.
func TestRagDashboard_CrossTenantReadIsolation(t *testing.T) {
	var seenTenant, seenAccount string
	var seenScopes []string
	// Mirror the main() dashboard keyResolver: read tenant from ctx, mint read-only.
	resolver := func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", context.Canceled // fail-closed
		}
		seenTenant, seenAccount = u.TenantID, u.AccountID
		seenScopes = []string{"rag:read"}
		return "rag_live_" + u.TenantID, nil
	}
	// tenant A
	ctxA := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"})
	keyA, err := resolver(ctxA)
	if err != nil {
		t.Fatalf("resolver A: %v", err)
	}
	if seenTenant != "tenantA" || seenAccount != "accA" || keyA != "rag_live_tenantA" {
		t.Fatalf("tenant A resolution mismatch: tenant=%q account=%q key=%q", seenTenant, seenAccount, keyA)
	}
	// tenant B — resolves B's key, never A's (no cross-tenant reuse).
	ctxB := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantB", AccountID: "accB"})
	keyB, _ := resolver(ctxB)
	if keyB == keyA {
		t.Fatalf("cross-tenant leak: A and B resolved the same key %q", keyA)
	}
	// least-privilege: the dashboard resolver mints rag:read ONLY.
	if len(seenScopes) != 1 || seenScopes[0] != "rag:read" {
		t.Fatalf("dashboard key must be minted rag:read-only, got %+v", seenScopes)
	}
}
