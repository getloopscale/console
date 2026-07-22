// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// RED tests — Model B slice 2 / T1.1: the control-plane admin client that mints
// and revokes per-tenant trust_live_* keys via TheMemory's admin API using the
// platform-admin credential. Frozen wire: POST /v1/admin/keys with the platform
// Bearer + a target workspace_id; DELETE /v1/admin/keys/{id}.
//
// @see .claude/knowledge-base/plans/model-b-credential-broker-plan.md § T1.1 (ADR D1)
package trust

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminClient_MintKey_SendsPlatformBearerAndWorkspace(t *testing.T) {
	const platformKey = "trust_live_platform_admin_key_value_000000000000"
	var gotAuth, gotPath, gotMethod string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		gotMethod = r.Method
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"apk-abc","secret":"trust_live_minted_secret","scopes":["trust:read"]}`))
	}))
	defer srv.Close()

	ac := NewAdminClient(srv.URL, platformKey, srv.Client())
	res, err := ac.MintKey(context.Background(), "tn-123", "gw-tn-123", []string{"trust:read", "trust:write"})
	if err != nil {
		t.Fatalf("MintKey error: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/admin/keys" {
		t.Fatalf("wire mismatch: %s %s", gotMethod, gotPath)
	}
	if gotAuth != "Bearer "+platformKey {
		t.Fatalf("expected platform Bearer, got %q", gotAuth)
	}
	if gotBody["workspace_id"] != "tn-123" {
		t.Fatalf("expected workspace_id tn-123, got %v", gotBody["workspace_id"])
	}
	if res.Secret != "trust_live_minted_secret" || res.ID != "apk-abc" {
		t.Fatalf("unexpected mint result: %+v", res)
	}
}

func TestAdminClient_MintKey_MapsUpstream403ToError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"code":"SCOPE_INSUFFICIENT","message":"no"}`))
	}))
	defer srv.Close()

	ac := NewAdminClient(srv.URL, "trust_live_x", srv.Client())
	_, err := ac.MintKey(context.Background(), "tn-1", "n", []string{"trust:read"})
	if err == nil {
		t.Fatal("expected an error on 403, got nil")
	}
	var ue *Error
	if !errors.As(err, &ue) || ue.StatusCode != http.StatusForbidden {
		t.Fatalf("expected *Error with 403, got %v", err)
	}
}

