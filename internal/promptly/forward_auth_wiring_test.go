// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package promptly_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/promptly"
	"github.com/getloopscale/loop-console/internal/routes"
)

// M11 T3.1 — the promptly ForwardAuth WIRING: the generic ForwardAuthHandler
// (ADR D5, reused) instantiated with required scope "promptly:read" + a REAL
// promptly broker (which translates promptly:* -> prompt:* and mints per-tenant).
// The Del-then-set Authorization invariant itself is covered by the generic
// internal/routes/forward_auth_test.go; here we prove the promptly-specific
// composition mints the right thing and fails closed.

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func resolve(uc *auth.UserContext, scopes []string, err error) routes.APIKeyResolver {
	return func(context.Context, string) (*auth.UserContext, []string, error) { return uc, scopes, err }
}

func allowOwn(_ context.Context, _, _ string) (bool, error) { return true, nil }

// brokerWithUpstream builds a real promptly.Broker over an httptest loopprompt
// admin stub that always mints, capturing the minted scopes.
func brokerWithUpstream(t *testing.T, capturedScopes *[]any) *promptly.Broker {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		if capturedScopes != nil {
			if sc, ok := body["scopes"].([]any); ok {
				*capturedScopes = sc
			}
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id":"k","secret":"promptly_live_minted","keyPrefix":"p"}`))
	}))
	t.Cleanup(srv.Close)
	b, err := promptly.NewBroker(promptly.NewAdminClient(srv.URL, "promptly_live_platform", srv.Client()),
		16, time.Hour, []string{"prompt:read", "prompt:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	return b
}

func serve(h *routes.ForwardAuthHandler) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, routes.AuthzForwardPromptlyPath, nil)
	req.Header.Set("Authorization", "Bearer theo_live_consumer")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestForwardPromptly_DelThenSetAuthorization(t *testing.T) {
	var minted []any
	b := brokerWithUpstream(t, &minted)
	h := routes.NewForwardAuthHandler(
		resolve(&auth.UserContext{Subject: "u", TenantID: "tenant-a"}, []string{"promptly:read"}, nil),
		b, allowOwn, "promptly:read", quiet())

	rec := serve(h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	got := rec.Header().Get("Authorization")
	if got != "Bearer promptly_live_minted" {
		t.Fatalf("want minted Authorization, got %q (must NOT be the consumer's key)", got)
	}
	// least-privilege: promptly:read consumer -> minted prompt:read only.
	if len(minted) != 1 || minted[0] != "prompt:read" {
		t.Fatalf("minted scopes %v, want [prompt:read]", minted)
	}
}

func TestForwardPromptly_403WithoutScope(t *testing.T) {
	b := brokerWithUpstream(t, nil)
	h := routes.NewForwardAuthHandler(
		resolve(&auth.UserContext{Subject: "u", TenantID: "tenant-a"}, []string{"memory:read"}, nil),
		b, allowOwn, "promptly:read", quiet())

	rec := serve(h)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: got %d want 403", rec.Code)
	}
	if got := rec.Header().Get("Authorization"); got != "" {
		t.Fatalf("a deny MUST NOT carry an Authorization header, got %q", got)
	}
}

func TestForwardPromptly_503OnMintError(t *testing.T) {
	// Upstream loopprompt is down → broker fails closed → handler 503, no Authorization.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	b, _ := promptly.NewBroker(promptly.NewAdminClient(srv.URL, "k", srv.Client()), 16, time.Hour, []string{"prompt:read"})
	h := routes.NewForwardAuthHandler(
		resolve(&auth.UserContext{Subject: "u", TenantID: "tenant-a"}, []string{"promptly:read"}, nil),
		b, allowOwn, "promptly:read", quiet())

	rec := serve(h)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503 (fail-closed)", rec.Code)
	}
	if got := rec.Header().Get("Authorization"); got != "" {
		t.Fatalf("fail-closed MUST NOT carry Authorization, got %q", got)
	}
}
