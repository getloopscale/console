// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/config"
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
