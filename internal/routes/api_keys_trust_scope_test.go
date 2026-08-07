package routes

import (
	"testing"

	"github.com/usetheoai/theo-cloud/internal/trust"
)

// TestTrustScopesRegistered trava os escopos trust:* no registro ativo — cruzando com a
// lista que o BROKER sabe cunhar, em vez de repeti-la à mão.
//
// O DEFEITO QUE ISTO PREVINE já ocorreu QUATRO vezes nesta base, e nos dois sentidos:
//
//   - 2026-07-31: a cadeia Model B do theo-trust estava inteira de pé — borda roteando,
//     ForwardAuth ligado, broker cunhando por tenant — e nenhum cliente podia usá-la,
//     porque `trust:read` não existia neste enum. A capacidade ficou inalcançável sem que
//     nada ficasse vermelho.
//   - 2026-08-02: o inverso. `trust:content` foi adicionado a este enum e ao catálogo da
//     tela, e NÃO à lista do broker. A API aceitava o escopo, devolvia 200 e cunhava a
//     chave — e a borda descartava o escopo na travessia. Medido pela borda: a chave
//     interna do tenant saía como `["trust:read"]`. Falha silenciosa: nada avisa que o
//     escopo não será honrado.
//
// A versão anterior deste teste repetia a lista como literal e explicava em COMENTÁRIO que
// ela vinha do broker. Comentário não é asserção — e foi exatamente por ali que a quarta
// ocorrência passou. Agora a fonte é `trust.CustomerScopes`, e a divergência deixa de ser
// possível porque só existe uma lista.
func TestTrustScopesRegistered(t *testing.T) {
	if len(trust.CustomerScopes) == 0 {
		t.Fatal("trust.CustomerScopes está vazia — o cruzamento abaixo não provaria nada")
	}
	for _, s := range trust.CustomerScopes {
		if !validScopes[s] {
			t.Errorf("scope %q é cunhável pelo broker mas NÃO é emitível: nenhum cliente o alcança", s)
		}
	}

	// O outro sentido: um escopo `trust:*` emitível que o broker não sabe cunhar produz a
	// falha silenciosa de 2026-08-02 — chave aceita, escopo descartado na borda.
	cunhavel := make(map[string]bool, len(trust.CustomerScopes))
	for _, s := range trust.CustomerScopes {
		cunhavel[s] = true
	}
	for s := range validScopes {
		if len(s) > 6 && s[:6] == "trust:" && !cunhavel[s] {
			t.Errorf("scope %q é emitível mas o broker não sabe cunhá-lo: a borda o descartaria em silêncio", s)
		}
	}

	if validScopes["trust:admin"] {
		t.Error("trust:admin must NOT be customer-issuable")
	}
	if validScopes["trust:platform-admin"] {
		t.Error("trust:platform-admin is the gateway's own credential — never customer-issuable")
	}
}
