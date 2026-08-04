// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package promptly

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stubMinter counts MintKey calls and records the last request, for broker tests.
type stubMinter struct {
	calls      atomic.Int64
	mu         sync.Mutex
	lastWS     string
	lastScopes []string
	err        error
	delay      time.Duration
	secretSeq  atomic.Int64
}

// M18 — o stub acompanha a porta. Estes dois nunca são chamados pelos testes do caminho por
// INQUILINO (que é o que este stub exercita); existem porque um dublê que não implementa o
// contrato inteiro deixa de provar que o contrato inteiro é satisfeito.
func (s *stubMinter) DeclareMember(context.Context, string, string, string) error { return nil }

func (s *stubMinter) MintKeyForUser(ctx context.Context, workspaceID, name string, scopes []string, _ string) (*MintResult, error) {
	return s.MintKey(ctx, workspaceID, name, scopes)
}

func (s *stubMinter) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
	s.calls.Add(1)
	if s.delay > 0 {
		time.Sleep(s.delay)
	}
	if s.err != nil {
		return nil, s.err
	}
	s.mu.Lock()
	s.lastWS = workspaceID
	s.lastScopes = append([]string(nil), scopes...)
	s.mu.Unlock()
	n := s.secretSeq.Add(1)
	return &MintResult{ID: fmt.Sprintf("k%d", n), Secret: fmt.Sprintf("promptly_live_%s_%d", workspaceID, n)}, nil
}

func newTestBroker(t *testing.T, m minter) *Broker {
	t.Helper()
	b, err := NewBroker(m, 128, time.Hour, []string{"prompt:read", "prompt:write"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	return b
}

func TestBroker_MintsPerTenantScoped(t *testing.T) {
	m := &stubMinter{}
	b := newTestBroker(t, m)
	secret, err := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	if err != nil {
		t.Fatalf("KeyForTenantScoped: %v", err)
	}
	if secret == "" {
		t.Fatal("empty secret")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastWS != "ws-a" {
		t.Errorf("workspace: got %q want ws-a", m.lastWS)
	}
	if len(m.lastScopes) != 1 || m.lastScopes[0] != "prompt:read" {
		t.Errorf("scopes: got %v want [prompt:read] (translated + intersected)", m.lastScopes)
	}
}

func TestBroker_FailClosedOnMintError(t *testing.T) {
	m := &stubMinter{err: errors.New("upstream down")}
	b := newTestBroker(t, m)
	secret, err := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	if err == nil {
		t.Fatal("expected error")
	}
	if secret != "" {
		t.Errorf("expected empty secret on fail-closed, got %q", secret)
	}
	// Not cached: a second call re-attempts (counter increments).
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	if m.calls.Load() != 2 {
		t.Errorf("expected 2 mint attempts (no cache on error), got %d", m.calls.Load())
	}
}

func TestBroker_TenantIsolation(t *testing.T) {
	m := &stubMinter{}
	b := newTestBroker(t, m)
	sa, _ := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	sb, _ := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-b", []string{"promptly:read"})
	if sa == sb {
		t.Errorf("tenant-a and tenant-b got the same secret %q", sa)
	}
	if m.calls.Load() != 2 {
		t.Errorf("expected 2 mints (distinct tenants), got %d", m.calls.Load())
	}
}

func TestBroker_NoGrantableScopes(t *testing.T) {
	m := &stubMinter{}
	b := newTestBroker(t, m)
	_, err := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"memory:read"})
	if err == nil {
		t.Fatal("expected error when no promptly: scope is grantable")
	}
	if m.calls.Load() != 0 {
		t.Errorf("must not mint when no grantable scope, got %d calls", m.calls.Load())
	}
}

func TestBroker_EmptyTenantRejected(t *testing.T) {
	m := &stubMinter{}
	b := newTestBroker(t, m)
	_, err := b.KeyForTenantScoped(context.Background(), "acct-1", "", []string{"promptly:read"})
	if err == nil {
		t.Fatal("expected error for empty tenant id (EC-4)")
	}
	if m.calls.Load() != 0 {
		t.Errorf("must not mint for empty tenant, got %d calls", m.calls.Load())
	}
}

func TestBroker_CacheHitDoesNotRemint(t *testing.T) {
	m := &stubMinter{}
	b := newTestBroker(t, m)
	s1, _ := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	s2, _ := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	if s1 != s2 {
		t.Errorf("cache miss: %q != %q", s1, s2)
	}
	if m.calls.Load() != 1 {
		t.Errorf("expected 1 mint (cached), got %d", m.calls.Load())
	}
}

func TestBroker_CacheRespectsTTL(t *testing.T) {
	// EC-2: the TTL is the revocation-propagation window — after it expires the
	// broker re-mints. Inject a controllable clock.
	m := &stubMinter{}
	b, err := NewBroker(m, 128, time.Hour, []string{"prompt:read"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	now := time.Unix(1000, 0)
	b.now = func() time.Time { return now }
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	now = now.Add(2 * time.Hour) // past the 1h TTL
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	if m.calls.Load() != 2 {
		t.Errorf("expected re-mint after TTL, got %d mints", m.calls.Load())
	}
}

func TestBroker_SingleflightCoalesces(t *testing.T) {
	// RACE / atomic-counter invariant: N concurrent cold misses for the same
	// (tenant, scopes) coalesce to exactly ONE mint (singleflight). Run -race.
	m := &stubMinter{delay: 20 * time.Millisecond}
	b := newTestBroker(t, m)
	const N = 20
	var wg sync.WaitGroup
	start := make(chan struct{})
	secrets := make([]string, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start // barrier: all goroutines fire simultaneously
			s, _ := b.KeyForTenantScoped(context.Background(), "acct-1", "ws-hot", []string{"promptly:read"})
			secrets[idx] = s
		}(i)
	}
	close(start)
	wg.Wait()

	if got := m.calls.Load(); got != 1 {
		t.Fatalf("singleflight invariant: expected exactly 1 mint for %d concurrent callers, got %d", N, got)
	}
	for i := 1; i < N; i++ {
		if secrets[i] != secrets[0] {
			t.Fatalf("coalesced callers got different secrets: %q != %q", secrets[i], secrets[0])
		}
	}
}

func TestNewBroker_RejectsInvalidArgs(t *testing.T) {
	if _, err := NewBroker(nil, 16, time.Hour, nil); err == nil {
		t.Error("nil minter must error")
	}
	if _, err := NewBroker(&stubMinter{}, 0, time.Hour, nil); err == nil {
		t.Error("size < 1 must error")
	}
	if _, err := NewBroker(&stubMinter{}, 16, 0, nil); err == nil {
		t.Error("ttl <= 0 must error")
	}
}

func TestBroker_EvictForcesRemint(t *testing.T) {
	m := &stubMinter{}
	b := newTestBroker(t, m)
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	b.Evict("ws-a") // evict by tenant — must match the scoped cache key
	_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", "ws-a", []string{"promptly:read"})
	if m.calls.Load() != 2 {
		t.Errorf("expected re-mint after Evict(tenant), got %d mints", m.calls.Load())
	}
}

func TestBroker_ConcurrentDistinctTenants(t *testing.T) {
	m := &stubMinter{delay: 5 * time.Millisecond}
	b := newTestBroker(t, m)
	const tenants = 10
	var wg sync.WaitGroup
	for i := 0; i < tenants; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, _ = b.KeyForTenantScoped(context.Background(), "acct-1", fmt.Sprintf("ws-%d", idx), []string{"promptly:read"})
		}(i)
	}
	wg.Wait()
	if got := m.calls.Load(); got != tenants {
		t.Errorf("expected %d mints (distinct tenants), got %d", tenants, got)
	}
}

// stubIdentidade registra o que o broker pediu — a prova de que a PESSOA atravessou.
type stubIdentidade struct {
	membros []string // "workspace|user|role"
	mints   []string // "workspace|user"
	n       int
}

func (s *stubIdentidade) MintKey(_ context.Context, ws, name string, scopes []string) (*MintResult, error) {
	_ = name
	_ = scopes
	s.n++
	s.mints = append(s.mints, ws+"|")
	return &MintResult{Secret: fmt.Sprintf("promptly_live_%d", s.n)}, nil
}

func (s *stubIdentidade) MintKeyForUser(_ context.Context, ws, name string, scopes []string, userID string) (*MintResult, error) {
	_ = name
	_ = scopes
	s.n++
	s.mints = append(s.mints, ws+"|"+userID)
	return &MintResult{Secret: fmt.Sprintf("promptly_live_%d", s.n)}, nil
}

func (s *stubIdentidade) DeclareMember(_ context.Context, ws, userID, role string) error {
	s.membros = append(s.membros, ws+"|"+userID+"|"+role)
	return nil
}

// A aceitação do M18 mediu a consequência de a chave identificar o INQUILINO e não a PESSOA:
// papel acima de `member` exige identidade, então o gate de promoção não podia ser ligado, e todo
// comentário nascia sem autor. O broker é o ponto onde a pessoa se perde — e onde ela volta.
func TestChaveDePromocaoCarregaAPessoaEOPapel(t *testing.T) {
	s := &stubIdentidade{}
	b, err := NewBroker(s, 8, time.Minute, []string{"prompt:read", "prompt:write"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := b.KeyForUser(context.Background(), "acc-1", "tn-1", "u-ana", "admin",
		[]string{"promptly:read", "promptly:write"}); err != nil {
		t.Fatalf("KeyForUser: %v", err)
	}

	if len(s.membros) != 1 || s.membros[0] != "tn-1|u-ana|admin" {
		t.Fatalf("membros = %v, quero [tn-1|u-ana|admin] — sem declarar a membership o mint vinculado é recusado", s.membros)
	}
	if len(s.mints) != 1 || s.mints[0] != "tn-1|u-ana" {
		t.Fatalf("mints = %v, quero [tn-1|u-ana] — a chave precisa nascer VINCULADA à pessoa", s.mints)
	}
}

// Dois humanos do mesmo inquilino NÃO podem compartilhar credencial: se compartilhassem, o papel
// de um valeria para o outro — um defeito de isolamento pior que o que este slice corrige.
func TestDoisUsuariosDoMesmoTenantNaoCompartilhamChave(t *testing.T) {
	s := &stubIdentidade{}
	b, err := NewBroker(s, 8, time.Minute, []string{"prompt:read", "prompt:write"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	k1, err := b.KeyForUser(ctx, "acc-1", "tn-1", "u-ana", "admin", []string{"promptly:write"})
	if err != nil {
		t.Fatal(err)
	}
	k2, err := b.KeyForUser(ctx, "acc-1", "tn-1", "u-bia", "member", []string{"promptly:write"})
	if err != nil {
		t.Fatal(err)
	}
	if k1 == k2 {
		t.Fatal("dois usuários do mesmo tenant receberam a MESMA chave — o papel de um valeria para o outro")
	}

	// E o cache continua sendo cache: o mesmo usuário não remint a cada chamada.
	if _, err := b.KeyForUser(ctx, "acc-1", "tn-1", "u-ana", "admin", []string{"promptly:write"}); err != nil {
		t.Fatal(err)
	}
	if s.n != 2 {
		t.Fatalf("mints = %d, quero 2 — a terceira chamada repete u-ana e deve sair do cache", s.n)
	}
}
