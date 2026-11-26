// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package billing

import (
	"strings"
	"testing"
)

// A afirmação falsa que originou todo o trabalho.
//
// MEDIDO em 2026-08-11: `cmd/main.go` liga a cobrança inteira com uma condição só —
// `if cfg.StripeAPIKey.Value() != ""` — e o segredo do webhook entra sem ser olhado. No
// app-dev o Secret `loopscale-stripe-webhook` estava ausente, `StripeWebhookSecret` era vazia,
// e o processo registrou `"billing enabled"` às 09:44:08.
//
// O que salva a segurança é `VerifySignature` (webhook.go:376), que recusa segredo vazio —
// falha FECHADO, corretamente, e ninguém consegue forjar um evento de pagamento. O defeito
// é de correção: TODO evento legítimo do Stripe foi recusado durante 20h, enquanto o log
// afirmava que a cobrança funcionava.
//
// Um sistema que se declara pronto pela metade é pior que um que se declara indisponível:
// o segundo faz alguém agir.

// TestCobrancaCompletaEDeclaradaPronta — o caminho feliz.
func TestCobrancaCompletaEDeclaradaPronta(t *testing.T) {
	r := AssessReadiness("rk_test_algo", "whsec_algo")
	if !r.Ready() {
		t.Fatalf("com os dois insumos a cobrança está inteira; veio não-pronta: %s", r.Explain())
	}
	if len(r.Missing) != 0 {
		t.Errorf("nada deveria faltar, veio %v", r.Missing)
	}
}

// TestSegredoDeWebhookVazioNaoEProntidao é o caso medido no app-dev.
func TestSegredoDeWebhookVazioNaoEProntidao(t *testing.T) {
	r := AssessReadiness("rk_test_algo", "")
	if r.Ready() {
		t.Fatal("sem o segredo do webhook todo evento de pagamento é recusado; " +
			"declarar isso como pronto foi exatamente o que aconteceu por 20h no app-dev")
	}
	if len(r.Missing) != 1 {
		t.Fatalf("queria exatamente o insumo que falta, veio %v", r.Missing)
	}
	if !strings.Contains(strings.ToLower(r.Explain()), "webhook") {
		t.Errorf("a explicação precisa nomear QUAL insumo falta; veio %q", r.Explain())
	}
}

// TestChaveDeApiVaziaNaoEProntidao preserva o comportamento anterior no caso simétrico.
func TestChaveDeApiVaziaNaoEProntidao(t *testing.T) {
	r := AssessReadiness("", "whsec_algo")
	if r.Ready() {
		t.Fatal("sem chave de API não há como falar com o Stripe")
	}
}

// TestAusenciaTotalNomeiaOsDois — quem lê o log precisa saber o tamanho do buraco.
func TestAusenciaTotalNomeiaOsDois(t *testing.T) {
	r := AssessReadiness("", "")
	if r.Ready() {
		t.Fatal("sem nenhum insumo a cobrança não existe")
	}
	if len(r.Missing) != 2 {
		t.Fatalf("os DOIS insumos faltam; uma mensagem que cita um só manda o operador "+
			"consertar metade e voltar. Veio %v", r.Missing)
	}
}

// TestAConfiguracaoAusenteNaoEUmErroDeCobranca separa duas coisas diferentes.
//
// Não ter cobrança configurada é legítimo — o hermético roda assim de propósito. O que não
// é legítimo é dizer que ela funciona. A prontidão é uma DESCRIÇÃO do estado, e quem decide
// o que fazer com ela é o chamador, que sabe se o ambiente prometeu cobrar.
func TestAConfiguracaoAusenteNaoEUmErroDeCobranca(t *testing.T) {
	r := AssessReadiness("", "")
	if r.Partial() {
		t.Error("ausência total não é parcialidade: é um ambiente que não configurou cobrança, " +
			"e isso é uma escolha válida")
	}
	if !AssessReadiness("rk_test_algo", "").Partial() {
		t.Error("metade configurada é o estado perigoso — o que parece pronto e não está")
	}
}

// TestExplicacaoNaoVazaTermoInterno — Rule 3.
//
// A explicação vai para o log do operador e pode chegar a uma página de estado. Nomes de
// mecanismo interno não dizem nada a quem lê e vazam a implementação.
func TestExplicacaoNaoVazaTermoInterno(t *testing.T) {
	e := strings.ToLower(AssessReadiness("", "").Explain())
	for _, proibido := range []string{"kubernetes", "secret ", "configmap", "helm", "cluster"} {
		if strings.Contains(e, proibido) {
			t.Errorf("a explicação não deve citar %q; veio %q", proibido, e)
		}
	}
}
