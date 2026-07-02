// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/config"
	"github.com/usetheodev/theo-cloud/internal/routes"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func stubResolve(context.Context, string) (*auth.UserContext, []string, error) {
	return nil, nil, nil
}
func stubAuthorize(context.Context, string, string) (bool, error) { return true, nil }

// M14 T4.1 — buildRagForwardAuth is nil (feature off) when RAG_BASE_URL is unset.
// M16 T2.1 — the broker is ALSO nil when unset (no MCP binding either).
func TestBuildRagForwardAuth_Disabled_WhenBaseURLUnset(t *testing.T) {
	h, broker, err := buildRagForwardAuth(config.Config{RagBaseURL: ""}, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when RAG_BASE_URL unset: %v", err)
	}
	if h != nil {
		t.Fatal("handler should be nil (feature off) when RAG_BASE_URL is unset")
	}
	if broker != nil {
		t.Fatal("broker should be nil (feature off) when RAG_BASE_URL is unset")
	}
}

// M14 T4.1 — when RAG_BASE_URL is set (with a platform key), the handler is wired.
// M16 T2.1 (D2) — the broker is ALSO returned so the SAME broker can serve both the
// REST ForwardAuth handler AND the MCP-resolve rag binding (one mint cache).
func TestBuildRagForwardAuth_Wired_WhenConfigured(t *testing.T) {
	cfg := config.Config{
		RagBaseURL:          "http://theo-rag:8787",
		RagPlatformAdminKey: config.Secret("rag_live_platform"),
	}
	h, broker, err := buildRagForwardAuth(cfg, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when configured: %v", err)
	}
	if h == nil {
		t.Fatal("handler should be non-nil when RAG_BASE_URL is configured")
	}
	if broker == nil {
		t.Fatal("broker should be non-nil when configured (M16 D2 — exposed for the MCP binding)")
	}
}

// M17 T3.1 — the /v1/dashboard/rag BFF route set is READ-ONLY: every registered route
// is a GET; a mutating verb (POST/PUT/PATCH/DELETE) must be structurally absent (the
// roadmap risk-1 guard). Walks the actual mounted routes via chi.Walk.
func TestRagDashboard_ReadOnlyRouteSet(t *testing.T) {
	r := chi.NewRouter()
	h := routes.NewRagDashboardHandler(nil, quietLogger())
	passthrough := func(next http.Handler) http.Handler { return next } // stand-in for requireJWT
	mountRagDashboard(r, h, passthrough)

	methods := map[string]int{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/v1/dashboard/rag") {
			methods[method]++
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if methods["GET"] == 0 {
		t.Fatal("expected GET routes under /v1/dashboard/rag")
	}
	for _, mutating := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		if methods[mutating] != 0 {
			t.Fatalf("MUTATING verb %s found under /v1/dashboard/rag — the BFF MUST be read-only (%d routes)", mutating, methods[mutating])
		}
	}
}
