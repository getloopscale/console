package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
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
	connectCalls        int    // M8
	connectGotProvider  string // M8 — the provider the handler forwarded
	connectGotBody      string // M8 — the opaque credential body the handler forwarded
	graphGotColID       string // M10 — the collection the graph handler forwarded
	graphGotLevel       string // M10
	graphGotLimit       string // M10
	commGotColID        string // M10 — the collection the communities handler forwarded
	graphErr            error  // M10 — when set, GraphView/Communities fail
	uploadCalls         int    // M11 — file upload
	uploadGotColID      string // M11
	uploadGotFilename   string // M11
	uploadGotMode       string // M11
	uploadGotFileBody   string // M11 — the file bytes the handler streamed through
	chunkErr            error  // chunk-editor — when set, chunk methods fail
	listChunksGotDocID  string // chunk-editor
	getChunkGotID       string // chunk-editor
	updateChunkGotID    string // chunk-editor
	updateChunkGotBody  string // chunk-editor — the opaque {text} body forwarded
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

func (s *stubRagDataClient) UploadDocumentFile(_ context.Context, in rag.UploadFileInput) (json.RawMessage, error) {
	s.uploadCalls++
	s.uploadGotColID, s.uploadGotFilename, s.uploadGotMode = in.CollectionID, in.Filename, in.Mode
	if in.File != nil {
		b, _ := io.ReadAll(in.File)
		s.uploadGotFileBody = string(b)
	}
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return json.RawMessage(`{"id":"doc_up","status":"processing"}`), nil
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

func (s *stubRagDataClient) ConnectConnector(_ context.Context, provider string, body json.RawMessage) (json.RawMessage, error) {
	s.connectCalls++
	s.connectGotProvider = provider
	s.connectGotBody = string(body)
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return json.RawMessage(`{"id":"conn_new","provider_id":"` + provider + `","status":"active"}`), nil
}

func (s *stubRagDataClient) ListWikiPages(_ context.Context, _ string) (json.RawMessage, error) {
	return json.RawMessage(`{"items":[]}`), nil
}
func (s *stubRagDataClient) GetWikiPage(_ context.Context, _ string) (json.RawMessage, error) {
	return json.RawMessage(`{"id":"doc_x","name":"Page","status":"ready","content":"","okf":{"type":"concept"}}`), nil
}
func (s *stubRagDataClient) CreateWikiPage(_ context.Context, _ json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"id":"doc_x","status":"pending"}`), nil
}
func (s *stubRagDataClient) UpdateWikiPage(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"id":"doc_x","status":"pending"}`), nil
}
func (s *stubRagDataClient) DeleteWikiPage(_ context.Context, _ string) error {
	return nil
}
func (s *stubRagDataClient) WikiIndex(_ context.Context, _ string) (json.RawMessage, error) {
	return json.RawMessage(`{"markdown":"# tables\n\n* [Customers](tables/customers.md) — The customer table.\n"}`), nil
}
func (s *stubRagDataClient) WikiLog(_ context.Context, _ string) (json.RawMessage, error) {
	return json.RawMessage(`{"markdown":"# Directory Update Log\n"}`), nil
}

func (s *stubRagDataClient) GraphView(_ context.Context, collectionID, level, limit string) (json.RawMessage, error) {
	s.graphGotColID, s.graphGotLevel, s.graphGotLimit = collectionID, level, limit
	if s.graphErr != nil {
		return nil, s.graphErr
	}
	return json.RawMessage(`{"nodes":[{"id":"e1","name":"Alice","type":"person","degree":3,"community_key":"0:1"}],"edges":[]}`), nil
}

func (s *stubRagDataClient) Communities(_ context.Context, collectionID, level string) (json.RawMessage, error) {
	s.commGotColID = collectionID
	if s.graphErr != nil {
		return nil, s.graphErr
	}
	return json.RawMessage(`{"communities":[{"community_key":"0:1","level":` + level + `,"size":5,"summary":"about people","member_names":["Alice"]}]}`), nil
}

func (s *stubRagDataClient) CommunityReport(_ context.Context, collectionID, communityKey, _ string) (json.RawMessage, error) {
	s.commGotColID = collectionID
	if s.graphErr != nil {
		return nil, s.graphErr
	}
	return json.RawMessage(`{"community_key":"` + communityKey + `","title":"The People Community","summary":"about people","full_content":"# Report\n\nAlice leads.","findings":[{"summary":"Alice leads"}]}`), nil
}

func (s *stubRagDataClient) ListDocumentChunks(_ context.Context, documentID, _ string) (json.RawMessage, error) {
	s.listChunksGotDocID = documentID
	if s.chunkErr != nil {
		return nil, s.chunkErr
	}
	return json.RawMessage(`{"items":[{"id":"chk_1","index":0,"text":"first chunk"},{"id":"chk_2","index":1,"text":"second chunk"}],"next_cursor":null}`), nil
}

func (s *stubRagDataClient) GetChunk(_ context.Context, id string) (json.RawMessage, error) {
	s.getChunkGotID = id
	if s.chunkErr != nil {
		return nil, s.chunkErr
	}
	return json.RawMessage(`{"id":"` + id + `","index":0,"text":"first chunk"}`), nil
}

func (s *stubRagDataClient) UpdateChunk(_ context.Context, id string, body json.RawMessage) (json.RawMessage, error) {
	s.updateChunkGotID = id
	s.updateChunkGotBody = string(body)
	if s.chunkErr != nil {
		return nil, s.chunkErr
	}
	return json.RawMessage(`{"id":"` + id + `","text":"edited","reembedded":true}`), nil
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
		{"updateWikiPage", h.UpdateWikiPage, withID(httptest.NewRequest(http.MethodPut, "/v1/dashboard/rag/wiki/pages/doc_x", strings.NewReader(`{"content":"x"}`)), "doc_x")},
		{"deleteWikiPage", h.DeleteWikiPage, withID(httptest.NewRequest(http.MethodDelete, "/v1/dashboard/rag/wiki/pages/doc_x", nil), "doc_x")},
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

// withProvider injects a chi URL param {provider} (M8 connect route).
func withProvider(r *http.Request, provider string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("provider", provider)
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

	// M8 — connect forwards the provider (path) + the credential body (opaque) to theo-rag.
	t.Run("connect forwards provider + opaque credential body (201)", func(t *testing.T) {
		h, stub := newRagDashboard()
		w := httptest.NewRecorder()
		body := `{"collection_id":"col_1","seed_url":"https://example.com","max_depth":1}`
		req := withProvider(tenant(httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/connectors/web/connect", strings.NewReader(body))), "web")
		h.ConnectConnector(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("want 201, got %d (%s)", w.Code, w.Body.String())
		}
		if stub.connectCalls != 1 || stub.connectGotProvider != "web" {
			t.Fatalf("want 1 connect call for web, got calls=%d provider=%q", stub.connectCalls, stub.connectGotProvider)
		}
		if stub.connectGotBody != body {
			t.Fatalf("credential body must be forwarded opaquely byte-for-byte, got %q", stub.connectGotBody)
		}
	})

	// M8 — an unknown provider is rejected fail-fast (422), never forwarded upstream.
	t.Run("connect rejects an unknown provider (422, no upstream)", func(t *testing.T) {
		h, stub := newRagDashboard()
		w := httptest.NewRecorder()
		req := withProvider(tenant(httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/connectors/bogus/connect", strings.NewReader(`{}`))), "bogus")
		h.ConnectConnector(w, req)
		if w.Code != http.StatusUnprocessableEntity {
			t.Fatalf("want 422, got %d (%s)", w.Code, w.Body.String())
		}
		if stub.connectCalls != 0 {
			t.Fatalf("an unknown provider MUST NOT reach upstream (fail-fast), got %d calls", stub.connectCalls)
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

func TestRagDashboard_GraphView_M10(t *testing.T) {
	h, stub := newRagDashboard()
	req := withID(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/collections/col_1/graph?level=1&limit=50", nil).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"})), "col_1")
	w := httptest.NewRecorder()
	h.GraphView(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.graphGotColID != "col_1" || stub.graphGotLevel != "1" || stub.graphGotLimit != "50" {
		t.Fatalf("scope/params not forwarded: col=%q level=%q limit=%q", stub.graphGotColID, stub.graphGotLevel, stub.graphGotLimit)
	}
	if !strings.Contains(w.Body.String(), `"community_key":"0:1"`) {
		t.Fatalf("graph JSON not forwarded opaquely: %s", w.Body.String())
	}
}

func TestRagDashboard_Communities_M10(t *testing.T) {
	h, stub := newRagDashboard()
	req := withID(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/collections/col_1/communities?level=0", nil).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"})), "col_1")
	w := httptest.NewRecorder()
	h.Communities(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if stub.commGotColID != "col_1" {
		t.Fatalf("collection not forwarded: %q", stub.commGotColID)
	}
	if !strings.Contains(w.Body.String(), `"about people"`) {
		t.Fatalf("communities JSON not forwarded: %s", w.Body.String())
	}
}

func TestRagDashboard_GraphView_Unauthed_M10(t *testing.T) {
	h, _ := newRagDashboard()
	req := withID(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/collections/col_1/graph", nil), "col_1") // no tenant
	w := httptest.NewRecorder()
	h.GraphView(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without a tenant, got %d", w.Code)
	}
}

// M11 — the upload handler parses the multipart file part + collection_id and streams
// them to the data client, returning theo-rag's async 202. Auth-gated.
func TestRagDashboard_UploadDocumentFile_ParsesMultipartAndProxies(t *testing.T) {
	stub := &stubRagDataClient{}
	h := NewRagDashboardHandler(stub, slog.Default())

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("collection_id", "col_docs")
	_ = mw.WriteField("mode", "fast")
	part, _ := mw.CreateFormFile("file", "report.pdf")
	_, _ = part.Write([]byte("%PDF-1.4 body"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/documents/file", &buf).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"}))
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()

	h.UploadDocumentFile(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if stub.uploadCalls != 1 {
		t.Fatalf("uploadCalls = %d, want 1", stub.uploadCalls)
	}
	if stub.uploadGotColID != "col_docs" || stub.uploadGotFilename != "report.pdf" || stub.uploadGotMode != "fast" {
		t.Fatalf("forwarded fields mismatch: colID=%q file=%q mode=%q", stub.uploadGotColID, stub.uploadGotFilename, stub.uploadGotMode)
	}
	if stub.uploadGotFileBody != "%PDF-1.4 body" {
		t.Fatalf("streamed body = %q, want %%PDF-1.4 body", stub.uploadGotFileBody)
	}
}

// M11 — a request without a file part is a 422 (fail-fast), not a proxied empty upload.
func TestRagDashboard_UploadDocumentFile_MissingFileIs422(t *testing.T) {
	stub := &stubRagDataClient{}
	h := NewRagDashboardHandler(stub, slog.Default())
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("collection_id", "col_docs")
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/documents/file", &buf).
		WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"}))
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	h.UploadDocumentFile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if stub.uploadCalls != 0 {
		t.Fatalf("uploadCalls = %d, want 0 (no proxy on missing file)", stub.uploadCalls)
	}
}

// M11 — unauthenticated upload is 401, never reaches the data client.
func TestRagDashboard_UploadDocumentFile_Unauthenticated401(t *testing.T) {
	stub := &stubRagDataClient{}
	h := NewRagDashboardHandler(stub, slog.Default())
	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/documents/file", strings.NewReader(""))
	rec := httptest.NewRecorder()
	h.UploadDocumentFile(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if stub.uploadCalls != 0 {
		t.Fatalf("uploadCalls = %d, want 0", stub.uploadCalls)
	}
}

func TestRagDashboard_ChunkEditor(t *testing.T) {
	t.Run("list document chunks forwards doc id + returns items", func(t *testing.T) {
		h, stub := newRagDashboard()
		req := withID(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/documents/doc_1/chunks", nil).
			WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"})), "doc_1")
		w := httptest.NewRecorder()
		h.ListDocumentChunks(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
		}
		if stub.listChunksGotDocID != "doc_1" {
			t.Fatalf("doc id not forwarded: %q", stub.listChunksGotDocID)
		}
		if !strings.Contains(w.Body.String(), `"id":"chk_1"`) {
			t.Fatalf("chunks not forwarded opaquely: %s", w.Body.String())
		}
	})

	t.Run("update chunk forwards body + returns reembedded", func(t *testing.T) {
		h, stub := newRagDashboard()
		req := withID(httptest.NewRequest(http.MethodPatch, "/v1/dashboard/rag/chunks/chk_9", strings.NewReader(`{"text":"corrected"}`)).
			WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"})), "chk_9")
		w := httptest.NewRecorder()
		h.UpdateChunk(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
		}
		if stub.updateChunkGotID != "chk_9" || !strings.Contains(stub.updateChunkGotBody, "corrected") {
			t.Fatalf("id/body not forwarded: id=%q body=%q", stub.updateChunkGotID, stub.updateChunkGotBody)
		}
		if !strings.Contains(w.Body.String(), `"reembedded":true`) {
			t.Fatalf("reembedded not returned: %s", w.Body.String())
		}
	})

	t.Run("update chunk maps upstream 404 to typed CHUNK_NOT_FOUND", func(t *testing.T) {
		h, stub := newRagDashboard()
		stub.chunkErr = fmt.Errorf("theo-rag returned 404")
		req := withID(httptest.NewRequest(http.MethodPatch, "/v1/dashboard/rag/chunks/chk_x", strings.NewReader(`{"text":"x"}`)).
			WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"})), "chk_x")
		w := httptest.NewRecorder()
		h.UpdateChunk(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d (%s)", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "CHUNK_NOT_FOUND") {
			t.Fatalf("want typed CHUNK_NOT_FOUND: %s", w.Body.String())
		}
	})
}
