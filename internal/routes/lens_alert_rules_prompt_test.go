// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import "testing"

// loopprompt M21 DoD-5 — o pareamento prompt↔métrica na borda.
//
// O banco já o impõe (CHECK da migração 000060). Esta é a metade AMIGÁVEL: sem ela o cliente
// recebe uma violação de constraint em vez de uma mensagem tipada, e é a mesma escolha que o M135
// fez para o pareamento de monitor.
//
// A validação é pura de propósito — a rota inteira precisa de banco, sessão e webhook, e nada
// disso é necessário para provar a regra que de fato decide o 400.

func TestMetricaDePromptEAceitaPelaBorda(t *testing.T) {
	// Sem isto a rota rejeita a métrica que a migração já admite, e o monitor de prompt fica
	// indefinível — a tela teria um formulário que o servidor recusa.
	if !validAlertMetrics[MetricPromptResolutions] {
		t.Fatalf("%q tem de ser aceita: a migração 000060 já a admite no banco", MetricPromptResolutions)
	}
}

func TestPareamentoDePromptRecusaOsDoisEstadosQueFalhamEmSilencio(t *testing.T) {
	// Os mesmos dois estados que o CHECK torna irrepresentáveis, cada um com seu modo de falha:
	//
	//   (a) métrica de prompt SEM nome  → o avaliador não tem o que consultar e pula a regra para
	//       sempre; o cliente vê uma regra armada que nunca dispara.
	//   (b) nome de prompt em OUTRA métrica → simplesmente ignorado, e o próximo leitor não sabe
	//       dizer se o escopo valia.
	casos := []struct {
		nome    string
		metrica string
		prompt  string
		quer    bool // true = deve ser recusado
	}{
		{"prompt sem nome", MetricPromptResolutions, "", true},
		{"prompt com nome", MetricPromptResolutions, "saudacao", false},
		{"nome em métrica de workspace", "error_rate", "saudacao", true},
		{"métrica de workspace sem nome", "error_rate", "", false},
		{"nome só com espaços conta como ausente", MetricPromptResolutions, "   ", true},
	}
	for _, c := range casos {
		if got := promptPairingRejected(c.metrica, c.prompt); got != c.quer {
			t.Errorf("%s: recusado=%v, quero %v", c.nome, got, c.quer)
		}
	}
}
