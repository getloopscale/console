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

// The cross-tenant isolation + least-privilege tests for the SHIPPED keyResolver live in
// cmd/main_test.go (TestNewRagDashboardKeyResolver_*) — they drive the real
// newRagDashboardKeyResolver closure with a stub minter, so a regression to a full-scope
// or param-derived mint fails the build (not a mirrored copy).
