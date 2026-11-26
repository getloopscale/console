// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// RED tests — Model B slice 2 / T3.1: the data-plane Client authenticates with
// a PER-TENANT Bearer resolved from context (the broker), not a master key; a
// resolver error fails the request CLOSED (no HTTP call with a master credential).
//
// @see .claude/knowledge-base/plans/model-b-credential-broker-plan.md § T3.1 (ADR D1)
package loopmem

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestClient_DataCall_SendsResolvedPerTenantBearer(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"memories":[]}`))
	}))
	defer srv.Close()

	// Empty apiKey + a resolver → the data client cannot use a master credential.
	c := NewClient(srv.URL, "", srv.Client()).
		WithKeyResolver(func(_ context.Context) (string, error) {
			return "theo_live_per_tenant_key", nil
		})
	if _, err := c.List(context.Background(), "u-1", ListOptions{}); err != nil {
		t.Fatalf("List error: %v", err)
	}
	if gotAuth != "Bearer theo_live_per_tenant_key" {
		t.Fatalf("expected per-tenant Bearer, got %q", gotAuth)
	}
}

func TestClient_DataCall_ResolverError_FailsClosed(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", srv.Client()).
		WithKeyResolver(func(_ context.Context) (string, error) {
			return "", errors.New("broker: mint failed")
		})
	_, err := c.List(context.Background(), "u-1", ListOptions{})
	if err == nil {
		t.Fatal("expected fail-closed error when resolver fails, got nil")
	}
	if hits.Load() != 0 {
		t.Fatalf("expected NO upstream call on resolver failure (fail-closed), got %d", hits.Load())
	}
}
