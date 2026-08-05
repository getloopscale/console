// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import "encoding/json"

// MetricPromptResolutions — a métrica escopada a prompt do M21 DoD-5 do theo-promptly.
//
// O nome carrega o escopo porque é ele que o avaliador usa para decidir QUAL agregado buscar,
// antes de ter dado algum. O engine impõe o pareamento com `prompt_name` no banco
// (migração 000060), então uma regra desta métrica sem prompt é irrepresentável.
const MetricPromptResolutions = "prompt_resolutions"

// isPromptScoped diz se a métrica se mede por prompt, e não pelo workspace inteiro.
//
// Allow-list, nunca prefixo: `strings.HasPrefix(m, "prompt_")` faria uma métrica futura de nome
// parecido consultar o agregado errado em silêncio — e medir outra coisa é pior que não medir.
// A asserção que sustenta esta frase está em `TestEscopoDePromptEReconhecidoPeloNomeDaMetrica`.
func isPromptScoped(metric string) bool {
	return metric == MetricPromptResolutions
}

// promptUsage é o subconjunto de `GET /v1/analytics/prompt-usage` que o avaliador lê.
//
// O agregado é **por revisão sobre a janela inteira** — não há dimensão de tempo, e portanto não há
// série a bucketizar. Um monitor sobre ele compara um valor de janela com um limiar, que é
// exatamente o que a máquina anti-tempestade existente já sabe fazer.
// Os PONTEIROS são o contrato, não estilo. `json.Unmarshal` não falha quando uma chave está
// ausente — ele deixa o zero-value —, então um campo renomeado lá em cima chegaria aqui como
// `0` indistinguível de um zero medido. Ponteiro nil distingue **ausente** de **zero**, que é a
// única distinção que importa nesta função.
type promptUsage struct {
	Rows *[]promptUsageRow `json:"rows"`
}

type promptUsageRow struct {
	Resolutions *float64 `json:"resolutions"`
}

// metricFromPromptUsage extrai o valor da métrica sobre a janela, mais se houve MEDIÇÃO.
//
// O bool diverge do irmão `metricFromSeries` de propósito, e a razão está no transporte:
// `PromptUsage` já separa "não consegui ler" (sobe como *UpstreamStatusError) de "não há nada a
// mostrar" (agregado vazio) — ver o comentário do método em `internal/thelens/data_client.go`.
//
// Como a falha de leitura nunca chega aqui disfarçada de vazio, `rows: []` significa literalmente
// "ninguém resolveu este prompt na janela". Isso é uma medição, e devolvê-la como ausência — por
// simetria com o irmão, que enfrenta outro transporte — tornaria impossível de escrever a regra
// "avise se este prompt parar de ser usado": ela seria pulada exatamente na condição que existe
// para detectar. É o theo-cloud#247 pelo avesso.
//
// O que NÃO é medição, e por quê — as três formas devolveriam um zero fabricado, e zero com
// comparador `lt` é violação:
//
//   - corpo ilegível;
//   - métrica desconhecida;
//   - **contrato quebrado** — a chave `rows` ausente, ou uma linha sem `resolutions`.
//
// A terceira é a que quase escapou, e é a mais perigosa das três: `json.Unmarshal` de um objeto
// VÁLIDO com a chave faltando não falha, e um campo renomeado no theo-lens — a forma que toda
// mudança de schema tem — dispararia todas as regras "avise se este prompt parar de ser usado".
// Justamente as regras que existem para detectar que algo PAROU seriam as primeiras a mentir.
//
// Pior ainda no nível da linha: com uma linha íntegra ao lado de uma derivada, o total sai
// **errado** em vez de zero — um número plausível que ninguém questiona.
//
// Exigir presença NÃO é exigir exclusividade: campo novo no agregado é evolução legítima e
// frequente do upstream, e recusá-la transformaria cada release do theo-lens numa parada de alerta.
func metricFromPromptUsage(body []byte, metric string) (float64, bool) {
	if metric != MetricPromptResolutions {
		return 0, false
	}
	var u promptUsage
	if err := json.Unmarshal(body, &u); err != nil {
		return 0, false
	}
	// A chave AUSENTE não é uma lista vazia. `rows: []` diz "ninguém resolveu este prompt" — uma
	// medição. Nenhum `rows` diz "isto não é o agregado que eu sei ler", e devolver zero aí
	// dispararia toda regra `lt` do workspace por causa de uma mudança de schema lá em cima.
	if u.Rows == nil {
		return 0, false
	}
	// Soma sobre as revisões: a pergunta do DoD é sobre o PROMPT. Escolher uma revisão exigiria uma
	// regra arbitrária sobre qual, e erraria durante uma promoção — quando o tráfego está dividido
	// entre duas e é justamente quando alguém quer ser avisado.
	//
	// Uma linha SEM o campo que se soma é o mesmo defeito uma camada abaixo, e o mais insidioso dos
	// dois: com uma linha íntegra ao lado de uma derivada, o total sai **errado** em vez de zero —
	// um número plausível que ninguém questiona.
	var total float64
	for _, r := range *u.Rows {
		if r.Resolutions == nil {
			return 0, false
		}
		total += *r.Resolutions
	}
	return total, true
}
