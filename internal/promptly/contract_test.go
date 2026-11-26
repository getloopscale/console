// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package promptly

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// M11 Risk-2 — cloud ↔ loopprompt control-plane contract. The broker's
// AdminClient is the CONSUMER of loopprompt's POST /admin/keys; these tests
// drive the real admin_client (via the broker) against an httptest stub that
// captures the request, then validate it against openapi/promptly.yaml with
// openapi3filter. A drift in the request shape fails fast here, before prod.

const promptlySpec = "../../openapi/promptly.yaml"

func loadPromptlySpec(t *testing.T) routers.Router {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromFile(promptlySpec)
	if err != nil {
		t.Fatalf("load promptly.yaml: %v", err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("promptly.yaml invalid: %v", err)
	}
	router, err := gorillamux.NewRouter(doc)
	if err != nil {
		t.Fatalf("build router from promptly.yaml: %v", err)
	}
	return router
}

func captureServer(t *testing.T, status int, body string, captured **http.Request) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		t.Fatalf("promptly.yaml has no route for %s %s: %v", req.Method, req.URL.Path, err)
	}
	in := &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
		Options:    &openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc},
	}
	if err := openapi3filter.ValidateRequest(context.Background(), in); err != nil {
		t.Fatalf("admin_client request to %s %s does not conform to promptly.yaml: %v",
			req.Method, req.URL.Path, err)
	}
}

func TestContract_MintRequestConformsToSpec(t *testing.T) {
	router := loadPromptlySpec(t)
	var got *http.Request
	srv := captureServer(t, 201, `{"id":"k1","secret":"promptly_live_x","keyPrefix":"promptly_live_xx"}`, &got)

	ac := NewAdminClient(srv.URL, testPlatformKey, srv.Client())
	if _, err := ac.MintKey(context.Background(), "ws-a", "gw-ws-a", []string{"prompt:read"}); err != nil {
		t.Fatalf("MintKey: %v", err)
	}
	validateRequest(t, router, got)
}

func TestContract_TenantIsolation(t *testing.T) {
	// The broker mints distinct keys per tenant; the captured requests carry the
	// distinct workspace_id so loopprompt isolates the data downstream.
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		if ws, ok := body["workspace_id"].(string); ok {
			seen = append(seen, ws)
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id":"k","secret":"promptly_live_s","keyPrefix":"p"}`))
	}))
	defer srv.Close()

	b, err := NewBroker(NewAdminClient(srv.URL, testPlatformKey, srv.Client()), 16, time.Hour, []string{"prompt:read"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-b", []string{"promptly:read"})

	if len(seen) != 2 || seen[0] == seen[1] {
		t.Fatalf("expected two distinct workspace_ids, got %v", seen)
	}
}

func TestContract_ScopeEnforcement(t *testing.T) {
	// A promptly:read consumer must mint ONLY prompt:read (least-privilege) — the
	// captured request body never carries prompt:write/admin.
	var gotScopes []any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		if sc, ok := body["scopes"].([]any); ok {
			gotScopes = sc
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id":"k","secret":"promptly_live_s","keyPrefix":"p"}`))
	}))
	defer srv.Close()

	b, err := NewBroker(NewAdminClient(srv.URL, testPlatformKey, srv.Client()), 16, time.Hour, []string{"prompt:read", "prompt:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})

	if len(gotScopes) != 1 || gotScopes[0] != "prompt:read" {
		t.Fatalf("least-privilege violated: minted scopes %v, want [prompt:read]", gotScopes)
	}
}
