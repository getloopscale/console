package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/promptly"
)

type recordingPromptlyMinter struct {
	calls     int
	gotScopes []string
	gotTenant string
	gotUser   string // M18 — a PESSOA que o resolver de promoção passou
	gotRole   string
	gotEmail  string
	err       error
}

// M18 — o caminho de PROMOÇÃO cunha por pessoa. Registrar `gotUser`/`gotRole` é o que permite
// afirmar que a identidade atravessou, em vez de afirmar que a chamada aconteceu.
func (m *recordingPromptlyMinter) KeyForUser(_ context.Context, _, tenantID, userID, role, email string, want []string) (string, error) {
	m.gotEmail = email
	m.calls++
	m.gotTenant = tenantID
	m.gotScopes = want
	m.gotUser = userID
	m.gotRole = role
	if m.err != nil {
		return "", m.err
	}
	return "promptly-key-for-" + tenantID + "-" + userID, nil
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
	// NAMESPACE DO CLOUD: é o que o broker entende. Este teste asseria `prompt:read` e
	// por isso TRAVAVA o defeito do #366 — o dublê aceita qualquer coisa, então o teste
	// passava exatamente com o valor que a produção recusa.
	if len(m.gotScopes) != 1 || m.gotScopes[0] != "promptly:read" {
		t.Errorf("escopos pedidos = %v; esperado exatamente [promptly:read]", m.gotScopes)
	}
	if m.gotTenant != "tn-alpha" {
		t.Errorf("tenant = %q; tem de vir do contexto autenticado, nunca de parametro", m.gotTenant)
	}
}

// M18 — a chave de PROMOCAO carrega a pessoa e o papel dela.
//
// Sem isto o servico nao encontra membership, todo papel cai no teto `member`, e uma acao que
// exige `admin` fica inalcancavel: foi assim que o gate do M18 nasceu inarmavel. O par com o teste
// de fail-closed abaixo e o que torna a afirmacao completa — a identidade atravessa, e a ausencia
// dela nao vira chave anonima.
func TestResolverDePromocaoCarregaAPessoaEOPapel(t *testing.T) {
	m := &recordingPromptlyMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{
		TenantID: "tn-alpha", AccountID: "acc-1", Subject: "u-ana", Role: "admin",
		Email: "ana@exemplo.test",
	})

	if _, err := newPromptlyPromotionKeyResolver(m, &resolvedorDePapel{papel: "admin"})(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if m.gotUser != "u-ana" {
		t.Errorf("usuario = %q; a chave precisa identificar a PESSOA, nao so o inquilino", m.gotUser)
	}
	if m.gotRole != "admin" {
		t.Errorf("papel = %q; sem ele o servico nao sabe que rank declarar", m.gotRole)
	}
	if m.gotEmail != "ana@exemplo.test" {
		// O e-mail e obrigatorio do outro lado (`users.email` NOT NULL UNIQUE) e e DADO REAL.
		// Sintetiza-lo gravaria um fato falso numa tabela que outras coisas leem — e foi
		// justamente a ausencia dele que devolveu 500 na primeira aceitacao.
		t.Errorf("email = %q; o servico exige dado real para materializar a pessoa", m.gotEmail)
	}
}

// Sessao autenticada sem sujeito NAO vira chave anonima com escopo de escrita. Cair para a chave
// por inquilino "so para nao quebrar" devolveria, em silencio, o buraco que este slice fecha.
func TestResolverDePromocaoFalhaFechadoSemSujeito(t *testing.T) {
	m := &recordingPromptlyMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	if _, err := newPromptlyPromotionKeyResolver(m, &resolvedorDePapel{papel: "admin"})(ctx); err == nil {
		t.Fatal("sessao sem sujeito produziu chave; tem de falhar fechado")
	}
	if m.calls != 0 {
		t.Errorf("chamadas ao minter = %d; nenhuma requisicao deve sair sem identidade", m.calls)
	}
}

// O caminho de PROMOCAO e o unico que recebe `prompt:write`. O par com o teste acima e o que prova
// a separacao: mesma fiacao, duas chaves com poderes diferentes.
func TestPromptlyPromotionResolverMintsWriteScope(t *testing.T) {
	m := &recordingPromptlyMinter{}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1", Subject: "u-ana", Role: "admin", Email: "ana@exemplo.test"})

	if _, err := newPromptlyPromotionKeyResolver(m, &resolvedorDePapel{papel: "admin"})(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	temEscrita := false
	for _, s := range m.gotScopes {
		if s == "promptly:write" {
			temEscrita = true
		}
	}
	if !temEscrita {
		t.Errorf("escopos = %v; a promocao precisa de promptly:write", m.gotScopes)
	}
}

// Sem inquilino autenticado NAO ha cunhagem — e, a jusante, nao ha requisicao. Fail-closed nos
// DOIS caminhos: o de escrita e o mais grave, porque escreveria no inquilino errado.
func TestPromptlyResolversFailClosedWithoutAuthenticatedTenant(t *testing.T) {
	resolvers := map[string]func(promptlyDashMinter) func(context.Context) (string, error){
		"leitura": newPromptlyDashboardKeyResolver,
		"promocao": func(m promptlyDashMinter) func(context.Context) (string, error) {
			return newPromptlyPromotionKeyResolver(m, &resolvedorDePapel{papel: "admin"})
		},
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

// ---------------------------------------------------------------------------
// O teste que faltava: o resolver contra o BROKER REAL, não contra um dublê.
//
// Os testes acima usam `recordingPromptlyMinter`, que aceita qualquer `want` e
// devolve chave. O broker de produção NÃO: ele TRADUZ o namespace (`promptly:X` →
// `prompt:X`) e DESCARTA o que não vier no namespace do cloud — inclusive um
// `prompt:*` já traduzido. Pedir no namespace errado produz interseção VAZIA, o
// mint falha, o data client falha fechado e a tela recebe 502 opaco.
//
// Foi exatamente o que aconteceu em produção (`#366`): a leitura do dashboard deu
// 502 por três horas enquanto o serviço estava de pé — e a suíte passava, porque o
// dublê era mais permissivo que a produção.
// ---------------------------------------------------------------------------

type mintSpy struct{ escoposCunhados []string }

// M18 — o espião acompanha a porta; estes dois não são exercitados por este teste, que é sobre a
// TRADUÇÃO de escopo.
func (m *mintSpy) DeclareMember(context.Context, string, string, string, string) error { return nil }

func (m *mintSpy) MintKeyForUser(ctx context.Context, ws, name string, scopes []string, _ string) (*promptly.MintResult, error) {
	return m.MintKey(ctx, ws, name, scopes)
}

func (m *mintSpy) MintKey(_ context.Context, _, _ string, scopes []string) (*promptly.MintResult, error) {
	m.escoposCunhados = scopes
	return &promptly.MintResult{Secret: "promptly_live_fake"}, nil
}

func TestPromptlyResolversFalamONamespaceQueOBrokerEntende(t *testing.T) {
	for _, caso := range []struct {
		nome     string
		novo     func(promptlyDashMinter) func(context.Context) (string, error)
		esperado []string
	}{
		{"leitura", newPromptlyDashboardKeyResolver, []string{"prompt:read"}},
		{"promocao", func(m promptlyDashMinter) func(context.Context) (string, error) {
			return newPromptlyPromotionKeyResolver(m, &resolvedorDePapel{papel: "admin"})
		}, []string{"prompt:read", "prompt:write"}},
	} {
		t.Run(caso.nome, func(t *testing.T) {
			spy := &mintSpy{}
			// O broker REAL, com os mesmos escopos do gateway em produção.
			broker, err := promptly.NewBroker(spy, 8, time.Hour, []string{"prompt:read", "prompt:write"})
			if err != nil {
				t.Fatalf("broker: %v", err)
			}
			ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-1", AccountID: "acc-1", Subject: "u-ana", Role: "admin", Email: "ana@exemplo.test"})

			chave, err := caso.novo(broker)(ctx)

			if err != nil {
				t.Fatalf("o broker REAL recusou o que o resolver pede: %v", err)
			}
			if chave == "" {
				t.Fatal("credencial vazia")
			}
			// E o que chegou ao mint é o namespace do SERVIÇO, depois da tradução.
			if len(spy.escoposCunhados) != len(caso.esperado) {
				t.Fatalf("escopos cunhados = %v, quer %v", spy.escoposCunhados, caso.esperado)
			}
			for i, e := range caso.esperado {
				if spy.escoposCunhados[i] != e {
					t.Errorf("escopo[%d] = %q, quer %q", i, spy.escoposCunhados[i], e)
				}
			}
		})
	}
}

// resolvedorDePapel é a fonte AUTORITATIVA — `tenant_members`, não o token.
type resolvedorDePapel struct {
	papel    string
	err      error
	pedidoDe string
}

func (r *resolvedorDePapel) GetRole(_ context.Context, userID string) (string, error) {
	r.pedidoDe = userID
	return r.papel, r.err
}

// O papel tem de vir da FONTE, não de um campo que ninguém preencheu.
//
// A rodada 3 da aceitação do M18 pegou isto no ar: o resolver lia `UserContext.Role`, que só é
// carimbado pelo middleware `RequireRole` — e as rotas do promptly montam apenas `requireJWT`. O
// campo chegava vazio SEMPRE, o fallback o rebaixava a `member`, e o efeito era um teto
// silencioso: nenhum operador, por mais autoridade que tivesse, alcançava uma ação que exige
// `admin`. Ler um campo que ninguém preencheu e cair para o menor valor é pior que falhar — falha
// aparece, teto silencioso não.
func TestPapelVemDaFonteAutoritativaNaoDoCampoNaoPreenchido(t *testing.T) {
	m := &recordingPromptlyMinter{}
	fonte := &resolvedorDePapel{papel: "owner"}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{
		TenantID: "tn-alpha", AccountID: "acc-1", Subject: "u-ana", Email: "ana@exemplo.test",
		// Role deliberadamente VAZIO: é o estado real nas rotas do promptly.
	})

	if _, err := newPromptlyPromotionKeyResolver(m, fonte)(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if fonte.pedidoDe != "u-ana" {
		t.Errorf("consultou %q; o papel é do SUJEITO autenticado", fonte.pedidoDe)
	}
	if m.gotRole != "owner" {
		t.Errorf("papel = %q, quero owner — veio do campo vazio em vez da fonte", m.gotRole)
	}
}

// Sem membership a fonte devolve "" — e aí `member` é o valor CERTO, não um fallback por descuido:
// quem não tem papel declarado tem o menor. A distinção com o teste acima é o ponto: um é ausência
// real, o outro era cegueira.
func TestSemPapelDeclaradoUsaOMenor(t *testing.T) {
	m := &recordingPromptlyMinter{}
	fonte := &resolvedorDePapel{papel: ""}
	ctx := auth.WithUser(context.Background(), &auth.UserContext{
		TenantID: "tn-alpha", AccountID: "acc-1", Subject: "u-sem", Email: "sem@exemplo.test",
	})

	if _, err := newPromptlyPromotionKeyResolver(m, fonte)(ctx); err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if m.gotRole != "member" {
		t.Errorf("papel = %q, quero member — sem papel declarado, o menor", m.gotRole)
	}
}
