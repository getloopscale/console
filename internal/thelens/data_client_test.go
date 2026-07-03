// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package thelens

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fixedResolver returns a constant bearer (the dashboard mints it per-tenant in prod).
func fixedResolver(key string) func(context.Context) (string, error) {
	return func(context.Context) (string, error) { return key, nil }
}

// captureServer records the path, query and Authorization of the last request and returns 200 body.
func captureServer(t *testing.T, gotPath, gotQuery, gotAuth *string, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*gotPath = r.URL.Path
		*gotQuery = r.URL.RawQuery
		*gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// TestDataClient_ListTraces_HitsRealPath_WithBearer — the load-bearing real-schema check:
// the client GETs theo-lens's REAL native path /v1/traces (NOT a wrong path), carries the
// per-tenant Bearer, forwards limit/offset, and passes the body through.
func TestDataClient_ListTraces_HitsRealPath_WithBearer(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := captureServer(t, &gotPath, &gotQuery, &gotAuth, `{"traces":[{"traceId":"t1"}]}`)
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("theo_live_minted"))

	raw, err := c.ListTraces(context.Background(), 25, 50)
	if err != nil {
		t.Fatalf("ListTraces: %v", err)
	}
	if gotPath != "/v1/traces" {
		t.Fatalf("path = %q, want /v1/traces (the real theo-lens native path)", gotPath)
	}
	if gotAuth != "Bearer theo_live_minted" {
		t.Fatalf("Authorization = %q, want Bearer theo_live_minted", gotAuth)
	}
	if !strings.Contains(gotQuery, "limit=25") || !strings.Contains(gotQuery, "offset=50") {
		t.Fatalf("query = %q, want limit=25 & offset=50 forwarded", gotQuery)
	}
	if !strings.Contains(string(raw), `"traceId":"t1"`) {
		t.Fatalf("body pass-through failed: %s", raw)
	}
}

func TestDataClient_ListSessions_HitsRealPath(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := captureServer(t, &gotPath, &gotQuery, &gotAuth, `{"sessions":[]}`)
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("k"))
	if _, err := c.ListSessions(context.Background(), 10, 0); err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if gotPath != "/v1/sessions" {
		t.Fatalf("path = %q, want /v1/sessions", gotPath)
	}
	if !strings.Contains(gotQuery, "limit=10") {
		t.Fatalf("query = %q, want limit=10", gotQuery)
	}
}

// TestDataClient_Observability_HitsMetricsPath — the schema-lesson: observability lives
// under /v1/metrics, NOT /v1/observability. A wrong path here would 502 the dashboard.
func TestDataClient_Observability_HitsMetricsPath(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := captureServer(t, &gotPath, &gotQuery, &gotAuth, `{"traces":0}`)
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("k"))
	if _, err := c.Observability(context.Background()); err != nil {
		t.Fatalf("Observability: %v", err)
	}
	if gotPath != "/v1/metrics/observability" {
		t.Fatalf("path = %q, want /v1/metrics/observability (NOT /v1/observability)", gotPath)
	}
}

// TestDataClient_Cost_HitsAnalyticsPath — the schema-lesson: cost lives under /v1/analytics,
// NOT /v1/cost; `since` is forwarded.
func TestDataClient_Cost_HitsAnalyticsPath(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := captureServer(t, &gotPath, &gotQuery, &gotAuth, `{"total_usd":0}`)
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("k"))
	if _, err := c.Cost(context.Background(), "2026-07-01"); err != nil {
		t.Fatalf("Cost: %v", err)
	}
	if gotPath != "/v1/analytics/cost" {
		t.Fatalf("path = %q, want /v1/analytics/cost (NOT /v1/cost)", gotPath)
	}
	if !strings.Contains(gotQuery, "since=2026-07-01") {
		t.Fatalf("query = %q, want since=2026-07-01 forwarded", gotQuery)
	}
}

// TestDataClient_FailClosed_NoResolver — no keyResolver wired → error, NO request sent.
func TestDataClient_FailClosed_NoResolver(t *testing.T) {
	var hit bool
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	t.Cleanup(srv.Close)
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}) // no WithKeyResolver
	if _, err := c.ListTraces(context.Background(), 0, 0); err == nil {
		t.Fatal("expected an error with no key resolver (fail-closed)")
	}
	if hit {
		t.Fatal("no request must be sent without a key resolver (fail-closed)")
	}
}

// TestDataClient_FailClosed_ResolverError — resolver error → error, NO request, bearer not leaked.
func TestDataClient_FailClosed_ResolverError(t *testing.T) {
	var hit bool
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	t.Cleanup(srv.Close)
	const secret = "theo_live_SHOULD_NOT_LEAK"
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return secret, errors.New("resolver failed") })
	_, err := c.Cost(context.Background(), "")
	if err == nil {
		t.Fatal("expected an error when the resolver fails (fail-closed)")
	}
	if hit {
		t.Fatal("no request must be sent when the resolver errors (fail-closed)")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked the bearer: %v", err)
	}
}

// TestDataClient_UpstreamError_Propagates — upstream 500 → error, nil body.
func TestDataClient_UpstreamError_Propagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`upstream boom`))
	}))
	t.Cleanup(srv.Close)
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("k"))
	raw, err := c.ListTraces(context.Background(), 0, 0)
	if err == nil {
		t.Fatal("expected an error on upstream 500")
	}
	if raw != nil {
		t.Fatalf("body = %s, want nil on error", raw)
	}
}
