package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/auth"
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

// O caminho de PROMOCAO cunha `skills:publish` — e o de leitura NAO o tem.
//
// Este par e a fronteira inteira: sao dois clientes com duas credenciais, e a diferenca entre eles
// e o que impede o caminho de leitura de promover um canal mesmo que alguem registre por engano uma
// rota mutante sobre ele. Asserir so um dos dois deixaria passar exatamente a inversao que importa.
func TestSkillsPromotionResolverMintsPublishAndReadNeverDoes(t *testing.T) {
	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tn-alpha", AccountID: "acc-1"})

	promo := &recordingSkillsMinter{}
	if _, err := newSkillsPromotionKeyResolver(promo)(ctx); err != nil {
		t.Fatalf("resolver de promocao: %v", err)
	}
	temPublish := false
	for _, s := range promo.gotScopes {
		if s == "skills:publish" {
			temPublish = true
		}
	}
	if !temPublish {
		t.Errorf("promocao cunhou %v; precisa de skills:publish, senao a tela nao consegue promover", promo.gotScopes)
	}

	leitura := &recordingSkillsMinter{}
	if _, err := newSkillsDashboardKeyResolver(leitura)(ctx); err != nil {
		t.Fatalf("resolver de leitura: %v", err)
	}
	for _, s := range leitura.gotScopes {
		if s == "skills:publish" {
			t.Fatalf("a credencial de LEITURA carrega skills:publish (%v) — o caminho de leitura passa a poder promover um canal, que e a operacao mais perigosa do produto", leitura.gotScopes)
		}
	}
}

// Fail-closed tambem na mutacao, e ANTES da cunhagem.
func TestSkillsPromotionResolverFailsClosedWithoutTenant(t *testing.T) {
	m := &recordingSkillsMinter{}

	if _, err := newSkillsPromotionKeyResolver(m)(context.Background()); err == nil {
		t.Fatal("esperava erro; sem tenant autenticado nao pode haver chave de promocao")
	}
	if m.calls != 0 {
		t.Errorf("minter chamado %d vez(es); fail-closed e ANTES da cunhagem", m.calls)
	}
}

// M31 — o resolver de AUTORIA (T-governança).
//
// Terceiro cliente, terceira credencial, e a separação é o mecanismo — não organização de
// arquivo. `skills:write` apaga e edita skills; `skills:publish` promove canais e deprecia.
// Fundir os dois daria ao caminho de curadoria o poder de destruir, e ao de autoria o poder de
// redirecionar consumidores. São danos diferentes e não devem viajar na mesma chave.
func TestSkillsAuthoringResolverMintsWriteAndNeverPublish(t *testing.T) {
	minter := &recordingSkillsMinter{}
	resolver := newSkillsAuthoringKeyResolver(minter)

	ctx := auth.WithUser(context.Background(), &auth.UserContext{AccountID: "acct_1", TenantID: "tn_1"})
	if _, err := resolver(ctx); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}

	if minter.calls != 1 {
		t.Fatalf("esperava um mint, veio %d", minter.calls)
	}
	got := minter.gotScopes
	temRead, temWrite, temPublish := false, false, false
	for _, s := range got {
		switch s {
		case "skills:read":
			temRead = true
		case "skills:write":
			temWrite = true
		case "skills:publish":
			temPublish = true
		}
	}
	if !temWrite {
		t.Fatalf("autoria precisa de skills:write: %v", got)
	}
	// `read` entra junto porque a tela de autoria também LÊ antes de agir — e uma credencial que
	// só escreve obrigaria um quarto cliente sem ganho algum de isolamento.
	if !temRead {
		t.Fatalf("autoria precisa de skills:read para ler antes de agir: %v", got)
	}
	// A metade que impede a fusão silenciosa: promover canal reaponta consumidores sem redeploy,
	// e esse poder NÃO deve viajar na chave que apaga.
	if temPublish {
		t.Fatalf("autoria NÃO deve carregar skills:publish: %v", got)
	}
}

func TestSkillsAuthoringResolverFailsClosedWithoutTenant(t *testing.T) {
	minter := &recordingSkillsMinter{}
	if _, err := newSkillsAuthoringKeyResolver(minter)(context.Background()); err == nil {
		t.Fatal("sem tenant autenticado o resolver deve falhar ANTES de cunhar")
	}
	if minter.calls != 0 {
		t.Fatalf("não deveria ter cunhado: %d", minter.calls)
	}
}
