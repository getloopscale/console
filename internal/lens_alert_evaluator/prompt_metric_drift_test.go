// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import "testing"

// Regressão: uma QUEBRA DE CONTRATO do theo-lens não pode virar uma medição de zero.
//
// A decisão de que agregado vazio é zero MEDIDO (e não ausência) é correta para o caso que a
// motivou — `rows: []` significa literalmente "ninguém resolveu este prompt". Mas ela deixou uma
// porta aberta que só aparece quando se pergunta *como o contrato quebra*:
//
//	json.Unmarshal de um objeto VÁLIDO que não tem a chave `rows` **não falha**. Devolve
//	Rows == nil, o laço soma nada, e a função responde (0, true).
//
// Zero com comparador `lt` é violação. Então um campo renomeado no theo-lens — exatamente a forma
// que uma mudança de schema tem — dispararia **toda** regra "avise se este prompt parar de ser
// usado", em vez de errar alto. É o theo-cloud#247 reentrando por outra porta: absence lida como
// measurement, só que a absence agora é do CONTRATO, não da janela.
//
// A assimetria é o que torna isto perigoso: a decisão de tratar vazio como zero é o que dá valor à
// regra de queda, e é a mesma decisão que faz a quebra de contrato disparar essa mesma regra. O
// remédio não é desfazer a decisão — é exigir a PRESENÇA das chaves de que o cálculo depende.

func TestObjetoValidoSemAChaveRowsNaoEMedicao(t *testing.T) {
	// A forma exata de uma mudança de schema no theo-lens: JSON íntegro, envelope reconhecível,
	// e a chave que eu leio simplesmente não está mais lá.
	for nome, corpo := range map[string][]byte{
		"envelope sem rows":        []byte(`{"promptName":"saudacao","windowDays":7}`),
		"rows renomeado":           []byte(`{"promptName":"saudacao","windowDays":7,"revisions":[]}`),
		"objeto vazio":             []byte(`{}`),
		"rows explicitamente null": []byte(`{"promptName":"saudacao","windowDays":7,"rows":null}`),
	} {
		v, ok := metricFromPromptUsage(corpo, MetricPromptResolutions)
		if ok {
			t.Errorf("%s: virou medição de %v — com comparador `lt` isso dispara toda regra de "+
				"queda do workspace por causa de uma quebra de contrato", nome, v)
		}
	}
}

func TestLinhaSemAChaveResolutionsNaoEMedicao(t *testing.T) {
	// O mesmo defeito uma camada abaixo, e o que um teste só sobre `rows` deixaria passar: o
	// envelope está certo, `rows` está lá, e o campo que eu somo é que foi renomeado. Cada linha
	// rende zero, o total rende zero, e a regra de queda dispara igual.
	casos := map[string][]byte{
		"resolutions renomeado": []byte(`{"promptName":"s","windowDays":7,"rows":[{"revision":6,"resolutionCount":42}]}`),
		"linha vazia":           []byte(`{"promptName":"s","windowDays":7,"rows":[{}]}`),
		"uma linha boa, uma sem o campo": []byte(
			`{"promptName":"s","windowDays":7,"rows":[{"revision":5,"resolutions":30},{"revision":6}]}`),
	}
	for nome, corpo := range casos {
		if v, ok := metricFromPromptUsage(corpo, MetricPromptResolutions); ok {
			t.Errorf("%s: virou medição de %v — uma linha sem o campo que se soma é contrato "+
				"quebrado, não zero", nome, v)
		}
	}
}

func TestVazioLEGITIMOSegueSendoZeroMedido(t *testing.T) {
	// O guarda que impede a correção acima de destruir a decisão que ela protege. `rows: []` —
	// chave PRESENTE, lista vazia — continua sendo "ninguém resolveu este prompt", que é uma
	// medição. Sem isto, a regra "avise se este prompt parar de ser usado" volta a ser impossível
	// de escrever, e o remédio teria matado o paciente.
	v, ok := metricFromPromptUsage([]byte(`{"promptName":"saudacao","windowDays":7,"rows":[]}`), MetricPromptResolutions)
	if !ok {
		t.Fatal("rows PRESENTE e vazio é zero medido — é a diferença entre 'ninguém usou' e " +
			"'o contrato mudou', e ela precisa sobreviver à correção")
	}
	if v != 0 {
		t.Fatalf("valor = %v, quero 0", v)
	}
}

func TestCampoNOVONoAgregadoNaoQuebraALeitura(t *testing.T) {
	// A outra metade da simetria: exigir as chaves de que dependo NÃO pode virar exigir que nada
	// mais exista. Uma mudança ADITIVA no theo-lens é legítima e frequente; recusá-la
	// transformaria toda evolução do upstream numa parada de alerta.
	corpo := []byte(`{"promptName":"s","windowDays":7,"tenantId":"tn-1",
		"rows":[{"revision":6,"resolutions":42,"p99LatencyMs":9,"cacheHits":3}]}`)
	v, ok := metricFromPromptUsage(corpo, MetricPromptResolutions)
	if !ok {
		t.Fatal("campo novo no agregado não é quebra de contrato — recusar aditivo pararia o " +
			"alerta a cada evolução do upstream")
	}
	if v != 42 {
		t.Fatalf("valor = %v, quero 42", v)
	}
}
