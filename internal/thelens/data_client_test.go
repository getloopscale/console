// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package thelens

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
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

// captureWrite records METHOD, path, query, Authorization and the request BODY of the last
// request, and returns `status` + `body`. The write real-schema contract tests use it to pin
// the exact upstream verb/path/body forwarded to theo-lens (the M41/rag-M22 field-drift lesson).
func captureWrite(t *testing.T, got *capturedReq, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		got.method = r.Method
		got.path = r.URL.Path
		got.query = r.URL.RawQuery
		got.auth = r.Header.Get("Authorization")
		got.body = string(b)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

type capturedReq struct{ method, path, query, auth, body string }

func writeClient(t *testing.T, srv *httptest.Server) *DataClient {
	t.Helper()
	return NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("theo_live_minted"))
}

// TestDataClient_CreateDataset_RealSchema — POST /v1/datasets forwards {name} verbatim and
// passes the {id,name,createdAt,itemCount} response through. Field names pinned here, not the dogfood.
func TestDataClient_CreateDataset_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"id":"ds_1","name":"golden","createdAt":"2026-07-03T00:00:00Z","itemCount":0}`)
	raw, err := writeClient(t, srv).CreateDataset(context.Background(), json.RawMessage(`{"name":"golden"}`))
	if err != nil {
		t.Fatalf("CreateDataset: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/datasets" {
		t.Fatalf("got %s %s, want POST /v1/datasets", got.method, got.path)
	}
	if got.auth != "Bearer theo_live_minted" {
		t.Fatalf("auth = %q, want Bearer theo_live_minted", got.auth)
	}
	if !strings.Contains(got.body, `"name":"golden"`) {
		t.Fatalf("forwarded body = %q, want {name} field", got.body)
	}
	if !strings.Contains(string(raw), `"id":"ds_1"`) {
		t.Fatalf("response pass-through failed: %s", raw)
	}
}

func TestDataClient_AddDatasetItem_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"id":"ds_1","items":[{"traceId":"tr_9"}]}`)
	if _, err := writeClient(t, srv).AddDatasetItem(context.Background(), "ds_1", json.RawMessage(`{"traceId":"tr_9"}`)); err != nil {
		t.Fatalf("AddDatasetItem: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/datasets/ds_1/items" {
		t.Fatalf("got %s %s, want POST /v1/datasets/ds_1/items", got.method, got.path)
	}
	if !strings.Contains(got.body, `"traceId":"tr_9"`) {
		t.Fatalf("forwarded body = %q, want {traceId}", got.body)
	}
}

func TestDataClient_DeleteDatasetItem_RealPath(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"id":"ds_1","items":[]}`)
	if _, err := writeClient(t, srv).DeleteDatasetItem(context.Background(), "ds_1", "tr_9"); err != nil {
		t.Fatalf("DeleteDatasetItem: %v", err)
	}
	if got.method != http.MethodDelete || got.path != "/v1/datasets/ds_1/items/tr_9" {
		t.Fatalf("got %s %s, want DELETE /v1/datasets/ds_1/items/tr_9", got.method, got.path)
	}
}

func TestDataClient_CreateEvaluator_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"id":"ev_1","name":"myrule","kind":"rule"}`)
	body := json.RawMessage(`{"name":"myrule","kind":"rule","config":{"predicate":"score > 0"}}`)
	if _, err := writeClient(t, srv).CreateEvaluator(context.Background(), body); err != nil {
		t.Fatalf("CreateEvaluator: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/evaluators" {
		t.Fatalf("got %s %s, want POST /v1/evaluators", got.method, got.path)
	}
	if !strings.Contains(got.body, `"kind":"rule"`) || !strings.Contains(got.body, `"config"`) {
		t.Fatalf("forwarded body = %q, want {kind,config} fields", got.body)
	}
}

func TestDataClient_RunEvaluator_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"evaluator":"myrule","written":3,"skipped":0,"truncated":false,"errors":[]}`)
	if _, err := writeClient(t, srv).RunEvaluator(context.Background(), "ev_1", json.RawMessage(`{"limit":10}`)); err != nil {
		t.Fatalf("RunEvaluator: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/evaluators/ev_1/run" {
		t.Fatalf("got %s %s, want POST /v1/evaluators/ev_1/run", got.method, got.path)
	}
}

func TestDataClient_DeleteEvaluator_204(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusNoContent, ``)
	if _, err := writeClient(t, srv).DeleteEvaluator(context.Background(), "ev_1"); err != nil {
		t.Fatalf("DeleteEvaluator: %v", err)
	}
	if got.method != http.MethodDelete || got.path != "/v1/evaluators/ev_1" {
		t.Fatalf("got %s %s, want DELETE /v1/evaluators/ev_1", got.method, got.path)
	}
}

func TestDataClient_CreateGuard_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"id":"gd_1","evaluatorId":"ev_1","operator":"gte"}`)
	body := json.RawMessage(`{"evaluatorId":"ev_1","operator":"gte","threshold":0.8}`)
	if _, err := writeClient(t, srv).CreateGuard(context.Background(), body); err != nil {
		t.Fatalf("CreateGuard: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/guards" {
		t.Fatalf("got %s %s, want POST /v1/guards", got.method, got.path)
	}
	if !strings.Contains(got.body, `"evaluatorId":"ev_1"`) || !strings.Contains(got.body, `"operator":"gte"`) {
		t.Fatalf("forwarded body = %q, want {evaluatorId,operator}", got.body)
	}
}

func TestDataClient_DeleteGuard_204(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusNoContent, ``)
	if _, err := writeClient(t, srv).DeleteGuard(context.Background(), "gd_1"); err != nil {
		t.Fatalf("DeleteGuard: %v", err)
	}
	if got.method != http.MethodDelete || got.path != "/v1/guards/gd_1" {
		t.Fatalf("got %s %s, want DELETE /v1/guards/gd_1", got.method, got.path)
	}
}

func TestDataClient_AddTraceTag_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"tags":["prod"]}`)
	if _, err := writeClient(t, srv).AddTraceTag(context.Background(), "tr_1", json.RawMessage(`{"tag":"prod"}`)); err != nil {
		t.Fatalf("AddTraceTag: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/traces/tr_1/tags" {
		t.Fatalf("got %s %s, want POST /v1/traces/tr_1/tags", got.method, got.path)
	}
	if !strings.Contains(got.body, `"tag":"prod"`) {
		t.Fatalf("forwarded body = %q, want {tag}", got.body)
	}
}

// TestDataClient_DeleteTraceTag_QueryParam — theo-lens takes the tag as ?tag= query, not path.
func TestDataClient_DeleteTraceTag_QueryParam(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"tags":[]}`)
	if _, err := writeClient(t, srv).DeleteTraceTag(context.Background(), "tr_1", "prod"); err != nil {
		t.Fatalf("DeleteTraceTag: %v", err)
	}
	if got.method != http.MethodDelete || got.path != "/v1/traces/tr_1/tags" {
		t.Fatalf("got %s %s, want DELETE /v1/traces/tr_1/tags", got.method, got.path)
	}
	if !strings.Contains(got.query, "tag=prod") {
		t.Fatalf("query = %q, want tag=prod", got.query)
	}
}

func TestDataClient_AddTraceAnnotation_RealSchema(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"annotations":[{"name":"feedback","label":"good"}]}`)
	body := json.RawMessage(`{"label":"good","note":"nice run"}`)
	if _, err := writeClient(t, srv).AddTraceAnnotation(context.Background(), "tr_1", body); err != nil {
		t.Fatalf("AddTraceAnnotation: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/v1/traces/tr_1/annotations" {
		t.Fatalf("got %s %s, want POST /v1/traces/tr_1/annotations", got.method, got.path)
	}
	if !strings.Contains(got.body, `"label":"good"`) {
		t.Fatalf("forwarded body = %q, want {label}", got.body)
	}
}

func TestDataClient_DeleteTraceAnnotation_QueryParams(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"annotations":[]}`)
	q := url.Values{"name": {"feedback"}, "annotatorKind": {"HUMAN"}}
	if _, err := writeClient(t, srv).DeleteTraceAnnotation(context.Background(), "tr_1", q); err != nil {
		t.Fatalf("DeleteTraceAnnotation: %v", err)
	}
	if got.method != http.MethodDelete || got.path != "/v1/traces/tr_1/annotations" {
		t.Fatalf("got %s %s, want DELETE /v1/traces/tr_1/annotations", got.method, got.path)
	}
	if !strings.Contains(got.query, "name=feedback") {
		t.Fatalf("query = %q, want name=feedback", got.query)
	}
}

// New-read contract tests (paths the M44 pages need).
func TestDataClient_ListDatasets_RealPath(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"datasets":[]}`)
	if _, err := writeClient(t, srv).ListDatasets(context.Background()); err != nil {
		t.Fatalf("ListDatasets: %v", err)
	}
	if got.method != http.MethodGet || got.path != "/v1/datasets" {
		t.Fatalf("got %s %s, want GET /v1/datasets", got.method, got.path)
	}
}

func TestDataClient_GetDataset_RealPath(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"id":"ds_1","items":[]}`)
	if _, err := writeClient(t, srv).GetDataset(context.Background(), "ds_1"); err != nil {
		t.Fatalf("GetDataset: %v", err)
	}
	if got.path != "/v1/datasets/ds_1" {
		t.Fatalf("path = %q, want /v1/datasets/ds_1", got.path)
	}
}

func TestDataClient_ListEvaluators_RealPath(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"evaluators":[]}`)
	if _, err := writeClient(t, srv).ListEvaluators(context.Background()); err != nil {
		t.Fatalf("ListEvaluators: %v", err)
	}
	if got.path != "/v1/evaluators" {
		t.Fatalf("path = %q, want /v1/evaluators", got.path)
	}
}

func TestDataClient_ListGuards_And_Breaches_RealPath(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"guards":[]}`)
	c := writeClient(t, srv)
	if _, err := c.ListGuards(context.Background()); err != nil {
		t.Fatalf("ListGuards: %v", err)
	}
	if got.path != "/v1/guards" {
		t.Fatalf("path = %q, want /v1/guards", got.path)
	}
	if _, err := c.GuardBreaches(context.Background(), "gd_1"); err != nil {
		t.Fatalf("GuardBreaches: %v", err)
	}
	if got.path != "/v1/guards/gd_1/breaches" {
		t.Fatalf("path = %q, want /v1/guards/gd_1/breaches", got.path)
	}
}

func TestDataClient_ListAgents_And_GetTrace_RealPath(t *testing.T) {
	var got capturedReq
	srv := captureWrite(t, &got, http.StatusOK, `{"agents":[]}`)
	c := writeClient(t, srv)
	if _, err := c.ListAgents(context.Background()); err != nil {
		t.Fatalf("ListAgents: %v", err)
	}
	if got.path != "/v1/agents" {
		t.Fatalf("path = %q, want /v1/agents", got.path)
	}
	if _, err := c.GetTrace(context.Background(), "tr_1"); err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	if got.path != "/v1/traces/tr_1" {
		t.Fatalf("path = %q, want /v1/traces/tr_1", got.path)
	}
	if _, err := c.GetTraceTags(context.Background(), "tr_1"); err != nil {
		t.Fatalf("GetTraceTags: %v", err)
	}
	if got.path != "/v1/traces/tr_1/tags" {
		t.Fatalf("path = %q, want /v1/traces/tr_1/tags", got.path)
	}
	if _, err := c.GetTraceAnnotations(context.Background(), "tr_1"); err != nil {
		t.Fatalf("GetTraceAnnotations: %v", err)
	}
	if got.path != "/v1/traces/tr_1/annotations" {
		t.Fatalf("path = %q, want /v1/traces/tr_1/annotations", got.path)
	}
}

// TestDataClient_Write_FailClosed_ResolverError — a write with a failing resolver sends NO
// request and never leaks the bearer (the write half honors the same fail-closed contract).
func TestDataClient_Write_FailClosed_ResolverError(t *testing.T) {
	var hit bool
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	t.Cleanup(srv.Close)
	const secret = "theo_live_WRITE_SHOULD_NOT_LEAK"
	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).
		WithKeyResolver(func(context.Context) (string, error) { return secret, errors.New("resolver failed") })
	_, err := c.CreateDataset(context.Background(), json.RawMessage(`{"name":"x"}`))
	if err == nil {
		t.Fatal("expected an error when the resolver fails (fail-closed write)")
	}
	if hit {
		t.Fatal("no request must be sent when the resolver errors (fail-closed write)")
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
