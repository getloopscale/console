// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M11 (theo-promptly Model B L2) — Broker resolves a per-tenant promptly_live_*
// secret for the data path. Lazy cache-aside: an in-process LRU keyed by
// (tenant, granted scopes), with a TTL ≪ the key's validity so an out-of-band
// revoke self-heals within one TTL (EC-2). Concurrent cache misses for the same
// key are coalesced by singleflight so a cold tenant under load mints exactly once.
//
// FAIL-CLOSED INVARIANT (the whole point of Model B): when a mint fails, the
// broker returns the error and NO secret — the ForwardAuth handler MUST reject
// the request (503), NEVER fall back to a master key. A fallback would re-open
// the confused deputy (CWE-441) this design closes.
//
// Mirrors internal/themory/broker.go. The one promptly-specific addition (plan
// ADR D1) is translateScopes: the consumer's cloud-facing `promptly:*` scopes
// are translated to the service `prompt:*` namespace BEFORE the least-privilege
// intersection, so a read-only consumer never receives a write-capable key.
//
// @see .claude/knowledge-base/plans/m11-integration-l2-plan.md § T2.3
package promptly

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

	// M18 — as duas superfícies que fazem a PESSOA atravessar.
	//
	// `MintKey` cunha uma chave do INQUILINO: ela identifica o workspace e mais nada. Foi o
	// bastante enquanto toda ação exigia no máximo `member` — e deixou de ser no M18, cujo gate
	// de promoção exige `admin`. Papel acima de `member` só existe com identidade, e identidade
	// só existe com membership declarada; por isso as duas chamadas andam juntas.
	DeclareMember(ctx context.Context, workspaceID, userID, role, email string) error
	MintKeyForUser(ctx context.Context, workspaceID, name string, scopes []string, userID string) (*MintResult, error)
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
// window (≪ key validity); scopes are the service-namespace (`prompt:*`) scopes
// the gateway is allowed to mint — least-privilege bounds the intersection.
func NewBroker(admin minter, size int, ttl time.Duration, scopes []string) (*Broker, error) {
	if admin == nil {
		return nil, fmt.Errorf("promptly broker: admin minter required")
	}
	if size < 1 {
		return nil, fmt.Errorf("promptly broker: size must be >= 1")
	}
	if ttl <= 0 {
		return nil, fmt.Errorf("promptly broker: ttl must be > 0")
	}
	cache, err := lru.New[string, cachedSecret](size)
	if err != nil {
		return nil, fmt.Errorf("promptly broker: lru.New: %w", err)
	}
	return &Broker{admin: admin, cache: cache, ttl: ttl, scopes: scopes, now: time.Now}, nil
}

// KeyForTenantScoped mints/loads a per-tenant key carrying ONLY the LEAST-
// PRIVILEGE intersection of translate(want) and the gateway's supported scopes.
// The edge (ForwardAuth) passes the CONSUMER's own `promptly:*` scopes here. The
// cache is keyed by (tenant, granted scopes) so two consumers in the same tenant
// with different scopes get distinct keys. Fails closed: a mint error, an empty
// tenant, or no grantable scope returns an empty secret.
// M1: accountID is part of the cache key (no cross-account cache sharing) but is
// NEVER sent to the minter — the minted key's workspace_id stays == tenantID
// (theo-promptly isolation unit is the tenant). Legacy NULL-account (accountID=="")
// is valid. The broker lazily trusts the account→tenant relationship ForwardAuth
// authorized.
func (b *Broker) KeyForTenantScoped(ctx context.Context, accountID, tenantID string, want []string) (string, error) {
	// Defense-in-depth (EC-4): an empty tenant must NEVER resolve to a key.
	if tenantID == "" {
		return "", fmt.Errorf("promptly broker: empty tenant id")
	}
	scopes := intersectScopes(translateScopes(want), b.scopes)
	if len(scopes) == 0 {
		return "", fmt.Errorf("promptly broker: no grantable scopes for tenant %q", tenantID)
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

// KeyForUser cunha (e cacheia) a credencial de UM HUMANO dentro do inquilino.
//
// Existe porque a aceitação do M18 mediu o custo de não existir: a chave por inquilino não
// identifica ninguém, papel acima de `member` exige identidade, e o gate de promoção que o
// milestone entregou não podia ser ligado por credencial alguma. O mesmo buraco fazia todo
// comentário nascer sem autor.
//
// A chave de cache inclui o USUÁRIO, e isso não é detalhe: sem ele dois humanos do mesmo
// inquilino compartilhariam credencial, e o papel de um valeria para o outro — um defeito de
// isolamento pior que o corrigido aqui.
//
// A declaração de membership vem ANTES do mint porque o serviço recusa vincular chave a quem não
// é membro (`USER_NOT_MEMBER`), e a recusa é a guarda que impede um chamador de afirmar o próprio
// rank. Declarar é ato da AUTORIDADE sobre o workspace; o broker fala como plano de controle.
//
// Fail-closed em ambos os passos: sem membership ou sem mint não há chave, e o cliente então não
// emite requisição alguma — em vez de emiti-la com a credencial errada.
func (b *Broker) KeyForUser(ctx context.Context, accountID, tenantID, userID, role, email string, want []string) (string, error) {
	if tenantID == "" {
		return "", fmt.Errorf("promptly broker: empty tenant id")
	}
	if userID == "" {
		return "", fmt.Errorf("promptly broker: empty user id")
	}
	// O e-mail é obrigatório do outro lado (`users.email` é NOT NULL UNIQUE) e é DADO REAL da
	// sessão. Sintetizar um aqui gravaria um fato falso numa tabela que outras coisas leem — e a
	// unicidade transformaria o palpite em colisão. Sem ele, falha fechado.
	if email == "" {
		return "", fmt.Errorf("promptly broker: empty user email")
	}
	scopes := intersectScopes(translateScopes(want), b.scopes)
	if len(scopes) == 0 {
		return "", fmt.Errorf("promptly broker: no grantable scopes for tenant %q", tenantID)
	}
	cacheKey := accountID + "\x00" + tenantID + "\x00" + userID + "\x00" + role + "\x00" + strings.Join(scopes, ",")
	if v, ok := b.cache.Get(cacheKey); ok && b.now().Before(v.expiresAt) {
		return v.secret, nil
	}
	res, err, _ := b.sf.Do(cacheKey, func() (any, error) {
		if dErr := b.admin.DeclareMember(ctx, tenantID, userID, role, email); dErr != nil {
			return nil, dErr
		}
		r, mErr := b.admin.MintKeyForUser(ctx, tenantID, "gw-"+tenantID+"-"+userID, scopes, userID)
		if mErr != nil {
			return nil, mErr
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

// Evict drops ALL of a tenant's cached secrets (one per scope-set) on an
// out-of-band revoke / offboarding so the next request re-mints. Idempotent.
// The cache is keyed by (tenant "\x00" scopes), so eviction matches on the
// tenant prefix — a plain Remove(tenantID) would never hit a scoped key.
func (b *Broker) Evict(tenantID string) {
	// M1: cache key is `account "\x00" tenant "\x00" scopes`, so the tenant is the
	// MIDDLE NUL-delimited segment — evict every entry for this tenant across all
	// accounts and scope-sets.
	mid := "\x00" + tenantID + "\x00"
	for _, k := range b.cache.Keys() {
		if strings.Contains(k, mid) {
			b.cache.Remove(k)
		}
	}
}
