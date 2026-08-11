// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package metering

import (
	"testing"
	"time"
)

// A espera que não termina.
//
// MEDIDO em 2026-08-11. O reporter, ao encontrar um registro de uso cujo tenant tem
// assinatura sem `stripe_subscription_item_id`, registra um WARN e segue — e o comentário
// em `reporter.go:97` explica por quê: *"backfills on the next subscription.updated"*. É
// uma espera deliberada e correta, para não reportar consumo contra o id errado.
//
// O que ninguém tinha medido: o ÚNICO escritor desse campo é `internal/billing/webhook.go`
// (linhas 299 e 315). O preenchimento chega por evento do Stripe — e o segredo que verifica
// esses eventos estava ausente do app-dev, então todos eram recusados. A espera transitória
// era, na prática, permanente.
//
// Os dois estados produzem exatamente o mesmo WARN, de hora em hora, para sempre. Um WARN
// que se repete indefinidamente deixa de ser um sinal e vira ruído de fundo — e foi por
// isso que ninguém agiu.
//
// A correção NÃO é falhar de imediato: isso quebraria o caso legítimo, em que a assinatura
// acaba de ser criada e o evento ainda está a caminho. É separar "esperando" de "travado",
// que é o que a idade do registro permite decidir.

// TestEsperaRecenteEToleravel protege o caso legítimo.
func TestEsperaRecenteEToleravel(t *testing.T) {
	agora := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	recente := agora.Add(-5 * time.Minute)

	if ClassifyPendingItem(recente, agora) != AwaitingBackfill {
		t.Fatal("uma assinatura recém-criada espera legitimamente pelo evento que preenche " +
			"o item; tratar isso como defeito quebraria o fluxo normal de upgrade")
	}
}

// TestEsperaLongaETravamento é o caso medido.
func TestEsperaLongaETravamento(t *testing.T) {
	agora := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	velho := agora.Add(-25 * time.Hour)

	if ClassifyPendingItem(velho, agora) != Stalled {
		t.Fatal("um registro que espera há mais de um dia não está esperando: o evento que " +
			"o desbloquearia já teria chegado. Continuar tratando isso como espera é o que " +
			"manteve o app-dev emitindo o mesmo WARN de hora em hora sem que ninguém agisse")
	}
}

// TestAFronteiraEExplicita — o limite é uma decisão, e decisões são testadas.
func TestAFronteiraEExplicita(t *testing.T) {
	agora := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)

	if ClassifyPendingItem(agora.Add(-BackfillGracePeriod+time.Minute), agora) != AwaitingBackfill {
		t.Error("dentro da tolerância ainda é espera")
	}
	if ClassifyPendingItem(agora.Add(-BackfillGracePeriod-time.Minute), agora) != Stalled {
		t.Error("passada a tolerância é travamento")
	}
	if BackfillGracePeriod < time.Hour {
		t.Errorf("a tolerância (%s) precisa acomodar o atraso de entrega do Stripe e o "+
			"intervalo horário do próprio reporter; apertada demais, ela transforma o "+
			"fluxo normal em alarme", BackfillGracePeriod)
	}
}

// TestRegistroDoFuturoNaoETravamento — relógios divergem entre réplicas.
//
// Um registro com data futura viria de desvio de relógio, não de travamento. Classificá-lo
// como travado transformaria um problema de infraestrutura num alarme de cobrança, mandando
// quem opera investigar o lugar errado.
func TestRegistroDoFuturoNaoETravamento(t *testing.T) {
	agora := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	if ClassifyPendingItem(agora.Add(time.Hour), agora) != AwaitingBackfill {
		t.Error("data futura é desvio de relógio, não travamento")
	}
}

// TestOTravamentoSeExplica — quem lê precisa saber o que fazer.
//
// A mensagem tem de apontar a CAUSA provável (o evento que não chega), e não apenas o
// sintoma (o campo vazio) — porque o campo vazio foi exatamente o que o WARN antigo já
// dizia, de hora em hora, sem levar ninguém a lugar nenhum.
func TestOTravamentoSeExplica(t *testing.T) {
	e := Stalled.Explain()
	if e == "" {
		t.Fatal("um travamento sem explicação repete o WARN que ninguém leu")
	}
	if !contémAlgum(e, "evento", "pagamento", "webhook") {
		t.Errorf("a explicação precisa apontar o evento que não chegou; veio %q", e)
	}
}

func contémAlgum(s string, alvos ...string) bool {
	for _, a := range alvos {
		for i := 0; i+len(a) <= len(s); i++ {
			if s[i:i+len(a)] == a {
				return true
			}
		}
	}
	return false
}
