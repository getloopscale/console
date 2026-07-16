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

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/rag"
)

// stubRagDataClient records the calls; it never talks to a real theo-rag.
type stubRagDataClient struct {
	listErr             error
	analyticsErr        error
	writeErr            error
	listCalls           int
	analytics           int
	analyticsGotColID   string
	analyticsGotSince   string
	analyticsRes        *rag.AnalyticsResult // when non-nil, overrides the default
	createCalls         int
	deleteCalls         int
	ingestCalls         int
	askCalls            int
	askGotStrategy      string // M9 — the strategy the handler forwarded to theo-rag
	listConnCalls       int
	syncCalls           int
	delConnCalls        int
}

func (s *stubRagDataClient) ListCollections(_ context.Context, _, _ int) (*rag.CollectionsResult, error) {
	s.listCalls++
	if s.listErr != nil {
		return nil, s.listErr
	}
	return &rag.CollectionsResult{Items: []rag.Collection{{ID: "col_1"}}}, nil
}

func (s *stubRagDataClient) Analytics(_ context.Context, collectionID, since string) (*rag.AnalyticsResult, error) {
	s.analytics++
	s.analyticsGotColID = collectionID
	s.analyticsGotSince = since
	if s.analyticsErr != nil {
		return nil, s.analyticsErr
	}
	if s.analyticsRes != nil {
		return s.analyticsRes, nil
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

func (s *stubRagDataClient) Ask(_ context.Context, in rag.AskInput) (json.RawMessage, error) {
	s.askCalls++
	s.askGotStrategy = in.Strategy
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return json.RawMessage(`{"answer":"hi [c1]","sources":[]}`), nil
}

func (s *stubRagDataClient) ListConnectors(_ context.Context) (*rag.ConnectionsResult, error) {
	s.listConnCalls++
	if s.listErr != nil {
		return nil, s.listErr
	}
	return &rag.ConnectionsResult{Items: []rag.Connection{{ID: "conn_1", ProviderID: "s3", CollectionID: "col_1", Status: "active"}}}, nil
}

func (s *stubRagDataClient) SyncConnector(_ context.Context, _ string) (json.RawMessage, error) {
	s.syncCalls++
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return json.RawMessage(`{"status":"enqueued","connection_id":"conn_1"}`), nil
}

func (s *stubRagDataClient) DeleteConnector(_ context.Context, _ string) error {
	s.delConnCalls++
	return s.writeErr
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

// v8-M7 scale — Analytics forwards the ?collection_id query param to the upstream data
// client AND propagates the `scale` block returned by theo-rag rc.80+ back to the caller.
func TestRagDashboard_Analytics_ForwardsCollectionID_PropagatesScale(t *testing.T) {
	h, stub := newRagDashboard()
	stub.analyticsRes = &rag.AnalyticsResult{
		Scale: &rag.ScaleObservability{
			CollectionID: "col_docs",
			Corpus:       rag.ScaleCorpus{Documents: 3, Chunks: 42, SizeBytes: 8192},
			Communities:  rag.ScaleCommunities{Total: 5, MaxLevel: 2, PerLevel: map[string]int{"0": 3, "1": 2}},
			Extraction:   rag.ScaleExtraction{Tokens: 12345},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/analytics?collection_id=col_docs&since=2026-07-01T00:00:00Z", nil).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"}))
	w := httptest.NewRecorder()
	h.Analytics(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.analyticsGotColID != "col_docs" {
		t.Fatalf("upstream must receive collection_id=col_docs, got %q", stub.analyticsGotColID)
	}
	if stub.analyticsGotSince != "2026-07-01T00:00:00Z" {
		t.Fatalf("upstream must receive since, got %q", stub.analyticsGotSince)
	}
	// The scale block MUST be in the response body — the whole point of T3.
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("response body is not JSON: %v", err)
	}
	scale, ok := out["scale"].(map[string]any)
	if !ok {
		t.Fatalf("response missing `scale` object: %s", w.Body.String())
	}
	if scale["collection_id"] != "col_docs" {
		t.Fatalf("scale.collection_id = %v, want col_docs", scale["collection_id"])
	}
	extraction, _ := scale["extraction"].(map[string]any)
	if extraction["tokens"].(float64) != 12345 {
		t.Fatalf("scale.extraction.tokens = %v, want 12345", extraction["tokens"])
	}
}

// v8-M7 backward-compat — without ?collection_id the upstream does NOT receive one AND
// the `scale` block is NOT emitted (M5 shape preserved for the un-selected view).
func TestRagDashboard_Analytics_NoCollectionID_NoScale(t *testing.T) {
	h, stub := newRagDashboard()
	// Upstream returns nil Scale (theo-rag omits it when collection_id is absent).
	stub.analyticsRes = &rag.AnalyticsResult{}
	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/analytics", nil).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"}))
	w := httptest.NewRecorder()
	h.Analytics(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if stub.analyticsGotColID != "" {
		t.Fatalf("upstream must NOT receive collection_id when caller omitted it, got %q", stub.analyticsGotColID)
	}
	if strings.Contains(w.Body.String(), `"scale"`) {
		t.Fatalf("response MUST NOT include `scale` when upstream did not (backward-compat): %s", w.Body.String())
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

// M21 T6.1 — every write/delete handler fails closed (401, no upstream) without a JWT.
func TestRagDashboard_AllWrites_NoJWT_Denied(t *testing.T) {
	h, stub := newRagDashboard()
	cases := []struct {
		name string
		call func(w http.ResponseWriter, r *http.Request)
		req  *http.Request
	}{
		{"deleteCollection", h.DeleteCollection, httptest.NewRequest(http.MethodDelete, "/v1/dashboard/rag/collections/col_x", nil)},
		{"ingestDocument", h.IngestDocument, httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/documents", strings.NewReader(`{"collection_id":"c","text":"t"}`))},
		{"deleteDocument", h.DeleteDocument, httptest.NewRequest(http.MethodDelete, "/v1/dashboard/rag/documents/doc_x", nil)},
		{"ask", h.Ask, httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/answers", strings.NewReader(`{"collection_id":"c","question":"q"}`))},
		{"listDocuments", h.ListDocuments, httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/documents?collection_id=c", nil)},
		{"listConnectors", h.ListConnectors, httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/connectors", nil)},
		{"syncConnector", h.SyncConnector, httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/connectors/conn_x/sync", nil)},
		{"deleteConnector", h.DeleteConnector, httptest.NewRequest(http.MethodDelete, "/v1/dashboard/rag/connectors/conn_x", nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.call(w, tc.req) // no auth.WithUser context → no tenant
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s: want 401 without JWT, got %d", tc.name, w.Code)
			}
		})
	}
	if stub.createCalls+stub.deleteCalls+stub.ingestCalls+stub.askCalls != 0 {
		t.Fatalf("no-JWT requests must NOT reach upstream, got calls c=%d d=%d i=%d a=%d",
			stub.createCalls, stub.deleteCalls, stub.ingestCalls, stub.askCalls)
	}
	if stub.listConnCalls+stub.syncCalls+stub.delConnCalls != 0 {
		t.Fatalf("no-JWT connector requests must NOT reach upstream, got lc=%d s=%d dc=%d",
			stub.listConnCalls, stub.syncCalls, stub.delConnCalls)
	}
}

// withID injects a chi URL param {id} for the unit-tested handler (no router in the test).
func withID(r *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// #191 — the connectors surface: list (rag:read), sync (rag:write), delete (rag:delete).
func TestRagDashboard_Connectors_HappyPath(t *testing.T) {
	tenant := func(r *http.Request) *http.Request {
		return r.WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"}))
	}

	t.Run("list returns the workspace connections", func(t *testing.T) {
		h, stub := newRagDashboard()
		w := httptest.NewRecorder()
		h.ListConnectors(w, tenant(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/connectors", nil)))
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
		}
		if stub.listConnCalls != 1 || !strings.Contains(w.Body.String(), "conn_1") {
			t.Fatalf("expected 1 upstream list with conn_1, got calls=%d body=%s", stub.listConnCalls, w.Body.String())
		}
	})

	t.Run("sync enqueues and passes through 202", func(t *testing.T) {
		h, stub := newRagDashboard()
		w := httptest.NewRecorder()
		req := withID(tenant(httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/connectors/conn_1/sync", nil)), "conn_1")
		h.SyncConnector(w, req)
		if w.Code != http.StatusAccepted || stub.syncCalls != 1 {
			t.Fatalf("want 202 + 1 sync call, got %d calls=%d (%s)", w.Code, stub.syncCalls, w.Body.String())
		}
	})

	t.Run("delete removes the connection (204)", func(t *testing.T) {
		h, stub := newRagDashboard()
		w := httptest.NewRecorder()
		req := withID(tenant(httptest.NewRequest(http.MethodDelete, "/v1/dashboard/rag/connectors/conn_1", nil)), "conn_1")
		h.DeleteConnector(w, req)
		if w.Code != http.StatusNoContent || stub.delConnCalls != 1 {
			t.Fatalf("want 204 + 1 delete call, got %d calls=%d", w.Code, stub.delConnCalls)
		}
	})

	t.Run("upstream error on list → 502", func(t *testing.T) {
		h, stub := newRagDashboard()
		stub.listErr = context.DeadlineExceeded
		w := httptest.NewRecorder()
		h.ListConnectors(w, tenant(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/connectors", nil)))
		if w.Code != http.StatusBadGateway {
			t.Fatalf("want 502, got %d", w.Code)
		}
	})
}

// M9 — the Ask BFF forwards the selected retrieval strategy to theo-rag so a user can reach
// GraphRAG (global/graph) from the dashboard.
func TestRagDashboard_Ask_ForwardsStrategy_M9(t *testing.T) {
	h, stub := newRagDashboard()
	body := `{"collection_id":"col_1","question":"what changed?","strategy":"global"}`
	w := httptest.NewRecorder()
	h.Ask(w, httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/answers", strings.NewReader(body)).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"})))
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.askGotStrategy != "global" {
		t.Fatalf("strategy not forwarded to theo-rag: want global, got %q", stub.askGotStrategy)
	}
}

// M9 — an unknown strategy is rejected fail-fast at the BFF boundary (422), never forwarded.
func TestRagDashboard_Ask_InvalidStrategy_422_M9(t *testing.T) {
	h, stub := newRagDashboard()
	body := `{"collection_id":"col_1","question":"q","strategy":"bogus"}`
	w := httptest.NewRecorder()
	h.Ask(w, httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/answers", strings.NewReader(body)).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"})))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.askCalls != 0 {
		t.Fatalf("upstream MUST NOT be called for an invalid strategy (fail-fast), got %d", stub.askCalls)
	}
}

// M9 — no strategy is backward-compatible: nothing is sent, theo-rag defaults to vector.
func TestRagDashboard_Ask_EmptyStrategy_OK_M9(t *testing.T) {
	h, stub := newRagDashboard()
	body := `{"collection_id":"col_1","question":"q"}`
	w := httptest.NewRecorder()
	h.Ask(w, httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/answers", strings.NewReader(body)).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"})))
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if stub.askGotStrategy != "" {
		t.Fatalf("empty strategy must stay empty (default vector upstream), got %q", stub.askGotStrategy)
	}
}
