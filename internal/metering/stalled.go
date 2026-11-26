// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package metering

import "time"

// Separar a espera do travamento.
//
// MEDIDO em 2026-08-11. Ao encontrar um registro de uso cujo tenant tem assinatura sem
// `stripe_subscription_item_id`, o reporter registra um WARN e segue. A espera é
// deliberada e correta — reportar consumo contra um id errado seria pior —, e o comentário
// original explica que o campo *"backfills on the next subscription.updated"*.
//
// O que faltava medir: o ÚNICO escritor desse campo é `internal/billing/webhook.go`
// (linhas 299 e 315). O preenchimento chega por evento do Stripe, e no app-dev o segredo
// que verifica esses eventos estava ausente — então todos eram recusados, e a espera
// transitória era permanente.
//
// Os dois estados produziam o mesmo WARN, de hora em hora, indefinidamente. Um aviso que
// se repete para sempre deixa de ser sinal e vira ruído de fundo; foi por isso que ninguém
// agiu durante 20 horas.
//
// A correção não é falhar de imediato — isso quebraria o caso legítimo em que a assinatura
// acabou de ser criada e o evento ainda está a caminho. É decidir, pela IDADE do registro,
// qual dos dois estados está diante de nós.

// PendingItemState classifica um registro de uso que não pode ser reportado.
type PendingItemState int

const (
	// AwaitingBackfill — a assinatura é recente e o evento que preenche o item ainda
	// pode chegar. Comportamento normal, não merece alarme.
	AwaitingBackfill PendingItemState = iota
	// Stalled — passou tempo suficiente para o evento ter chegado. Se não chegou, algo
	// no caminho dos eventos de pagamento está quebrado, e o consumo deste período não
	// será cobrado de ninguém.
	Stalled
)

// BackfillGracePeriod é quanto tempo a espera continua sendo espera.
//
// Vinte e quatro horas cobrem com folga o atraso de entrega do Stripe (que reentrega por
// até três dias, mas cuja primeira tentativa é imediata) e o intervalo horário do próprio
// reporter. Apertada demais, a tolerância transformaria o fluxo normal de upgrade num
// alarme; larga demais, ela reproduz o silêncio que este trabalho existe para acabar.
//
// É uma decisão, não uma constante técnica — por isso é exportada e testada explicitamente.
const BackfillGracePeriod = 24 * time.Hour

// ClassifyPendingItem decide se um registro está esperando ou travado.
//
// Recebe `agora` como parâmetro em vez de chamar `time.Now()`: um teste que depende do
// relógio do processo é não-determinístico, e `rules/testing.md § 6` proíbe exatamente isso.
func ClassifyPendingItem(recordCreatedAt, agora time.Time) PendingItemState {
	if recordCreatedAt.After(agora) {
		// Data futura vem de desvio de relógio entre réplicas, não de travamento.
		// Classificá-la como travada mandaria quem opera investigar a cobrança quando
		// o problema está na infraestrutura.
		return AwaitingBackfill
	}
	if agora.Sub(recordCreatedAt) > BackfillGracePeriod {
		return Stalled
	}
	return AwaitingBackfill
}

// Explain descreve o estado para quem opera, apontando a causa provável.
//
// O aviso antigo dizia o sintoma — o campo estava vazio — e era exatamente essa mensagem
// que se repetia sem levar ninguém a lugar nenhum. Nomear a causa é o que transforma o
// aviso em algo acionável.
func (s PendingItemState) Explain() string {
	switch s {
	case Stalled:
		return "o consumo não pode ser cobrado: a assinatura segue sem o identificador que o " +
			"recebe, e ele só é preenchido por um evento de pagamento. Se ele não chegou em " +
			"24h, o caminho dos eventos de pagamento (webhook) provavelmente está quebrado"
	default:
		return "aguardando o evento de pagamento que completa a assinatura"
	}
}
