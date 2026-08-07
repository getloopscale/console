// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package config

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// O tipo Secret existe para que um segredo nunca apareca num log, num %v ou num
// corpo JSON. Os quatro metodos que fazem isso — String, GoString, MarshalJSON,
// MarshalText — sao invocados por DESPACHO DE INTERFACE a partir de fmt e de
// encoding/json. Nenhum deles tem chamador estatico no repo, e era exatamente
// assim que o gate de code-quality os reportava como codigo morto.
//
// A leitura correta do achado nao era "apague-os": era "nada exercita a
// redacao". Apagar qualquer um faz o segredo voltar a serializar em claro, sem
// nenhum teste ficando vermelho — que e a definicao de uma regressao silenciosa
// de seguranca.
//
// Este arquivo fecha as duas coisas de uma vez: prova o invariante e torna os
// metodos alcancaveis para a analise (`deadcode -test`), pelo caminho legitimo
// de terem um consumidor de verdade.
const segredoReal = "sk_live_naoDeveVazar_9f3a2b"

func TestSecret_RedigeEmTodasAsRotasDeFormatacao(t *testing.T) {
	s := Secret(segredoReal)

	// IGUALDADE EXATA, nao "contem ***". Uma revisao mostrou que a assercao
	// frouxa deixava passar o mutante `String() { return "***" + string(s)[:8] }`,
	// cuja saida e `***sk_live_` — prefixo de chave, que e vazamento real e o
	// bastante para identificar o provedor e o ambiente.
	//
	//nolint:staticcheck // S1025 manda trocar fmt.Sprintf("%s", s) por s.String().
	// O conselho e correto em geral e errado aqui: o objeto sob teste E o despacho
	// de fmt para a interface Stringer. Chamar String() direto testaria o metodo e
	// deixaria de testar a rota pela qual o segredo realmente vaza num log.
	casos := []struct {
		nome     string
		obtido   string
		esperado string
	}{
		{"%s — o caso de log mais comum", fmt.Sprintf("%s", s), "***"},
		{"%v — usado por slog e por print de struct", fmt.Sprintf("%v", s), "***"},
		{"%q — citado, ainda assim redigido", fmt.Sprintf("%q", s), `"***"`},
		{"%#v — dump de debug via GoString", fmt.Sprintf("%#v", s), "***"},
		{"String() direto", s.String(), "***"},
		{"GoString() direto", s.GoString(), "***"},
	}

	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			if strings.Contains(c.obtido, segredoReal) {
				t.Fatalf("o segredo vazou inteiro: %q", c.obtido)
			}
			if c.obtido != c.esperado {
				t.Errorf("esperava exatamente %q, obtive %q — qualquer coisa alem da mascara e vazamento parcial", c.esperado, c.obtido)
			}
		})
	}
}

func TestSecret_RedigeAoSerializarEmJSON(t *testing.T) {
	b, err := json.Marshal(Secret(segredoReal))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(b); got != `"***"` {
		t.Errorf("esperava \"***\", obtive %s", got)
	}
}

func TestSecret_RedigeQuandoEhCampoDeStruct(t *testing.T) {
	// O vetor realista: ninguem serializa um Secret sozinho — ele viaja dentro
	// de uma struct de configuracao que alguem loga ou devolve num endpoint de
	// diagnostico.
	payload := struct {
		Nome  string `json:"nome"`
		Token Secret `json:"token"`
	}{Nome: "cloud", Token: Secret(segredoReal)}

	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), segredoReal) {
		t.Fatalf("o segredo vazou no JSON da struct: %s", b)
	}
	if !strings.Contains(string(b), `"token":"***"`) {
		t.Errorf("esperava o token mascarado, obtive %s", b)
	}
}

func TestSecret_RedigeViaMarshalText(t *testing.T) {
	// encoding.TextMarshaler e o caminho usado por bibliotecas que serializam
	// para YAML, para query string ou para variavel de ambiente. Ter os outros
	// tres e faltar este deixaria uma rota aberta.
	b, err := Secret(segredoReal).MarshalText()
	if err != nil {
		t.Fatalf("MarshalText: %v", err)
	}
	if string(b) != "***" {
		t.Errorf("esperava ***, obtive %q", b)
	}
}

func TestSecret_ValueDevolveOSegredoDeVerdade(t *testing.T) {
	// A contraparte necessaria: se a redacao valesse tambem para quem PRECISA
	// do valor, o tipo seria inutil e alguem trocaria Secret por string — que e
	// como a redacao se perde na pratica.
	if got := Secret(segredoReal).Value(); got != segredoReal {
		t.Errorf("Value() deve devolver o segredo intacto; obtive %q", got)
	}
}
