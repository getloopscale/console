// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package themory

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// cloud ↔ theo-data consumer-driven contract (conform-to-provider, 2026-06-18).
//
// cloud is the CONSUMER of theo-data (TheMemory); these tests validate that the
// client's outgoing REQUESTS conform to openapi/themory.yaml — now the SUBSET of
// TheMemory's REAL /v1/openapi.json the client calls (GET /v1/scopes/{type}/{id}/
// memories + DELETE /v1/scopes/{type}/{id}/memories/{memId}). They drive the real
// client against an httptest stub that captures the request, then validate it with
// openapi3filter. Plus the failure scenarios (404 → ErrNotFound; 422/5xx → *Error).
//
// The full real-server contract is additionally proven by tests/e2e.

const themorySpec = "../../openapi/themory.yaml"

func loadThemorySpec(t *testing.T) (*openapi3.T, routers.Router) {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromFile(themorySpec)
	if err != nil {
		t.Fatalf("load themory.yaml: %v", err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("themory.yaml invalid: %v", err)
	}
	router, err := gorillamux.NewRouter(doc)
	if err != nil {
		t.Fatalf("build router from themory.yaml: %v", err)
	}
	return doc, router
}

// captureServer records the last request it received and replies with the given
// status + JSON body.
func captureServer(t *testing.T, status int, body string, captured **http.Request) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Buffer the request body and re-attach it so openapi3filter can read it
		// during validation (a POST body — remember/recall/reflect — must survive the clone).
		buf, _ := io.ReadAll(r.Body)
		clone := r.Clone(context.Background())
		clone.Body = io.NopCloser(bytes.NewReader(buf))
		*captured = clone
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func validateRequest(t *testing.T, router routers.Router, req *http.Request) {
	t.Helper()
	route, pathParams, err := router.FindRoute(req)
	if err != nil {
		t.Fatalf("themory.yaml has no route for %s %s: %v", req.Method, req.URL.Path, err)
	}
	in := &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
		Options: &openapi3filter.Options{
			AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		},
	}
	if err := openapi3filter.ValidateRequest(context.Background(), in); err != nil {
		t.Fatalf("client request to %s %s does not conform to themory.yaml: %v",
			req.Method, req.URL.Path, err)
	}
}

func TestThemoryClient_RequestsConformToSpec(t *testing.T) {
	_, router := loadThemorySpec(t)

	t.Run("List hits the scope endpoint", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"items":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.List(context.Background(), "user-1", ListOptions{Limit: 10, Category: "prefs"}); err != nil {
			t.Fatalf("List: %v", err)
		}
		validateRequest(t, router, got)
	})

	t.Run("Forget issues a single scope-checked DELETE for an owned id", func(t *testing.T) {
		// Cutover (themory-gateway-forget-cutover): Forget is now ONE request — a
		// scope-checked DELETE on the provider — not the old GET-listing + POST.
		// The provider enforces ownership server-side (cross-scope → 404), so the
		// gateway drops its O(scope) listAll pre-check.
		var got *http.Request
		srv := captureServer(t, http.StatusNoContent, "", &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if err := c.Forget(context.Background(), "user-1", "mem-123", false); err != nil {
			t.Fatalf("Forget: %v", err)
		}
		if got == nil || got.Method != http.MethodDelete {
			t.Fatalf("expected a single captured DELETE, got %+v", got)
		}
		if got.URL.Path != "/v1/scopes/user/user-1/memories/mem-123" {
			t.Fatalf("unexpected delete path: %s", got.URL.Path)
		}
		validateRequest(t, router, got)
	})

	t.Run("Forget propagates ?hard=true for GDPR erasure", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusNoContent, "", &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if err := c.Forget(context.Background(), "user-1", "mem-123", true); err != nil {
			t.Fatalf("Forget hard: %v", err)
		}
		if got.URL.Query().Get("hard") != "true" {
			t.Fatalf("expected ?hard=true, got query %q", got.URL.RawQuery)
		}
		validateRequest(t, router, got)
	})

	t.Run("Remember hits POST /v1/remember", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 201, `{"items":[{"id":"m1","text":"hi","createdAt":"2026-06-19T00:00:00Z"}]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		res, err := c.Remember(context.Background(), "user-1", "hi", RememberOptions{Category: "prefs"})
		if err != nil {
			t.Fatalf("Remember: %v", err)
		}
		if len(res.Items) != 1 || res.Items[0].Content != "hi" {
			t.Fatalf("Remember mapping wrong: %+v", res.Items)
		}
		validateRequest(t, router, got)
	})

	t.Run("Recall hits POST /v1/recall", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[{"id":"m1","text":"hi","score":0.9,"createdAt":"2026-06-19T00:00:00Z"}]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		res, err := c.Recall(context.Background(), "user-1", "greeting", RecallOptions{TopK: 5, Threshold: 0.7})
		if err != nil {
			t.Fatalf("Recall: %v", err)
		}
		if len(res.Results) != 1 || res.Results[0].Score != 0.9 || res.Results[0].Content != "hi" {
			t.Fatalf("Recall mapping wrong: %+v", res.Results)
		}
		validateRequest(t, router, got)
	})

	t.Run("Remember sends attributedTo (Phase 2A)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 201, `{"items":[{"id":"m1","text":"hi","createdAt":"2026-06-19T00:00:00Z"}]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Remember(context.Background(), "user-1", "hi", RememberOptions{AttributedTo: "paulo"}); err != nil {
			t.Fatalf("Remember: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		if !strings.Contains(string(body), `"attributedTo":"paulo"`) {
			t.Fatalf("attributedTo not sent: %s", body)
		}
		// re-attach for spec validation
		got.Body = io.NopCloser(bytes.NewReader(body))
		validateRequest(t, router, got)
	})

	t.Run("Recall sends asOf (Phase 2A)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Recall(context.Background(), "user-1", "q", RecallOptions{AsOf: "2026-06-01T00:00:00Z"}); err != nil {
			t.Fatalf("Recall: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		if !strings.Contains(string(body), `"asOf":"2026-06-01T00:00:00Z"`) {
			t.Fatalf("asOf not sent: %s", body)
		}
		got.Body = io.NopCloser(bytes.NewReader(body))
		validateRequest(t, router, got)
	})

	t.Run("Recall forwards graphExpand in the body (EG-1 T1.1)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Recall(context.Background(), "user-1", "q", RecallOptions{GraphExpand: &GraphExpand{Hops: 1}}); err != nil {
			t.Fatalf("Recall: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		if !strings.Contains(string(body), `"graphExpand":{"hops":1}`) {
			t.Fatalf("graphExpand not sent: %s", body)
		}
		got.Body = io.NopCloser(bytes.NewReader(body))
		validateRequest(t, router, got)
	})

	t.Run("Recall omits graphExpand when unset (EG-1 T1.1)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Recall(context.Background(), "user-1", "q", RecallOptions{TopK: 5}); err != nil {
			t.Fatalf("Recall: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		if strings.Contains(string(body), "graphExpand") {
			t.Fatalf("graphExpand should be omitted: %s", body)
		}
	})

	t.Run("Recall forwards empty graphExpand{} as enable-with-defaults (EG-1 EC-2)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Recall(context.Background(), "user-1", "q", RecallOptions{GraphExpand: &GraphExpand{}}); err != nil {
			t.Fatalf("Recall: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		// hops/limit omitempty → graphExpand serializes to {} (enable, provider default hops).
		if !strings.Contains(string(body), `"graphExpand":{}`) {
			t.Fatalf("empty graphExpand not sent as {}: %s", body)
		}
	})

	t.Run("GOAL: graphExpand{hops,limit} reaches the provider /v1/recall body (EG-1 T3.1)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Recall(context.Background(), "user-1", "q", RecallOptions{GraphExpand: &GraphExpand{Hops: 2, Limit: 10}}); err != nil {
			t.Fatalf("Recall: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		if !strings.Contains(string(body), `"graphExpand":{"hops":2,"limit":10}`) {
			t.Fatalf("graphExpand{hops:2,limit:10} not forwarded: %s", body)
		}
		got.Body = io.NopCloser(bytes.NewReader(body))
		validateRequest(t, router, got)
	})

	t.Run("Recall drops limit:0 (omitempty invariant — F-dom-1)", func(t *testing.T) {
		// limit:0 is the OMIT signal; TheMemory's zod is limit.min(1), so a
		// forwarded limit:0 would 422. omitempty must drop it → graphExpand:{"hops":1}.
		var got *http.Request
		srv := captureServer(t, 200, `{"results":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.Recall(context.Background(), "user-1", "q", RecallOptions{GraphExpand: &GraphExpand{Hops: 1, Limit: 0}}); err != nil {
			t.Fatalf("Recall: %v", err)
		}
		body, _ := io.ReadAll(got.Body)
		if strings.Contains(string(body), `"limit"`) {
			t.Fatalf("limit:0 must be omitted (TheMemory limit.min(1) would 422): %s", body)
		}
		if !strings.Contains(string(body), `"graphExpand":{"hops":1}`) {
			t.Fatalf("graphExpand should serialize to {hops:1} with no limit: %s", body)
		}
	})

	t.Run("Reflect hits POST /v1/reflect", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 202, `{"consolidated":2}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		res, err := c.Reflect(context.Background(), "user-1", ReflectOptions{MaxIterations: 3})
		if err != nil {
			t.Fatalf("Reflect: %v", err)
		}
		if len(res.Raw) == 0 {
			t.Fatal("Reflect should pass through the provider result body")
		}
		validateRequest(t, router, got)
	})

	t.Run("Metrics hits the scope metrics endpoint", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"total_memories":3,"entity_count":1,"add_events":3,"retrieval_api_usage":0}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		m, err := c.Metrics(context.Background(), "user-1")
		if err != nil {
			t.Fatalf("Metrics: %v", err)
		}
		if m.TotalMemories != 3 || m.EntityCount != 1 {
			t.Fatalf("Metrics mapping wrong: %+v", m)
		}
		validateRequest(t, router, got)
	})

	t.Run("Entities hits the scope entities endpoint", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"entities":[{"id":"paulo","scope_type":"user","memory_count":2}]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		res, err := c.Entities(context.Background(), "user-1", "user")
		if err != nil {
			t.Fatalf("Entities: %v", err)
		}
		if len(res.Entities) != 1 || res.Entities[0].ID != "paulo" {
			t.Fatalf("Entities mapping wrong: %+v", res.Entities)
		}
		validateRequest(t, router, got)
	})

	t.Run("Graph hits the scope graph endpoint", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"nodes":[{"id":"John Smith","scope_type":"user","memory_count":2}],"edges":[{"source":"John Smith","relation":"works at","target":"Google","memory_count":1}]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		res, err := c.Graph(context.Background(), "user-1", "user")
		if err != nil {
			t.Fatalf("Graph: %v", err)
		}
		if len(res.Nodes) != 1 || res.Nodes[0].ID != "John Smith" {
			t.Fatalf("Graph nodes mapping wrong: %+v", res.Nodes)
		}
		if len(res.Edges) != 1 || res.Edges[0].Target != "Google" || res.Edges[0].Relation != "works at" {
			t.Fatalf("Graph edges mapping wrong: %+v", res.Edges)
		}
		validateRequest(t, router, got)
	})

	t.Run("Graph non-user scope returns empty without HTTP call", func(t *testing.T) {
		c := NewClient("http://unused.invalid", "test-key", http.DefaultClient)
		res, err := c.Graph(context.Background(), "user-1", "session")
		if err != nil {
			t.Fatalf("Graph(session): %v", err)
		}
		if res.Nodes == nil || res.Edges == nil || len(res.Edges) != 0 {
			t.Fatalf("Graph(session) should be empty non-nil: %+v", res)
		}
	})

	t.Run("Episodes hits the scope episodes endpoint + maps items + nextCursor", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"items":[{"id":"m1","text":"moved to Lisbon","scope_type":"user","created_at":"2026-06-22T10:00:00.000Z","metadata":{}}],"nextCursor":"CUR1"}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		res, err := c.Episodes(context.Background(), "user-1", "user", EpisodeOptions{Limit: 2, Order: "desc", After: "PREV", AsOf: "2026-06-22T11:00:00Z", Query: "Lisbon"})
		if err != nil {
			t.Fatalf("Episodes: %v", err)
		}
		if len(res.Items) != 1 || res.Items[0].ID != "m1" || res.Items[0].Text != "moved to Lisbon" {
			t.Fatalf("Episodes item mapping wrong: %+v", res.Items)
		}
		if res.NextCursor == nil || *res.NextCursor != "CUR1" {
			t.Fatalf("Episodes nextCursor mapping wrong: %+v", res.NextCursor)
		}
		// query params forwarded
		gq := got.URL.Query()
		if gq.Get("limit") != "2" || gq.Get("order") != "desc" || gq.Get("after") != "PREV" || gq.Get("asOf") == "" || gq.Get("q") != "Lisbon" {
			t.Fatalf("Episodes query not forwarded: %s", got.URL.RawQuery)
		}
		validateRequest(t, router, got)
	})

	t.Run("Episodes non-user scope returns empty without HTTP call", func(t *testing.T) {
		c := NewClient("http://unused.invalid", "test-key", http.DefaultClient)
		res, err := c.Episodes(context.Background(), "user-1", "session", EpisodeOptions{})
		if err != nil {
			t.Fatalf("Episodes(session): %v", err)
		}
		if res.Items == nil || len(res.Items) != 0 || res.NextCursor != nil {
			t.Fatalf("Episodes(session) should be empty non-nil with no cursor: %+v", res)
		}
	})

	t.Run("List threads from/to (ADR D3)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, 200, `{"items":[]}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		if _, err := c.List(context.Background(), "user-1", ListOptions{From: "2026-06-01T00:00:00Z", To: "2026-06-19T00:00:00Z"}); err != nil {
			t.Fatalf("List: %v", err)
		}
		if got.URL.Query().Get("from") == "" || got.URL.Query().Get("to") == "" {
			t.Fatalf("from/to not sent: %s", got.URL.RawQuery)
		}
		validateRequest(t, router, got)
	})
}

// Provider-capability boot guard (themory-gateway-provider-capability-guard F1):
// the gateway probes /v1/openapi.json at boot and must distinguish "provider
// advertises the scoped-forget DELETE" from "reachable but route absent" (deploy
// ordering bug → fatal) and from "unreachable/error" (transient → non-fatal).
func TestThemoryClient_ScopedForgetCapability(t *testing.T) {
	const openapiWith = `{"paths":{"/v1/scopes/{type}/{id}/memories/{memId}":{"delete":{"operationId":"scopedForget"}}}}`
	const openapiWithout = `{"paths":{"/v1/scopes/{type}/{id}/memories":{"get":{"operationId":"listScope"}}}}`

	t.Run("nil when the provider advertises the scopedForget DELETE", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusOK, openapiWith, &got)
		c := NewClient(srv.URL, "k", srv.Client())
		if err := c.AssertScopedForgetSupported(context.Background()); err != nil {
			t.Fatalf("expected nil, got %v", err)
		}
		if got.URL.Path != "/v1/openapi.json" {
			t.Fatalf("expected probe of /v1/openapi.json, got %s", got.URL.Path)
		}
	})

	t.Run("ErrProviderCapabilityMissing when the route is absent (reachable + parseable)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusOK, openapiWithout, &got)
		c := NewClient(srv.URL, "k", srv.Client())
		err := c.AssertScopedForgetSupported(context.Background())
		if !IsProviderCapabilityMissing(err) {
			t.Fatalf("expected ErrProviderCapabilityMissing, got %v", err)
		}
	})

	t.Run("404 on the openapi probe IS capability-missing (reachable, no contract doc → fatal)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusNotFound, `{}`, &got)
		c := NewClient(srv.URL, "k", srv.Client())
		err := c.AssertScopedForgetSupported(context.Background())
		if !IsProviderCapabilityMissing(err) {
			t.Fatalf("a 404 openapi probe must be capability-missing (provably old provider), got %v", err)
		}
	})

	t.Run("server error is NOT capability-missing (transient → non-fatal)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusServiceUnavailable, `down`, &got)
		c := NewClient(srv.URL, "k", srv.Client())
		err := c.AssertScopedForgetSupported(context.Background())
		if err == nil {
			t.Fatal("expected an error on 503")
		}
		if IsProviderCapabilityMissing(err) {
			t.Fatalf("a 503 must NOT be capability-missing, got %v", err)
		}
	})

	t.Run("malformed openapi is NOT capability-missing (fail-open → non-fatal)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusOK, `not json`, &got)
		c := NewClient(srv.URL, "k", srv.Client())
		err := c.AssertScopedForgetSupported(context.Background())
		if err == nil {
			t.Fatal("expected a parse error on malformed openapi")
		}
		if IsProviderCapabilityMissing(err) {
			t.Fatalf("malformed openapi must NOT be capability-missing, got %v", err)
		}
	})
}

// ClassifyBootCapability is the boot policy: fatal ONLY on provable capability
// absence; nil → proceed; everything else (transient) → warn (non-fatal).
func TestClassifyBootCapability(t *testing.T) {
	if got := ClassifyBootCapability(nil); got != BootProceed {
		t.Errorf("nil → %v, want BootProceed", got)
	}
	if got := ClassifyBootCapability(ErrProviderCapabilityMissing); got != BootFatal {
		t.Errorf("capability-missing → %v, want BootFatal", got)
	}
	if got := ClassifyBootCapability(fmt.Errorf("wrap: %w", ErrProviderCapabilityMissing)); got != BootFatal {
		t.Errorf("wrapped capability-missing → %v, want BootFatal", got)
	}
	if got := ClassifyBootCapability(errors.New("connection refused")); got != BootWarn {
		t.Errorf("transport error → %v, want BootWarn", got)
	}
}

// Failure scenarios (plan § Failure scenarios): external theo-data I/O.
func TestThemoryClient_FailureScenarios(t *testing.T) {
	t.Run("404 maps to ErrNotFound", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusNotFound, `{}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		err := c.Forget(context.Background(), "user-1", "missing", false)
		if !IsNotFound(err) {
			t.Fatalf("expected ErrNotFound on 404, got: %v", err)
		}
	})

	t.Run("422 (non-UUID memId) maps to *Error (no panic)", func(t *testing.T) {
		// The provider rejects a non-UUID memId on the scope-checked DELETE with
		// 422; do() must surface it as a typed *Error, not a panic or ErrNotFound.
		var got *http.Request
		srv := captureServer(t, http.StatusUnprocessableEntity, `{"error":"memId must be a UUID"}`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		err := c.Forget(context.Background(), "user-1", "not-a-uuid", false)
		var te *Error
		if !errors.As(err, &te) {
			t.Fatalf("expected *themory.Error on 422, got %T: %v", err, err)
		}
		if te.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("Error.StatusCode = %d, want 422", te.StatusCode)
		}
	})

	t.Run("503 maps to *Error (no panic)", func(t *testing.T) {
		var got *http.Request
		srv := captureServer(t, http.StatusServiceUnavailable, `upstream down`, &got)
		c := NewClient(srv.URL, "test-key", srv.Client())
		_, err := c.List(context.Background(), "user-1", ListOptions{})
		if err == nil {
			t.Fatal("expected error on 503, got nil")
		}
		var te *Error
		if !errors.As(err, &te) {
			t.Fatalf("expected *themory.Error on 503, got %T: %v", err, err)
		}
		if te.StatusCode != http.StatusServiceUnavailable {
			t.Errorf("Error.StatusCode = %d, want 503", te.StatusCode)
		}
	})
}
