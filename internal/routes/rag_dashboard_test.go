package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/rag"
)

// stubRagDataClient records the calls; it never talks to a real theo-rag.
type stubRagDataClient struct {
	listErr      error
	analyticsErr error
	writeErr     error
	listCalls    int
	analytics    int
	createCalls  int
	deleteCalls  int
	ingestCalls  int
	askCalls     int
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

func (s *stubRagDataClient) ListDocuments(_ context.Context, _ string, _, _ int) (*rag.DocumentsResult, error) {
	s.listCalls++
	if s.listErr != nil {
		return nil, s.listErr
	}
	return &rag.DocumentsResult{Items: []rag.Document{{ID: "doc_1", Status: "ready"}}}, nil
}

func (s *stubRagDataClient) CreateCollection(_ context.Context, in rag.CreateCollectionInput) (*rag.Collection, error) {
	s.createCalls++
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	name := in.Name
	return &rag.Collection{ID: "col_new", Name: &name}, nil
}

func (s *stubRagDataClient) DeleteCollection(_ context.Context, _ string) error {
	s.deleteCalls++
	return s.writeErr
}

func (s *stubRagDataClient) IngestDocument(_ context.Context, _ rag.IngestInput) (json.RawMessage, error) {
	s.ingestCalls++
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return json.RawMessage(`{"id":"doc_new","status":"pending"}`), nil
}

func (s *stubRagDataClient) DeleteDocument(_ context.Context, _ string) error {
	s.deleteCalls++
	return s.writeErr
}

func (s *stubRagDataClient) Ask(_ context.Context, _ rag.AskInput) (json.RawMessage, error) {
	s.askCalls++
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return json.RawMessage(`{"answer":"hi [c1]","sources":[]}`), nil
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

// M21 T1.2 — an authenticated dashboard write reaches the create-collection proxy (201).
func TestRagDashboard_CreateCollection_Authenticated(t *testing.T) {
	h, stub := newRagDashboard()
	body := strings.NewReader(`{"name":"docs"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/collections", body).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"}))
	w := httptest.NewRecorder()
	h.CreateCollection(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.createCalls != 1 {
		t.Fatalf("expected 1 upstream create, got %d", stub.createCalls)
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["id"] != "col_new" {
		t.Fatalf("response id = %v, want col_new", out["id"])
	}
}

// M21 T1.2 — a write with NO JWT session is 401 and NEVER reaches the upstream (fail-closed).
func TestRagDashboard_CreateCollection_NoJWT_Denied(t *testing.T) {
	h, stub := newRagDashboard()
	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/collections", strings.NewReader(`{"name":"x"}`))
	w := httptest.NewRecorder()
	h.CreateCollection(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without JWT, got %d", w.Code)
	}
	if stub.createCalls != 0 {
		t.Fatalf("no-JWT write must not reach upstream, got %d calls", stub.createCalls)
	}
}
