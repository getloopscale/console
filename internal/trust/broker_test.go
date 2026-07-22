// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// RED tests — Model B slice 2 / T2.1: the per-tenant credential broker.
// Lazy cache-aside (LRU + TTL) with singleflight coalescing; FAILS CLOSED on a
// mint error (never returns a fallback / master key). The fail-closed property
// is THE Model B invariant — a fallback would re-open the confused deputy.
//
// @see .claude/knowledge-base/plans/model-b-credential-broker-plan.md § T2.1 (ADR D3)
package trust

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
	b, err := NewBroker(m, 64, time.Hour, []string{"trust:read", "trust:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	return b
}

func TestBroker_CacheMiss_MintsOnce(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	got, err := b.KeyForTenant(context.Background(), "acct-1", "tn-1")
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
	_, _ = b.KeyForTenant(context.Background(), "acct-1", "tn-1")
	_, _ = b.KeyForTenant(context.Background(), "acct-1", "tn-1")
	if m.mints.Load() != 1 {
		t.Fatalf("expected 1 mint (cache hit), got %d", m.mints.Load())
	}
}

func TestBroker_MintFailure_ReturnsErrorNoFallback(t *testing.T) {
	m := &countingMinter{fail: true}
	b := newTestBroker(t, m)
	got, err := b.KeyForTenant(context.Background(), "acct-1", "tn-1")
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
	_, _ = b.KeyForTenant(context.Background(), "acct-1", "tn-1")
	now = now.Add(2 * time.Hour) // advance past the 1h TTL
	_, _ = b.KeyForTenant(context.Background(), "acct-1", "tn-1")
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
			_, _ = b.KeyForTenant(context.Background(), "acct-1", "tn-hot")
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
	b, err := NewBroker(m, 64, time.Hour, []string{"trust:read", "trust:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}

	// A read-only consumer must mint a read-only key — never the gateway superset.
	if _, err := b.KeyForTenantScoped(context.Background(), "acct-1", "tn-x", []string{"trust:read"}); err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if len(m.lastScopes) != 1 || m.lastScopes[0] != "trust:read" {
		t.Fatalf("escalation: minted %v, want [trust:read]", m.lastScopes)
	}

	// A consumer asking for more than the gateway supports gets the intersection
	// (trust:delete is filtered — the gateway broker only grants read+write).
	if _, err := b.KeyForTenantScoped(context.Background(), "acct-1", "tn-y",
		[]string{"trust:read", "trust:write", "trust:delete"}); err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if len(m.lastScopes) != 2 || m.lastScopes[0] != "trust:read" || m.lastScopes[1] != "trust:write" {
		t.Fatalf("intersection wrong: minted %v, want [trust:read trust:write]", m.lastScopes)
	}
}

func TestBroker_KeyForTenantScoped_NoGrantableScope_FailsClosed(t *testing.T) {
	m := &scopeCapturingMinter{}
	b, _ := NewBroker(m, 64, time.Hour, []string{"trust:read"})
	// The consumer holds only a scope the gateway does not grant → fail closed.
	if _, err := b.KeyForTenantScoped(context.Background(), "acct-1", "tn-z", []string{"trust:delete"}); err == nil {
		t.Fatal("want error when no scope is grantable (fail-closed), got nil")
	}
}

// --- M1: Account-aware mint (lazy validation) ---------------------------------

// wsCapturingMinter records the workspaceID the broker mints against.
type wsCapturingMinter struct {
	mu           sync.Mutex
	lastWorkspace string
	mints        atomic.Int64
}

func (m *wsCapturingMinter) MintKey(_ context.Context, workspaceID, _ string, _ []string) (*MintResult, error) {
	m.mu.Lock()
	m.lastWorkspace = workspaceID
	m.mu.Unlock()
	m.mints.Add(1)
	return &MintResult{ID: "apk-" + workspaceID, Secret: "sec-" + workspaceID}, nil
}

// M1 T1.1 — accountID is threaded into the cache key but NEVER to the minter:
// the minted key's workspace_id stays == tenantID (theo-memory isolation unit is
// the tenant, unchanged). This is the seam-preservation invariant (ADR-M1-3).
func TestBroker_KeyForTenantScoped_ThreadsAccountID_WorkspaceStaysTenant(t *testing.T) {
	m := &wsCapturingMinter{}
	b := newTestBroker(t, m)
	if _, err := b.KeyForTenantScoped(context.Background(), "acct-AAA", "tn-X", []string{"trust:read"}); err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if m.lastWorkspace != "tn-X" {
		t.Fatalf("workspace leaked the account: minted workspace_id=%q, want tenantID %q (account must NOT cross to the data-plane)", m.lastWorkspace, "tn-X")
	}
}

// M1 T1.1 — the cache key includes accountID: the same tenant under two distinct
// accounts mints two distinct cached secrets (no cross-account cache sharing),
// while the same (account, tenant) hits the cache.
func TestBroker_CacheKeyIncludesAccount(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	ctx := context.Background()
	if _, err := b.KeyForTenantScoped(ctx, "acct-A", "tn-shared", []string{"trust:read"}); err != nil {
		t.Fatalf("mint A: %v", err)
	}
	if _, err := b.KeyForTenantScoped(ctx, "acct-B", "tn-shared", []string{"trust:read"}); err != nil {
		t.Fatalf("mint B: %v", err)
	}
	if m.mints.Load() != 2 {
		t.Fatalf("distinct accounts on the same tenant must NOT share a cache entry: want 2 mints, got %d", m.mints.Load())
	}
	// Same (account, tenant, scopes) again → cache hit, no third mint.
	if _, err := b.KeyForTenantScoped(ctx, "acct-A", "tn-shared", []string{"trust:read"}); err != nil {
		t.Fatalf("mint A again: %v", err)
	}
	if m.mints.Load() != 2 {
		t.Fatalf("same (account,tenant,scopes) must hit cache: want 2 mints, got %d", m.mints.Load())
	}
}

// M1 T1.1 — N goroutines minting for N distinct (account, tenant) pairs each mint
// exactly once with no cross-pair collision. Run under `go test -race`.
func TestBroker_ConcurrentDistinctAccounts_NoCollision(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	const n = 16
	var wg sync.WaitGroup
	wg.Add(n)
	secrets := make([]string, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			acc := "acct-" + string(rune('A'+i))
			ten := "tn-" + string(rune('A'+i))
			s, _ := b.KeyForTenantScoped(context.Background(), acc, ten, []string{"trust:read"})
			secrets[i] = s
		}(i)
	}
	wg.Wait()
	if m.mints.Load() != n {
		t.Fatalf("distinct pairs must each mint once: want %d mints, got %d", n, m.mints.Load())
	}
	seen := map[string]bool{}
	for i, s := range secrets {
		if s == "" || seen[s] {
			t.Fatalf("secret collision/empty at %d: %q", i, s)
		}
		seen[s] = true
	}
}

// M1 (review MEDIUM) — Evict(tenant) must match the tenant as the MIDDLE segment
// of the account∥tenant∥scopes cache key (the old Remove(tenantID) never hit a
// scoped key — a latent no-op this PR corrected). Mirrors promptly's coverage.
func TestBroker_EvictForcesRemint(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "tn-a", []string{"trust:read"})
	b.Evict("tn-a")
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "tn-a", []string{"trust:read"})
	if m.mints.Load() != 2 {
		t.Fatalf("expected re-mint after Evict(tenant), got %d mints", m.mints.Load())
	}
}

// M1 (review LOW — symmetry with promptly) — an empty tenant id is rejected
// (defense-in-depth: a future caller bypassing the resolver guard must never mint
// against workspace "").
func TestBroker_EmptyTenantRejected(t *testing.T) {
	m := &countingMinter{secret: "sek"}
	b := newTestBroker(t, m)
	if _, err := b.KeyForTenantScoped(context.Background(), "acct-1", "", []string{"trust:read"}); err == nil {
		t.Fatal("want error for empty tenant id, got nil")
	}
}
