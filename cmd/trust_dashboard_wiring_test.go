package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

type recordingTrustMinter struct {
	calls     int
	gotScopes []string
	gotTenant string
	err       error
}

func (m *recordingTrustMinter) KeyForTenantScoped(_ context.Context, _, tenantID string, want []string) (string, error) {
	m.calls++
	m.gotTenant = tenantID
	m.gotScopes = want
	if m.err != nil {
		return "", m.err
	}
	return "trust-key-for-" + tenantID, nil
}

// O caminho de LEITURA do dashboard cunha apenas `trust:read`. O ForwardAuth da borda carrega os
// tres escopos porque intermedia um consumidor que pode escrever; este nao pode, e a chave que ele
// recebe nao deve poder. Se alguem alargar isto, o dashboard passa a poder apagar validators de
// tenant sem que nenhuma rota mutante exista — privilegio que nao aparece em code review de rota.
func TestResolverMintsReadOnlyScope(t *testing.T) {
	m := &recordingTrustMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	if _, err := newTrustDashboardKeyResolver(m)(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if len(m.gotScopes) != 1 || m.gotScopes[0] != "trust:read" {
		t.Errorf("escopos cunhados = %v; esperado exatamente [trust:read]", m.gotScopes)
	}
	if m.gotTenant != "tn-alpha" {
		t.Errorf("tenant = %q; esperado o do contexto autenticado", m.gotTenant)
	}
}

// Sem tenant autenticado NAO ha cunhagem — e, a jusante, nao ha requisicao. Fail-closed.
func TestResolverFailsClosedWithoutAuthenticatedTenant(t *testing.T) {
	for _, tc := range []struct {
		name string
		ctx  context.Context
	}{
		{"sem usuario no contexto", context.Background()},
		{"usuario sem tenant", auth.WithUser(context.Background(), &auth.UserContext{AccountID: "acc-1"})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &recordingTrustMinter{}
			_, err := newTrustDashboardKeyResolver(m)(tc.ctx)
			if err == nil {
				t.Fatal("esperado erro sem tenant autenticado")
			}
			if m.calls != 0 {
				t.Errorf("o broker foi chamado %d vez(es) sem tenant; esperado 0", m.calls)
			}
		})
	}
}

// Falha do broker sobe como erro — nunca vira uma chave vazia que o cliente usaria mesmo assim.
func TestResolverPropagatesMintFailure(t *testing.T) {
	m := &recordingTrustMinter{err: errors.New("broker indisponivel")}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha"})

	key, err := newTrustDashboardKeyResolver(m)(ctx)
	if err == nil {
		t.Fatal("esperado erro quando a cunhagem falha")
	}
	if key != "" {
		t.Errorf("key = %q; uma cunhagem falha nao pode devolver credencial", key)
	}
	if !strings.Contains(err.Error(), "broker indisponivel") {
		t.Errorf("erro = %q; deveria preservar a causa do broker", err)
	}
}
