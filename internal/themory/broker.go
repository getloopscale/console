// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Model B slice 2 (ADR D3) — Broker resolves a per-tenant theo_live_* secret for
// the data path. Lazy cache-aside: an in-process LRU keyed by tenant id (==
// TheMemory workspace id), with a TTL ≪ the key's validity so an out-of-band
// revoke self-heals within one TTL. Concurrent cache misses for the same tenant
// are coalesced by singleflight so a cold tenant under load mints exactly once.
//
// FAIL-CLOSED INVARIANT (the whole point of Model B): when a mint fails, the
// broker returns the error and NO secret — the caller MUST reject the request
// (503), NEVER fall back to a master key. A fallback would re-open the
// confused deputy (CWE-441) this design closes.
//
// @see .claude/knowledge-base/plans/model-b-credential-broker-plan.md § T2.1
package themory

import (
	"context"
	"fmt"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"golang.org/x/sync/singleflight"
)

// minter is the control-plane mint surface the broker depends on (DIP — the
// concrete impl is *AdminClient; tests inject a stub).
type minter interface {
	MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error)
}

type cachedSecret struct {
	secret    string
	expiresAt time.Time
}

// Broker caches + lazily provisions per-tenant data-plane credentials.
// Concurrent-safe.
type Broker struct {
	admin  minter
	cache  *lru.Cache[string, cachedSecret]
	sf     singleflight.Group
	ttl    time.Duration
	scopes []string
	// now is the clock (injectable for deterministic TTL tests). Defaults to time.Now.
	now func() time.Time
}

// NewBroker constructs a broker. size bounds the LRU; ttl is the cache freshness
// window (≪ key validity); scopes are the data scopes minted per-tenant key.
func NewBroker(admin minter, size int, ttl time.Duration, scopes []string) (*Broker, error) {
	if admin == nil {
		return nil, fmt.Errorf("themory broker: admin minter required")
	}
	if size < 1 {
		return nil, fmt.Errorf("themory broker: size must be >= 1")
	}
	if ttl <= 0 {
		return nil, fmt.Errorf("themory broker: ttl must be > 0")
	}
	cache, err := lru.New[string, cachedSecret](size)
	if err != nil {
		return nil, fmt.Errorf("themory broker: lru.New: %w", err)
	}
	return &Broker{admin: admin, cache: cache, ttl: ttl, scopes: scopes, now: time.Now}, nil
}

// KeyForTenant returns the per-tenant data-plane secret, minting + caching it on
// a miss. Fails closed: a mint error propagates with an empty secret.
func (b *Broker) KeyForTenant(ctx context.Context, tenantID string) (string, error) {
	if v, ok := b.cache.Get(tenantID); ok && b.now().Before(v.expiresAt) {
		return v.secret, nil
	}
	// Coalesce concurrent cold misses for the same tenant → exactly one mint.
	res, err, _ := b.sf.Do(tenantID, func() (any, error) {
		r, mErr := b.admin.MintKey(ctx, tenantID, "gw-"+tenantID, b.scopes)
		if mErr != nil {
			return nil, mErr // fail-closed: no fallback, no cache write
		}
		b.cache.Add(tenantID, cachedSecret{secret: r.Secret, expiresAt: b.now().Add(b.ttl)})
		return r.Secret, nil
	})
	if err != nil {
		return "", err
	}
	return res.(string), nil
}

// Evict drops a tenant's cached secret (out-of-band revoke / offboarding) so the
// next request re-mints. Idempotent.
func (b *Broker) Evict(tenantID string) {
	b.cache.Remove(tenantID)
}
