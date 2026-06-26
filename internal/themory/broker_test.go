// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// RED tests — Model B slice 2 / T2.1: the per-tenant credential broker.
// Lazy cache-aside (LRU + TTL) with singleflight coalescing; FAILS CLOSED on a
// mint error (never returns a fallback / master key). The fail-closed property
// is THE Model B invariant — a fallback would re-open the confused deputy.
//
// @see .claude/knowledge-base/plans/model-b-credential-broker-plan.md § T2.1 (ADR D3)
package themory

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// countingMinter is a goroutine-safe stub admin minter.
type countingMinter struct {
	mints  atomic.Int64
	fail   bool
	secret string
	delay  time.Duration
}

func (m *countingMinter) MintKey(_ context.Context, workspaceID, _ string, _ []string) (*MintResult, error) {
	m.mints.Add(1)
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	if m.fail {
		return nil, errors.New("admin api down")
	}
	return &MintResult{ID: "apk-" + workspaceID, Secret: m.secret + "-" + workspaceID}, nil
}

func newTestBroker(t *testing.T, m minter) *Broker {
	t.Helper()
	b, err := NewBroker(m, 64, time.Hour, []string{"memory:read", "memory:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	return b
}

func TestBroker_CacheMiss_MintsOnce(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	got, err := b.KeyForTenant(context.Background(), "tn-1")
	if err != nil || got != "sek-tn-1" {
		t.Fatalf("got %q err %v", got, err)
	}
	if m.mints.Load() != 1 {
		t.Fatalf("expected 1 mint, got %d", m.mints.Load())
	}
}

func TestBroker_CacheHit_NoSecondMint(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	_, _ = b.KeyForTenant(context.Background(), "tn-1")
	_, _ = b.KeyForTenant(context.Background(), "tn-1")
	if m.mints.Load() != 1 {
		t.Fatalf("expected 1 mint (cache hit), got %d", m.mints.Load())
	}
}

func TestBroker_MintFailure_ReturnsErrorNoFallback(t *testing.T) {
	m := &countingMinter{fail: true}
	b := newTestBroker(t, m)
	got, err := b.KeyForTenant(context.Background(), "tn-1")
	if err == nil {
		t.Fatal("expected fail-closed error, got nil")
	}
	if got != "" {
		t.Fatalf("expected empty secret on failure (no fallback), got %q", got)
	}
}

func TestBroker_TTLExpiry_ReMints(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	now := time.Now()
	b.now = func() time.Time { return now }
	_, _ = b.KeyForTenant(context.Background(), "tn-1")
	now = now.Add(2 * time.Hour) // advance past the 1h TTL
	_, _ = b.KeyForTenant(context.Background(), "tn-1")
	if m.mints.Load() != 2 {
		t.Fatalf("expected re-mint after TTL, got %d mints", m.mints.Load())
	}
}

func TestBroker_ConcurrentColdMissMintsOnce(t *testing.T) {
	// Race-aware: N goroutines for the SAME cold tenant must coalesce to 1 mint
	// (singleflight). Atomic-counter invariant. Run under `go test -race`.
	m := &countingMinter{secret: "sek", delay: 20 * time.Millisecond}
	b := newTestBroker(t, m)
	const n = 16
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, _ = b.KeyForTenant(context.Background(), "tn-hot")
		}()
	}
	wg.Wait()
	if m.mints.Load() != 1 {
		t.Fatalf("singleflight failed: expected 1 mint for concurrent cold misses, got %d", m.mints.Load())
	}
}

// --- platform-api-gateway M6: KeyForTenantScoped least-privilege --------------

type scopeCapturingMinter struct {
	lastScopes []string
}

func (m *scopeCapturingMinter) MintKey(_ context.Context, workspaceID, _ string, scopes []string) (*MintResult, error) {
	m.lastScopes = scopes
	return &MintResult{ID: "apk-" + workspaceID, Secret: "sec-" + workspaceID}, nil
}

func TestBroker_KeyForTenantScoped_MintsLeastPrivilegeIntersection(t *testing.T) {
	m := &scopeCapturingMinter{}
	b, err := NewBroker(m, 64, time.Hour, []string{"memory:read", "memory:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}

	// A read-only consumer must mint a read-only key — never the gateway superset.
	if _, err := b.KeyForTenantScoped(context.Background(), "tn-x", []string{"memory:read"}); err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if len(m.lastScopes) != 1 || m.lastScopes[0] != "memory:read" {
		t.Fatalf("escalation: minted %v, want [memory:read]", m.lastScopes)
	}

	// A consumer asking for more than the gateway supports gets the intersection
	// (memory:delete is filtered — the gateway broker only grants read+write).
	if _, err := b.KeyForTenantScoped(context.Background(), "tn-y",
		[]string{"memory:read", "memory:write", "memory:delete"}); err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if len(m.lastScopes) != 2 || m.lastScopes[0] != "memory:read" || m.lastScopes[1] != "memory:write" {
		t.Fatalf("intersection wrong: minted %v, want [memory:read memory:write]", m.lastScopes)
	}
}

func TestBroker_KeyForTenantScoped_NoGrantableScope_FailsClosed(t *testing.T) {
	m := &scopeCapturingMinter{}
	b, _ := NewBroker(m, 64, time.Hour, []string{"memory:read"})
	// The consumer holds only a scope the gateway does not grant → fail closed.
	if _, err := b.KeyForTenantScoped(context.Background(), "tn-z", []string{"memory:delete"}); err == nil {
		t.Fatal("want error when no scope is grantable (fail-closed), got nil")
	}
}
