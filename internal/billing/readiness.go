// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package billing

import (
	"fmt"
	"sort"
	"strings"
)

// A prontidão da cobrança é uma DESCRIÇÃO do estado, e não uma decisão sobre ele.
//
// MEDIDO em 2026-08-11: a composição ligava a cobrança inteira com uma condição só —
// `if cfg.StripeAPIKey.Value() != ""` — e o segredo do webhook entrava sem ser olhado. No
// app-dev ele estava ausente, e o processo registrou "billing enabled" enquanto TODO evento
// de pagamento enviado pelo Stripe era recusado por falta do segredo que os verifica.
//
// A segurança nunca esteve em risco: `VerifySignature` (webhook.go:376) recusa segredo
// vazio, então falha fechado e ninguém forja um evento. O que se perdeu foi a verdade — o
// sistema afirmava funcionar enquanto metade dele estava morta, e a afirmação é o que
// impede alguém de agir.
//
// Este tipo separa três estados que a condição única confundia num só:
//
//	ausente  — nenhum insumo. É uma escolha válida: o hermético roda assim de propósito.
//	parcial  — parte dos insumos. É o estado PERIGOSO: parece pronto e não está.
//	pronta   — todos os insumos.
//
// Quem decide o que fazer com cada estado é o chamador, que sabe se este ambiente prometeu
// cobrar. Misturar a descrição com a decisão foi o que produziu o defeito: a composição
// julgava e descrevia ao mesmo tempo, e nenhum teste conseguia alcançar o julgamento.

// requiredInput é um insumo sem o qual a cobrança não está inteira.
//
// O nome é o que aparece para o operador — deliberadamente na linguagem do produto, e não
// na do mecanismo que o entrega (Rule 3).
type requiredInput struct {
	name    string
	present bool
}

// Readiness descreve o estado da configuração de cobrança.
type Readiness struct {
	// Missing nomeia os insumos ausentes, ordenados para que a mensagem seja estável
	// entre execuções — uma mensagem que muda de ordem a cada boot é ruído no diff de
	// quem compara dois logs.
	Missing []string
	// total é quantos insumos a cobrança exige, usado para distinguir a ausência total
	// (uma escolha) da parcial (um defeito).
	total int
}

// AssessReadiness avalia os insumos da cobrança.
//
// Recebe os valores já resolvidos, em vez de ler a configuração: é o que torna os três
// estados testáveis sem montar um processo inteiro, e foi a ausência dessa costura que
// deixou o julgamento fora do alcance dos testes por tanto tempo.
func AssessReadiness(apiKey, webhookSecret string) Readiness {
	inputs := []requiredInput{
		{name: "a chave de integração de pagamentos", present: strings.TrimSpace(apiKey) != ""},
		{name: "o segredo que verifica os eventos de pagamento (webhook)", present: strings.TrimSpace(webhookSecret) != ""},
	}
	r := Readiness{total: len(inputs)}
	for _, in := range inputs {
		if !in.present {
			r.Missing = append(r.Missing, in.name)
		}
	}
	sort.Strings(r.Missing)
	return r
}

// Ready responde se a cobrança está inteira.
func (r Readiness) Ready() bool { return len(r.Missing) == 0 }

// Partial responde se a cobrança está configurada PELA METADE.
//
// É o estado que este tipo existe para nomear. A ausência total é uma escolha legítima; a
// parcialidade é sempre um defeito, porque nenhum ambiente decide oferecer cobrança sem
// conseguir verificar quem pagou.
func (r Readiness) Partial() bool {
	return len(r.Missing) > 0 && len(r.Missing) < r.total
}

// Explain descreve o estado em uma frase, na linguagem de quem opera.
//
// Nomeia TODOS os insumos ausentes de uma vez: uma mensagem que cita um só faz o operador
// consertar metade, reiniciar e descobrir o resto — duas viagens onde uma bastava.
func (r Readiness) Explain() string {
	if r.Ready() {
		return "cobrança configurada por completo"
	}
	if len(r.Missing) == r.total {
		return "cobrança não configurada neste ambiente"
	}
	return fmt.Sprintf("cobrança configurada pela metade — falta %s. "+
		"Enquanto isso, todo evento de pagamento recebido é recusado",
		strings.Join(r.Missing, " e "))
}
