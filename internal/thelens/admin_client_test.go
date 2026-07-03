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
	"strings"
	"testing"
)

// TestMintKey_ParsesFlatResponse — the load-bearing adaptation (ADR-3): theo-lens
// M22 returns a FLAT {id,name,key_prefix,scopes,workspace_id,secret} at HTTP 200,
// NOT theo-rag's nested {"key":{...},"raw_key":...}@201. A rag-verbatim copy would
// parse an empty Secret and 503 the broker.
func TestMintKey_ParsesFlatResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK) // theo-lens returns 200, not 201
		_, _ = w.Write([]byte(`{"id":"apk_x","name":"gw-t1","key_prefix":"tl","scopes":["observability:read"],"workspace_id":"t1","secret":"theo_live_abc"}`))
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "theo_live_platform", srv.Client())
	res, err := admin.MintKey(context.Background(), "t1", "gw-t1", []string{"observability:read"})
	if err != nil {
		t.Fatalf("MintKey: %v", err)
	}
	if res.ID != "apk_x" {
		t.Errorf("ID = %q, want apk_x", res.ID)
	}
	if res.Secret != "theo_live_abc" {
		t.Errorf("Secret = %q, want theo_live_abc (from the flat `secret` field)", res.Secret)
	}
	if len(res.Scopes) != 1 || res.Scopes[0] != "observability:read" {
		t.Errorf("Scopes = %v, want [observability:read]", res.Scopes)
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
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"k","scopes":["observability:write"],"secret":"theo_live_z"}`))
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "platform-secret", srv.Client())
	if _, err := admin.MintKey(context.Background(), "tenant-a", "gw-tenant-a", []string{"observability:write"}); err != nil {
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
	if len(scopes) != 1 || scopes[0] != "observability:write" {
		t.Errorf("body.scopes = %v, want [observability:write]", gotBody["scopes"])
	}
}

// TestMintKey_PropagatesHTTPError — a 4xx/5xx is a typed error, not an empty result.
func TestMintKey_PropagatesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"code":"INSUFFICIENT_SCOPE"}`))
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "weak-key", srv.Client())
	res, err := admin.MintKey(context.Background(), "t1", "n", []string{"observability:read"})
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

// TestMintKey_MissingSecret_FailsClosed — a 2xx body without `secret` MUST error,
// never a MintResult{Secret:""} the broker would cache for the full TTL.
func TestMintKey_MissingSecret_FailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x","scopes":["observability:read"]}`)) // no secret
	}))
	defer srv.Close()

	admin := NewAdminClient(srv.URL, "platform", srv.Client())
	res, err := admin.MintKey(context.Background(), "t1", "n", []string{"observability:read"})
	if err == nil {
		t.Fatal("expected an error when secret is missing (fail-closed), got nil")
	}
	if res != nil {
		t.Errorf("result = %v, want nil (never an empty-secret result)", res)
	}
}

// TestError_DoesNotLeakPlatformKey — the typed error carries only upstream status +
// body; the platform credential must never appear in it.
func TestError_DoesNotLeakPlatformKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`upstream boom`))
	}))
	defer srv.Close()

	const platform = "theo_live_SUPER_SECRET_PLATFORM"
	admin := NewAdminClient(srv.URL, platform, srv.Client())
	_, err := admin.MintKey(context.Background(), "t1", "n", []string{"observability:read"})
	if err == nil {
		t.Fatal("expected an error on 500")
	}
	if got := err.Error(); strings.Contains(got, platform) {
		t.Errorf("error text leaked the platform key: %q", got)
	}
}
