// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M22 (theo-skills Model B) — Broker resolves a per-tenant theoskill_live_* secret
// for the data path. Lazy cache-aside: an in-process LRU keyed by
// (account, tenant, granted scopes), with a TTL far shorter than the key's
// validity so an out-of-band revoke self-heals within one TTL. Concurrent cold
// misses for the same key are coalesced by singleflight, so a cold tenant under
// load mints exactly once.
//
// FAIL-CLOSED INVARIANT (the whole point of Model B): when a mint fails, the
// broker returns the error and NO secret — the caller MUST reject the request
// (503) and NEVER fall back to a master key. A fallback would re-open the
// confused deputy (CWE-441) this design closes.
//
// Ported from internal/trust/broker.go with no behavioural change: the caching,
// least-privilege intersection and eviction semantics are identical, and keeping
// them identical is the point — three verticals diverging on how they cache a
// credential is three different security postures nobody can reason about at once.
package skills

import (
	"context"
	"fmt"
	"sort"
	"strings"
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
		return nil, fmt.Errorf("skills broker: admin minter required")
	}
	if size < 1 {
		return nil, fmt.Errorf("skills broker: size must be >= 1")
	}
	if ttl <= 0 {
		return nil, fmt.Errorf("skills broker: ttl must be > 0")
	}
	cache, err := lru.New[string, cachedSecret](size)
	if err != nil {
		return nil, fmt.Errorf("skills broker: lru.New: %w", err)
	}
	return &Broker{admin: admin, cache: cache, ttl: ttl, scopes: scopes, now: time.Now}, nil
}

// KeyForTenant returns the per-tenant data-plane secret, minting + caching it on
// a miss. Fails closed: a mint error propagates with an empty secret.
func (b *Broker) KeyForTenant(ctx context.Context, accountID, tenantID string) (string, error) {
	return b.KeyForTenantScoped(ctx, accountID, tenantID, b.scopes)
}

// KeyForTenantScoped mints/loads a per-tenant key carrying ONLY the LEAST-
// PRIVILEGE intersection of `want` and the gateway's supported scopes. The edge
// (ForwardAuth) passes the CONSUMER's own scopes here so a read-only consumer can
// never receive a write/delete-capable minted key (closes the intra-tenant
// scope-escalation /review finding). Cache is keyed by (tenant, granted scopes)
// so two consumers in the same tenant with different scopes get distinct keys.
// Fails closed: a mint error (or no grantable scope) returns an empty secret.
//
// M1: accountID is part of the cache key (an Account-aware key never shares a
// cached secret across accounts — defense-in-depth) but is NEVER sent to the
// minter — the minted key's workspace_id stays == tenantID, so the theo-memory
// isolation unit is the tenant, unchanged. accountID == "" (legacy NULL-account
// key) is valid and caches under the empty-account slot. The broker LAZILY trusts
// the account→tenant relationship already authorized by ForwardAuth.
func (b *Broker) KeyForTenantScoped(ctx context.Context, accountID, tenantID string, want []string) (string, error) {
	// Defense-in-depth: an empty tenant must NEVER resolve to a key (a future
	// caller bypassing the resolver guard would otherwise mint against workspace "").
	if tenantID == "" {
		return "", fmt.Errorf("skills broker: empty tenant id")
	}
	scopes := intersectScopes(want, b.scopes)
	if len(scopes) == 0 {
		return "", fmt.Errorf("skills broker: no grantable scopes for tenant %q", tenantID)
	}
	cacheKey := accountID + "\x00" + tenantID + "\x00" + strings.Join(scopes, ",")
	if v, ok := b.cache.Get(cacheKey); ok && b.now().Before(v.expiresAt) {
		return v.secret, nil
	}
	// Coalesce concurrent cold misses for the same (tenant, scopes) → exactly one mint.
	res, err, _ := b.sf.Do(cacheKey, func() (any, error) {
		r, mErr := b.admin.MintKey(ctx, tenantID, "gw-"+tenantID, scopes)
		if mErr != nil {
			return nil, mErr // fail-closed: no fallback, no cache write
		}
		b.cache.Add(cacheKey, cachedSecret{secret: r.Secret, expiresAt: b.now().Add(b.ttl)})
		return r.Secret, nil
	})
	if err != nil {
		return "", err
	}
	return res.(string), nil
}

// intersectScopes returns the sorted, deduped intersection of want ∩ allowed —
// the minted key never carries a scope the gateway does not support.
func intersectScopes(want, allowed []string) []string {
	allow := make(map[string]struct{}, len(allowed))
	for _, s := range allowed {
		allow[s] = struct{}{}
	}
	seen := make(map[string]struct{}, len(want))
	out := make([]string, 0, len(want))
	for _, s := range want {
		if _, ok := allow[s]; !ok {
			continue
		}
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// Evict drops a tenant's cached secret (out-of-band revoke / offboarding) so the
// next request re-mints. Idempotent. The cache key is
// `account "\x00" tenant "\x00" scopes`, so eviction matches the tenant as the
// MIDDLE NUL-delimited segment across all accounts + scope-sets (a plain
// Remove(tenantID) would never hit a scoped key).
func (b *Broker) Evict(tenantID string) {
	mid := "\x00" + tenantID + "\x00"
	for _, k := range b.cache.Keys() {
		if strings.Contains(k, mid) {
			b.cache.Remove(k)
		}
	}
}
