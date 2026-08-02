package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

type recordingSkillsMinter struct {
	calls     int
	gotScopes []string
	gotTenant string
	err       error
}

func (m *recordingSkillsMinter) KeyForTenantScoped(_ context.Context, _, tenantID string, want []string) (string, error) {
	m.calls++
	m.gotTenant = tenantID
	m.gotScopes = want
	if m.err != nil {
		return "", m.err
	}
	return "skills-key-for-" + tenantID, nil
}

// O caminho de LEITURA do dashboard cunha apenas `skills:read`.
//
// O ForwardAuth da borda carrega mais escopos porque intermedia um consumidor que pode
// legitimamente publicar; este caminho nao pode, e a chave que ele recebe nao deve poder. Se
// alguem alargar isto, o dashboard passa a poder PROMOVER CANAL — a operacao mais perigosa do
// produto — sem que nenhuma rota mutante exista. E um privilegio que nao aparece em code review
// de rota, porque nao ha rota para revisar.
func TestSkillsResolverMintsReadOnlyScope(t *testing.T) {
	m := &recordingSkillsMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	if _, err := newSkillsDashboardKeyResolver(m)(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if len(m.gotScopes) != 1 || m.gotScopes[0] != "skills:read" {
		t.Errorf("escopos cunhados = %v; esperado exatamente [skills:read]", m.gotScopes)
	}
	if m.gotTenant != "tn-alpha" {
		t.Errorf("tenant = %q; esperado o do contexto autenticado", m.gotTenant)
	}
}

// Sem tenant autenticado NAO ha cunhagem — e, a jusante, nao ha requisicao.
//
// O que se assere aqui alem do erro: o minter nao foi sequer chamado. Falhar DEPOIS de cunhar
// deixaria uma credencial de inquilino indefinido existir por um instante, e "por um instante"
// e tempo suficiente para ela ser usada pelo caminho errado.
func TestSkillsResolverFailsClosedWithoutAuthenticatedTenant(t *testing.T) {
	for _, tc := range []struct {
		name string
		ctx  context.Context
	}{
		{"sem usuario no contexto", context.Background()},
		{"usuario sem tenant", auth.WithUser(context.Background(), &auth.UserContext{AccountID: "acc-1"})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &recordingSkillsMinter{}

			_, err := newSkillsDashboardKeyResolver(m)(tc.ctx)

			if err == nil {
				t.Fatal("esperava erro; sem tenant autenticado nao pode haver chave")
			}
			if m.calls != 0 {
				t.Errorf("minter chamado %d vez(es); esperado zero — fail-closed e ANTES da cunhagem", m.calls)
			}
		})
	}
}

// O erro do minter SOBE embrulhado, com contexto. Devolver a chave vazia com erro nil faria o
// data client emitir a requisicao com `Bearer ` — e o registro responderia 401, mandando o
// operador investigar autenticacao quando o defeito e de cunhagem.
func TestSkillsResolverPropagatesMinterFailure(t *testing.T) {
	m := &recordingSkillsMinter{err: errors.New("broker indisponivel")}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	key, err := newSkillsDashboardKeyResolver(m)(ctx)

	if err == nil {
		t.Fatal("esperava erro do minter propagado")
	}
	if key != "" {
		t.Errorf("chave = %q; esperado vazia quando a cunhagem falha", key)
	}
	if !strings.Contains(err.Error(), "broker indisponivel") {
		t.Errorf("erro = %q; esperado carregar a causa original", err.Error())
	}
}
