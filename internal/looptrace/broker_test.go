// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package looptrace

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stubMinter records how it was called and what it returns.
type stubMinter struct {
	mu        sync.Mutex
	calls     int32
	lastScope []string
	block     chan struct{} // if non-nil, MintKey waits on it (singleflight test)
	err       error
	secret    string
}

func (s *stubMinter) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
	atomic.AddInt32(&s.calls, 1)
	s.mu.Lock()
	s.lastScope = append([]string(nil), scopes...)
	s.mu.Unlock()
	if s.block != nil {
		<-s.block
	}
	if s.err != nil {
		return nil, s.err
	}
	sec := s.secret
	if sec == "" {
		sec = "theo_live_" + workspaceID
	}
	return &MintResult{ID: "apk_" + workspaceID, Secret: sec, Scopes: scopes}, nil
}

func newBrokerT(t *testing.T, m minter, scopes []string) *Broker {
	t.Helper()
	b, err := NewBroker(m, 128, time.Hour, scopes)
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	return b
}

func TestKeyForTenantScoped_LeastPrivilege(t *testing.T) {
	m := &stubMinter{}
	b := newBrokerT(t, m, []string{"observability:read", "observability:write", "observability:delete"})
	secret, err := b.KeyForTenantScoped(context.Background(), "acct1", "t1", []string{"observability:read"})
	if err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if secret == "" {
		t.Fatal("empty secret")
	}
	m.mu.Lock()
	got := m.lastScope
	m.mu.Unlock()
	if len(got) != 1 || got[0] != "observability:read" {
		t.Errorf("minted scopes = %v, want [observability:read] (least privilege, not the full allowed set)", got)
	}
}

func TestKeyForTenantScoped_Singleflight(t *testing.T) {
	m := &stubMinter{block: make(chan struct{})}
	b := newBrokerT(t, m, []string{"observability:read"})
	const n = 20
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, _ = b.KeyForTenantScoped(context.Background(), "a", "t1", []string{"observability:read"})
		}()
	}
	// Give the goroutines time to coalesce on the singleflight key, then release.
	time.Sleep(20 * time.Millisecond)
	close(m.block)
	wg.Wait()
	if c := atomic.LoadInt32(&m.calls); c != 1 {
		t.Errorf("MintKey called %d times under %d concurrent cold misses, want exactly 1 (singleflight)", c, n)
	}
}

func TestKeyForTenantScoped_FailClosed_MintError(t *testing.T) {
	m := &stubMinter{err: fmt.Errorf("upstream 503")}
	b := newBrokerT(t, m, []string{"observability:read"})
	secret, err := b.KeyForTenantScoped(context.Background(), "a", "t1", []string{"observability:read"})
	if err == nil {
		t.Fatal("expected fail-closed error, got nil")
	}
	if secret != "" {
		t.Errorf("secret = %q, want empty on mint error", secret)
	}
	// No cache write: a subsequent call re-mints (calls == 2).
	m.err = nil
	if _, err := b.KeyForTenantScoped(context.Background(), "a", "t1", []string{"observability:read"}); err != nil {
		t.Fatalf("second call: %v", err)
	}
	if c := atomic.LoadInt32(&m.calls); c != 2 {
		t.Errorf("calls = %d, want 2 (first failed → no cache write → re-mint)", c)
	}
}

func TestKeyForTenantScoped_FailClosed_EmptyIntersect(t *testing.T) {
	m := &stubMinter{}
	b := newBrokerT(t, m, []string{"observability:read"})
	// want shares NO scope with allowed → empty intersect → fail closed, no mint.
	secret, err := b.KeyForTenantScoped(context.Background(), "a", "t1", []string{"observability:write"})
	if err == nil {
		t.Fatal("expected error on empty intersect, got nil")
	}
	if secret != "" {
		t.Errorf("secret = %q, want empty", secret)
	}
	if c := atomic.LoadInt32(&m.calls); c != 0 {
		t.Errorf("minter called %d times on empty intersect, want 0 (never mint an unscoped key)", c)
	}
}

func TestKeyForTenantScoped_EmptyTenant_Error(t *testing.T) {
	m := &stubMinter{}
	b := newBrokerT(t, m, []string{"observability:read"})
	if _, err := b.KeyForTenantScoped(context.Background(), "a", "", []string{"observability:read"}); err == nil {
		t.Fatal("expected error on empty tenant id, got nil")
	}
	if c := atomic.LoadInt32(&m.calls); c != 0 {
		t.Errorf("minter called on empty tenant, want 0")
	}
}

func TestKeyForTenant_TTLExpiry(t *testing.T) {
	m := &stubMinter{}
	b := newBrokerT(t, m, []string{"observability:read"})
	base := time.Unix(1_700_000_000, 0)
	cur := base
	b.now = func() time.Time { return cur }

	if _, err := b.KeyForTenant(context.Background(), "a", "t1"); err != nil {
		t.Fatalf("first: %v", err)
	}
	cur = base.Add(30 * time.Minute) // within ttl (1h) → cache hit, no re-mint
	if _, err := b.KeyForTenant(context.Background(), "a", "t1"); err != nil {
		t.Fatalf("second: %v", err)
	}
	if c := atomic.LoadInt32(&m.calls); c != 1 {
		t.Fatalf("calls = %d within ttl, want 1 (cache hit)", c)
	}
	cur = base.Add(2 * time.Hour) // past ttl → re-mint
	if _, err := b.KeyForTenant(context.Background(), "a", "t1"); err != nil {
		t.Fatalf("third: %v", err)
	}
	if c := atomic.LoadInt32(&m.calls); c != 2 {
		t.Errorf("calls = %d past ttl, want 2 (re-mint)", c)
	}
}

// Evict drops a tenant's cached secret so the next request re-mints (out-of-band
// revoke / offboarding self-heal). Matches on the tenant as the middle NUL-delimited
// cache-key segment across all accounts + scope-sets.
func TestEvict_ForcesRemint(t *testing.T) {
	m := &stubMinter{}
	b := newBrokerT(t, m, []string{"observability:read"})
	if _, err := b.KeyForTenant(context.Background(), "a", "t1"); err != nil {
		t.Fatalf("first mint: %v", err)
	}
	if _, err := b.KeyForTenant(context.Background(), "a", "t1"); err != nil {
		t.Fatalf("cached call: %v", err)
	}
	if c := atomic.LoadInt32(&m.calls); c != 1 {
		t.Fatalf("calls = %d before evict, want 1 (second was a cache hit)", c)
	}
	b.Evict("t1")
	if _, err := b.KeyForTenant(context.Background(), "a", "t1"); err != nil {
		t.Fatalf("post-evict: %v", err)
	}
	if c := atomic.LoadInt32(&m.calls); c != 2 {
		t.Errorf("calls = %d after evict, want 2 (eviction forced a re-mint)", c)
	}
	// Idempotent: evicting an unknown tenant is a no-op, not a panic.
	b.Evict("nonexistent")
}

// The broker returns a MINTED theo_live_* secret, never the platform key.
// Structural: the Broker has no platform-key field; only AdminClient does.
func TestBroker_ReturnsMintedSecret_NotPlatformKey(t *testing.T) {
	const platform = "theo_live_PLATFORM_ADMIN"
	m := &stubMinter{secret: "theo_live_tenant_scoped"}
	b := newBrokerT(t, m, []string{"observability:read"})
	secret, err := b.KeyForTenant(context.Background(), "a", "t1")
	if err != nil {
		t.Fatalf("KeyForTenant: %v", err)
	}
	if secret == platform {
		t.Fatal("broker returned the platform key — control/data-plane split breached (NIST AC-5/6)")
	}
	if secret != "theo_live_tenant_scoped" {
		t.Errorf("secret = %q, want the minted per-tenant secret", secret)
	}
}
