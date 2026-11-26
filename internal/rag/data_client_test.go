package rag

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// M17 T2.1 — the data client proxies with the per-tenant Bearer resolved per request.
func TestRagDataClient_ProxiesWithPerTenantBearer(t *testing.T) {
	var gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]any{{"id": "col_1", "name": "docs"}}})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_tenantA", nil })

	res, err := c.ListCollections(context.Background(), 10, 0)
	if err != nil {
		t.Fatalf("ListCollections: %v", err)
	}
	if gotAuth != "Bearer rag_live_tenantA" {
		t.Fatalf("Authorization = %q, want Bearer rag_live_tenantA", gotAuth)
	}
	if gotPath != "/v1/collections" {
		t.Fatalf("path = %q, want /v1/collections", gotPath)
	}
	if len(res.Items) != 1 || res.Items[0].ID != "col_1" {
		t.Fatalf("items mismatch: %+v", res.Items)
	}
}

// M21 T1.1 — the write surface proxies the mutating verb + body with the per-tenant Bearer.
func TestRagDataClient_CreateCollection_ProxiesBearerAndBody(t *testing.T) {
	var gotAuth, gotMethod, gotPath, gotCT string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotMethod, gotPath, gotCT = r.Header.Get("Authorization"), r.Method, r.URL.Path, r.Header.Get("Content-Type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "col_new", "name": "docs"})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_tenantW", nil })

	out, err := c.CreateCollection(context.Background(), CreateCollectionInput{Name: "docs"})
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/collections" {
		t.Fatalf("method/path = %s %s, want POST /v1/collections", gotMethod, gotPath)
	}
	if gotAuth != "Bearer rag_live_tenantW" {
		t.Fatalf("Authorization = %q, want Bearer rag_live_tenantW", gotAuth)
	}
	if gotCT != "application/json" || gotBody["name"] != "docs" {
		t.Fatalf("content-type/body mismatch: ct=%q body=%+v", gotCT, gotBody)
	}
	if out.ID != "col_new" {
		t.Fatalf("created id = %q, want col_new", out.ID)
	}
}

// M21 dogfood regression — IngestDocument MUST send looprag's `content` field (NOT the
// dashboard-facing `text`) + a non-empty `name`, else looprag 422s "content must be a
// string" and the dashboard upload journey breaks. Caught live 2026-07-03; the BFF
// contract tests missed it because they stubbed the data client (never hit looprag's schema).
func TestRagDataClient_IngestDocument_SendsContentField(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "doc_1", "status": "processing"})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_x", nil })

	_, err := c.IngestDocument(context.Background(), IngestInput{CollectionID: "col_1", Text: "hello world", Name: "doc-a"})
	if err != nil {
		t.Fatalf("IngestDocument: %v", err)
	}
	if gotPath != "/v1/documents/raw" {
		t.Fatalf("path = %q, want /v1/documents/raw", gotPath)
	}
	// the looprag contract field is `content`, not `text`
	if gotBody["content"] != "hello world" {
		t.Fatalf("body.content = %v, want \"hello world\" (looprag requires `content`, not `text`)", gotBody["content"])
	}
	if _, hasText := gotBody["text"]; hasText {
		t.Fatalf("body must NOT contain `text` (looprag rejects it): %+v", gotBody)
	}
	if gotBody["name"] != "doc-a" || gotBody["collection_id"] != "col_1" {
		t.Fatalf("body name/collection_id mismatch: %+v", gotBody)
	}
}

// An unnamed upload still satisfies looprag's required `name` (defaulted, no 422).
func TestRagDataClient_IngestDocument_DefaultsEmptyName(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "doc_2"})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, nil).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_x", nil })

	if _, err := c.IngestDocument(context.Background(), IngestInput{CollectionID: "col_1", Text: "t"}); err != nil {
		t.Fatalf("IngestDocument: %v", err)
	}
	if gotBody["name"] == nil || gotBody["name"] == "" {
		t.Fatalf("empty name must be defaulted (looprag requires a non-empty name): %+v", gotBody)
	}
}

// M21 T1.1 — a write FAILS CLOSED when the per-tenant key cannot be resolved (no request sent).
func TestRagDataClient_Write_KeyResolverError_FailsClosed(t *testing.T) {
	var reached bool
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	defer srv.Close()

	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return "", errors.New("no grantable scopes") })

	if err := c.DeleteCollection(context.Background(), "col_x"); err == nil {
		t.Fatal("expected DeleteCollection to fail closed on resolver error")
	}
	if reached {
		t.Fatal("resolver error must NOT send any request (fail-closed)")
	}
}

// M17 T2.1 — Analytics proxies GET /v1/analytics with the per-tenant Bearer.
func TestRagDataClient_Analytics_ProxiesBearer(t *testing.T) {
	var gotAuth, gotPath, gotSince, gotCollectionID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		gotSince = r.URL.Query().Get("since")
		gotCollectionID = r.URL.Query().Get("collection_id")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"window":     map[string]any{"since": "2026-07-01T00:00:00Z"},
			"totals":     map[string]any{"retrievals": 5, "answers": 3, "empty_retrieval_rate": 0.2},
			"latency":    map[string]any{"p50_ms": 30, "p95_ms": 120},
			"confidence": map[string]any{"high": 2, "medium": 1, "low": 0},
		})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, nil).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_tenantB", nil })

	res, err := c.Analytics(context.Background(), "", "2026-07-01T00:00:00Z")
	if err != nil {
		t.Fatalf("Analytics: %v", err)
	}
	if gotAuth != "Bearer rag_live_tenantB" || gotPath != "/v1/analytics" || gotSince != "2026-07-01T00:00:00Z" {
		t.Fatalf("request mismatch: auth=%q path=%q since=%q", gotAuth, gotPath, gotSince)
	}
	if gotCollectionID != "" {
		t.Fatalf("collection_id must NOT be sent when empty (backward-compat), got %q", gotCollectionID)
	}
	if res.Totals.Retrievals != 5 || res.Latency.P95Ms != 120 {
		t.Fatalf("analytics decode mismatch: %+v", res)
	}
	if res.Scale != nil {
		t.Fatalf("Scale must be nil when upstream did not return it, got %+v", res.Scale)
	}
}

// v8-M7 scale-observability — Analytics forwards collection_id to /v1/analytics
// AND decodes the per-collection `scale` block returned by looprag rc.80+.
// looprag ONLY attaches `scale` when `?collection_id=` is present (backward-compat).
func TestRagDataClient_Analytics_ForwardsCollectionID_DecodesScale(t *testing.T) {
	var gotCollectionID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCollectionID = r.URL.Query().Get("collection_id")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"window":     map[string]any{"since": "2026-07-01T00:00:00Z"},
			"totals":     map[string]any{"retrievals": 0, "answers": 0, "empty_retrieval_rate": 0},
			"latency":    map[string]any{"p50_ms": 0, "p95_ms": 0},
			"confidence": map[string]any{"high": 0, "medium": 0, "low": 0},
			"scale": map[string]any{
				"collection_id": "col_docs",
				"corpus":        map[string]any{"documents": 3, "chunks": 42, "size_bytes": 8192},
				"communities":   map[string]any{"total": 5, "max_level": 2, "per_level": map[string]any{"0": 3, "1": 2}},
				"extraction":    map[string]any{"tokens": 12345},
			},
		})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, nil).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_x", nil })

	res, err := c.Analytics(context.Background(), "col_docs", "")
	if err != nil {
		t.Fatalf("Analytics: %v", err)
	}
	if gotCollectionID != "col_docs" {
		t.Fatalf("looprag must receive ?collection_id=col_docs, got %q", gotCollectionID)
	}
	if res.Scale == nil {
		t.Fatal("Scale MUST be decoded when upstream returns it")
	}
	if res.Scale.CollectionID != "col_docs" {
		t.Fatalf("scale.collection_id = %q, want col_docs", res.Scale.CollectionID)
	}
	if res.Scale.Extraction.Tokens != 12345 {
		t.Fatalf("scale.extraction.tokens = %d, want 12345", res.Scale.Extraction.Tokens)
	}
	if res.Scale.Corpus.Documents != 3 || res.Scale.Corpus.Chunks != 42 || res.Scale.Corpus.SizeBytes != 8192 {
		t.Fatalf("scale.corpus mismatch: %+v", res.Scale.Corpus)
	}
	if res.Scale.Communities.Total != 5 || res.Scale.Communities.MaxLevel != 2 {
		t.Fatalf("scale.communities total/max_level mismatch: %+v", res.Scale.Communities)
	}
	if got := res.Scale.Communities.PerLevel["1"]; got != 2 {
		t.Fatalf("scale.communities.per_level[\"1\"] = %d, want 2", got)
	}
}

// M17 T2.1 — a keyResolver error FAILS CLOSED: no upstream request, typed error.
func TestRagDataClient_KeyResolverError_FailsClosed(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer srv.Close()

	c := NewDataClient(srv.URL, nil).
		WithKeyResolver(func(context.Context) (string, error) { return "", errors.New("no tenant") })

	if _, err := c.ListCollections(context.Background(), 10, 0); err == nil {
		t.Fatal("expected error when keyResolver fails, got nil")
	}
	if called {
		t.Fatal("upstream MUST NOT be called when the key cannot be resolved (fail-closed)")
	}
}

// M17 T2.1 — a non-2xx upstream is a typed error (no key leak).
func TestRagDataClient_Non2xx_IsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, nil).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_x", nil })

	if _, err := c.Analytics(context.Background(), "", ""); err == nil {
		t.Fatal("expected error on 500, got nil")
	}
}

// M11 T1.1 — the file-upload surface streams a multipart body to looprag's
// POST /v1/documents with the per-tenant Bearer, the `file` part (filename +
// bytes), and the `collection_id` / `mode` form fields. RED before GREEN.
func TestRagDataClient_UploadDocumentFile_StreamsMultipart(t *testing.T) {
	var gotAuth, gotMethod, gotPath, gotCT, gotFilename, gotFileBody, gotCollID, gotMode string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotMethod, gotPath, gotCT = r.Header.Get("Authorization"), r.Method, r.URL.Path, r.Header.Get("Content-Type")
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("upstream ParseMultipartForm: %v", err)
		}
		gotCollID = r.FormValue("collection_id")
		gotMode = r.FormValue("mode")
		f, hdr, err := r.FormFile("file")
		if err != nil {
			t.Errorf("upstream FormFile: %v", err)
		} else {
			defer func() { _ = f.Close() }()
			gotFilename = hdr.Filename
			b, _ := io.ReadAll(f)
			gotFileBody = string(b)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "doc_new", "status": "processing"})
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, &http.Client{Timeout: 5 * time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_tenantF", nil })

	out, err := c.UploadDocumentFile(context.Background(), UploadFileInput{
		File:         strings.NewReader("%PDF-1.4 fake pdf bytes"),
		Filename:     "report.pdf",
		ContentType:  "application/pdf",
		CollectionID: "col_1",
		Mode:         "fast",
	})
	if err != nil {
		t.Fatalf("UploadDocumentFile: %v", err)
	}
	if gotAuth != "Bearer rag_live_tenantF" {
		t.Fatalf("Authorization = %q, want Bearer rag_live_tenantF", gotAuth)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/documents" {
		t.Fatalf("method/path = %s %s, want POST /v1/documents", gotMethod, gotPath)
	}
	if !strings.HasPrefix(gotCT, "multipart/form-data") {
		t.Fatalf("Content-Type = %q, want multipart/form-data", gotCT)
	}
	if gotFilename != "report.pdf" || gotFileBody != "%PDF-1.4 fake pdf bytes" {
		t.Fatalf("file part mismatch: name=%q body=%q", gotFilename, gotFileBody)
	}
	if gotCollID != "col_1" || gotMode != "fast" {
		t.Fatalf("form fields mismatch: collection_id=%q mode=%q", gotCollID, gotMode)
	}
	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil || got["id"] != "doc_new" {
		t.Fatalf("response mismatch: %s (err=%v)", string(out), err)
	}
}

// M11 T1.2 — an upstream 422 (unsupported type / parse error) surfaces as a typed
// error, never a silent success.
func TestRagDataClient_UploadDocumentFile_UpstreamErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "unsupported_file_type"})
	}))
	defer srv.Close()
	c := NewDataClient(srv.URL, &http.Client{Timeout: 5 * time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return "rag_live_x", nil })
	_, err := c.UploadDocumentFile(context.Background(), UploadFileInput{
		File: strings.NewReader("x"), Filename: "a.exe", ContentType: "application/x-msdownload", CollectionID: "col_1",
	})
	if err == nil {
		t.Fatal("expected typed error on upstream 422, got nil")
	}
}
