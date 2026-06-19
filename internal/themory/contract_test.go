// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package themory

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
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
// memories + POST /v1/forget). They drive the real client against an httptest
// stub that captures the request, then validate it with openapi3filter. Plus the
// failure scenarios (404 → ErrNotFound; 5xx → *Error).
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
		// during validation (the POST /v1/forget body must survive the clone).
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

	t.Run("Forget delegates POST /v1/forget for an owned id", func(t *testing.T) {
		// Forget is now two requests: the ownership listing (GET 200 + items)
		// then the delegated delete (POST 204). Route by method, capturing the
		// POST for spec validation.
		var got *http.Request
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"items":[{"id":"mem-123","text":"x","createdAt":"2026-06-18T00:00:00Z"}]}`))
				return
			}
			buf, _ := io.ReadAll(r.Body)
			clone := r.Clone(context.Background())
			clone.Body = io.NopCloser(bytes.NewReader(buf))
			got = clone
			w.WriteHeader(http.StatusNoContent)
		}))
		t.Cleanup(srv.Close)

		c := NewClient(srv.URL, "test-key", srv.Client())
		if err := c.Forget(context.Background(), "user-1", "mem-123", false); err != nil {
			t.Fatalf("Forget: %v", err)
		}
		if got == nil || got.Method != http.MethodPost {
			t.Fatalf("expected captured POST /v1/forget, got %+v", got)
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
