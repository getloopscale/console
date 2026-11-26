// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package promptly

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testPlatformKey = "promptly_live_platform_admin_secret"

func TestAdminClient_MintPostsToAdminKeys(t *testing.T) {
	var gotPath, gotAuth string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"k1","secret":"promptly_live_minted","keyPrefix":"promptly_live_xx"}`))
	}))
	defer srv.Close()

	ac := NewAdminClient(srv.URL, testPlatformKey, srv.Client())
	res, err := ac.MintKey(context.Background(), "ws-a", "gw-ws-a", []string{"prompt:read"})
	if err != nil {
		t.Fatalf("MintKey: %v", err)
	}
	if gotPath != "/admin/keys" {
		t.Errorf("path: got %q want /admin/keys (native, no /v1)", gotPath)
	}
	if gotAuth != "Bearer "+testPlatformKey {
		t.Errorf("auth: got %q want Bearer <platformKey>", gotAuth)
	}
	if gotBody["workspace_id"] != "ws-a" {
		t.Errorf("workspace_id: got %v want ws-a", gotBody["workspace_id"])
	}
	if res.Secret != "promptly_live_minted" {
		t.Errorf("secret: got %q", res.Secret)
	}
}

func TestAdminClient_FailClosedOn5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"down"}`))
	}))
	defer srv.Close()

	ac := NewAdminClient(srv.URL, testPlatformKey, srv.Client())
	res, err := ac.MintKey(context.Background(), "ws-a", "gw", []string{"prompt:read"})
	if err == nil {
		t.Fatal("expected error on 503")
	}
	if res != nil {
		t.Errorf("expected nil result on error, got %+v", res)
	}
}

func TestAdminClient_PlatformKeyNeverInError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer srv.Close()

	ac := NewAdminClient(srv.URL, testPlatformKey, srv.Client())
	_, err := ac.MintKey(context.Background(), "ws-a", "gw", []string{"prompt:read"})
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), testPlatformKey) {
		t.Fatalf("platform key leaked into error: %v", err)
	}
}

func TestNewAdminClient_NilHTTPClientDefaults(t *testing.T) {
	// Construct with nil httpClient → falls back to http.DefaultClient (no panic).
	ac := NewAdminClient("http://example.test/", testPlatformKey, nil)
	if ac == nil || ac.httpClient == nil {
		t.Fatal("nil httpClient must default to http.DefaultClient")
	}
	if ac.baseURL != "http://example.test" {
		t.Errorf("baseURL must be right-trimmed, got %q", ac.baseURL)
	}
}

func TestAdminClient_NetworkErrorIsFailClosed(t *testing.T) {
	// An unreachable upstream → MintKey returns an error (fail-closed), no secret.
	ac := NewAdminClient("http://127.0.0.1:1/", testPlatformKey, &http.Client{})
	_, err := ac.MintKey(context.Background(), "ws-a", "gw", []string{"prompt:read"})
	if err == nil {
		t.Fatal("expected a network error to fail closed")
	}
}

func TestAdminClient_EmptySecretIsError(t *testing.T) {
	// EC-1: a 201 without `secret` must be an error, never cached as empty.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"k1","keyPrefix":"promptly_live_xx"}`))
	}))
	defer srv.Close()

	ac := NewAdminClient(srv.URL, testPlatformKey, srv.Client())
	_, err := ac.MintKey(context.Background(), "ws-a", "gw", []string{"prompt:read"})
	if err == nil {
		t.Fatal("expected error when minted secret is empty")
	}
}
