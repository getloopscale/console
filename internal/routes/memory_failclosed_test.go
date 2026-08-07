// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Model B slice 2 / T5.1 — handler-level fail-closed: when the per-tenant key
// cannot be resolved (broker mint failure surfaces as a client error), the
// memory handler returns 5xx and NEVER serves data. Combined with the
// client-level test (the data client makes no HTTP call on resolver error) and
// the theo-memory provider enforcement (a ws-A key cannot read ws-B), this
// closes the confused-deputy: there is no path where a failed per-tenant
// resolution silently degrades to a master-key (cross-tenant) read.
package routes

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/themory"
)

// brokerFailClient simulates the data client when the per-tenant key resolver
// (broker) fails: every call returns a wrapped non-4xx error, exactly as
// themory.Client.do() does when keyResolver returns an error.
type brokerFailClient struct {
	TheMemoryClient
}

func (brokerFailClient) List(_ context.Context, _ string, _ themory.ListOptions) (*themory.ListResult, error) {
	return nil, errors.New("themory: resolve per-tenant key: broker mint failed")
}

func TestList_PerTenantKeyResolutionFailure_FailsClosed(t *testing.T) {
	h := NewMemoryHandler(brokerFailClient{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	req := httptest.NewRequest(http.MethodGet, "/v1/memory/list", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "u1", TenantID: "tn-1"}))
	w := httptest.NewRecorder()

	h.List(w, req)

	// Fail-closed: a resolver/broker failure is an upstream-unavailable condition,
	// mapped to 502 — NEVER 200 (which would imply data was served via a fallback).
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 fail-closed on per-tenant key resolution failure, got %d", w.Code)
	}
}
