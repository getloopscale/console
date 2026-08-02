package main

import (
	"context"
	"errors"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

type recordingPromptlyMinter struct {
	calls     int
	gotScopes []string
	gotTenant string
	err       error
}

func (m *recordingPromptlyMinter) KeyForTenantScoped(_ context.Context, _, tenantID string, want []string) (string, error) {
	m.calls++
	m.gotTenant = tenantID
	m.gotScopes = want
	if m.err != nil {
		return "", m.err
	}
	return "promptly-key-for-" + tenantID, nil
}

// O caminho de LEITURA cunha SOMENTE `prompt:read`. Com essa chave, uma rota mutante registrada por
// engano sobre o cliente de leitura toma recusa do proprio servico — privilegio que nao depende de
// alguem lembrar de conferir a rota em code review.
func TestPromptlyReadResolverMintsReadOnlyScope(t *testing.T) {
	m := &recordingPromptlyMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	if _, err := newPromptlyDashboardKeyResolver(m)(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if len(m.gotScopes) != 1 || m.gotScopes[0] != "prompt:read" {
		t.Errorf("escopos cunhados = %v; esperado exatamente [prompt:read]", m.gotScopes)
	}
	if m.gotTenant != "tn-alpha" {
		t.Errorf("tenant = %q; tem de vir do contexto autenticado, nunca de parametro", m.gotTenant)
	}
}

// O caminho de PROMOCAO e o unico que recebe `prompt:write`. O par com o teste acima e o que prova
// a separacao: mesma fiacao, duas chaves com poderes diferentes.
func TestPromptlyPromotionResolverMintsWriteScope(t *testing.T) {
	m := &recordingPromptlyMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	if _, err := newPromptlyPromotionKeyResolver(m)(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	temEscrita := false
	for _, s := range m.gotScopes {
		if s == "prompt:write" {
			temEscrita = true
		}
	}
	if !temEscrita {
		t.Errorf("escopos = %v; a promocao precisa de prompt:write", m.gotScopes)
	}
}

// Sem inquilino autenticado NAO ha cunhagem — e, a jusante, nao ha requisicao. Fail-closed nos
// DOIS caminhos: o de escrita e o mais grave, porque escreveria no inquilino errado.
func TestPromptlyResolversFailClosedWithoutAuthenticatedTenant(t *testing.T) {
	resolvers := map[string]func(promptlyDashMinter) func(context.Context) (string, error){
		"leitura":  newPromptlyDashboardKeyResolver,
		"promocao": newPromptlyPromotionKeyResolver,
	}
	contextos := map[string]context.Context{
		"sem usuario no contexto": context.Background(),
		"usuario sem tenant":      auth.WithUser(context.Background(), &auth.UserContext{AccountID: "acc-1"}),
	}
	for nome, novo := range resolvers {
		for caso, ctx := range contextos {
			t.Run(nome+"/"+caso, func(t *testing.T) {
				m := &recordingPromptlyMinter{}
				if _, err := novo(m)(ctx); err == nil {
					t.Fatal("resolver deveria falhar fechado")
				}
				if m.calls != 0 {
					t.Errorf("cunhou %d chave(s) sem inquilino autenticado", m.calls)
				}
			})
		}
	}
}

// A falha do broker PROPAGA. Engoli-la aqui devolveria string vazia como se fosse Bearer, e o
// upstream responderia 401 — mandando o operador investigar autenticacao num defeito de cunhagem.
func TestPromptlyResolverPropagatesMintFailure(t *testing.T) {
	falha := errors.New("mint failed")
	m := &recordingPromptlyMinter{err: falha}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	chave, err := newPromptlyDashboardKeyResolver(m)(ctx)

	if err == nil {
		t.Fatal("falha de cunhagem deveria propagar")
	}
	if chave != "" {
		t.Errorf("devolveu credencial %q apesar da falha", chave)
	}
}
