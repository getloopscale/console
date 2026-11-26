// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package rag

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestMintKey_ParsesNestedResponse — the load-bearing adaptation (EC-1): looprag
// M12 returns {"key":{"id","scopes"},"raw_key":"rag_live_..."}, NOT TheMemory's
// flat {"id","secret"}. A verbatim copy would yield an empty Secret.
func TestMintKey_ParsesNestedResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"key":{"id":"akey_x","name":"gw-t1","scopes":["rag:read"]},"raw_key":"rag_live_abc"}`))
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "rag_live_platform", srv.Client())
	res, err := admin.MintKey(context.Background(), "t1", "gw-t1", []string{"rag:read"})
	if err != nil {
		t.Fatalf("MintKey: %v", err)
	}
	if res.ID != "akey_x" {
		t.Errorf("ID = %q, want akey_x", res.ID)
	}
	if res.Secret != "rag_live_abc" {
		t.Errorf("Secret = %q, want rag_live_abc (from raw_key)", res.Secret)
	}
	if len(res.Scopes) != 1 || res.Scopes[0] != "rag:read" {
		t.Errorf("Scopes = %v, want [rag:read]", res.Scopes)
	}
}

// TestMintKey_SendsCorrectRequest — POST /v1/admin/keys, body {name,scopes,workspace_id},
// Authorization: Bearer <platformKey>.
func TestMintKey_SendsCorrectRequest(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"key":{"id":"k","scopes":["rag:write"]},"raw_key":"rag_live_z"}`))
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "platform-secret", srv.Client())
	if _, err := admin.MintKey(context.Background(), "tenant-a", "gw-tenant-a", []string{"rag:write"}); err != nil {
		t.Fatalf("MintKey: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/admin/keys" {
		t.Errorf("request = %s %s, want POST /v1/admin/keys", gotMethod, gotPath)
	}
	if gotAuth != "Bearer platform-secret" {
		t.Errorf("Authorization = %q, want Bearer platform-secret", gotAuth)
	}
	if gotBody["name"] != "gw-tenant-a" || gotBody["workspace_id"] != "tenant-a" {
		t.Errorf("body = %v, want name=gw-tenant-a workspace_id=tenant-a", gotBody)
	}
	scopes, _ := gotBody["scopes"].([]any)
	if len(scopes) != 1 || scopes[0] != "rag:write" {
		t.Errorf("body.scopes = %v, want [rag:write]", gotBody["scopes"])
	}
}

// TestMintKey_PropagatesHTTPError — a 4xx/5xx is a typed error, not an empty result.
func TestMintKey_PropagatesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"insufficient_scope"}`))
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "weak-key", srv.Client())
	res, err := admin.MintKey(context.Background(), "t1", "n", []string{"rag:read"})
	if err == nil {
		t.Fatal("expected an error on 403, got nil")
	}
	if res != nil {
		t.Errorf("result = %v, want nil on error", res)
	}
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusForbidden {
		t.Errorf("err = %v, want *Error{403}", err)
	}
}

// TestMintKey_MissingRawKey_FailsClosed (EC-1) — a 2xx body without raw_key MUST
// error, never a MintResult{Secret:""} the broker would cache for the full TTL.
func TestMintKey_MissingRawKey_FailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"key":{"id":"x","scopes":["rag:read"]}}`)) // no raw_key
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "platform", srv.Client())
	res, err := admin.MintKey(context.Background(), "t1", "n", []string{"rag:read"})
	if err == nil {
		t.Fatal("expected an error when raw_key is missing (fail-closed), got nil")
	}
	if res != nil {
		t.Errorf("result = %v, want nil (never an empty-secret result)", res)
	}
}
