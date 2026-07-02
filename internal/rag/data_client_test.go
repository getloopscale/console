package rag

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

// M17 T2.1 — Analytics proxies GET /v1/analytics with the per-tenant Bearer.
func TestRagDataClient_Analytics_ProxiesBearer(t *testing.T) {
	var gotAuth, gotPath, gotSince string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		gotSince = r.URL.Query().Get("since")
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

	res, err := c.Analytics(context.Background(), "2026-07-01T00:00:00Z")
	if err != nil {
		t.Fatalf("Analytics: %v", err)
	}
	if gotAuth != "Bearer rag_live_tenantB" || gotPath != "/v1/analytics" || gotSince != "2026-07-01T00:00:00Z" {
		t.Fatalf("request mismatch: auth=%q path=%q since=%q", gotAuth, gotPath, gotSince)
	}
	if res.Totals.Retrievals != 5 || res.Latency.P95Ms != 120 {
		t.Fatalf("analytics decode mismatch: %+v", res)
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

	if _, err := c.Analytics(context.Background(), ""); err == nil {
		t.Fatal("expected error on 500, got nil")
	}
}
