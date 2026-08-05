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
type promptUsage struct {
	Rows []struct {
		Resolutions float64 `json:"resolutions"`
	} `json:"rows"`
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
// O que continua NÃO sendo medição: corpo ilegível e métrica desconhecida. Ambos devolveriam um
// zero fabricado que dispararia toda regra `lt` do workspace.
func metricFromPromptUsage(body []byte, metric string) (float64, bool) {
	if metric != MetricPromptResolutions {
		return 0, false
	}
	var u promptUsage
	if err := json.Unmarshal(body, &u); err != nil {
		return 0, false
	}
	// Soma sobre as revisões: a pergunta do DoD é sobre o PROMPT. Escolher uma revisão exigiria uma
	// regra arbitrária sobre qual, e erraria durante uma promoção — quando o tráfego está dividido
	// entre duas e é justamente quando alguém quer ser avisado.
	var total float64
	for _, r := range u.Rows {
		total += r.Resolutions
	}
	return total, true
}
