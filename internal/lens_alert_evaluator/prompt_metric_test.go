// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import "testing"

// theo-promptly M21 DoD-5 — a métrica escopada a prompt, extraída do agregado do M15.
//
// O agregado do theo-lens (`GET /v1/analytics/prompt-usage`) é **por revisão sobre a janela
// inteira**, não uma série temporal:
//
//	{promptName, windowDays, rows: [{revision, resolutions, totalTokens, costUsd, p50LatencyMs}]}
//
// Isso decidiu a forma do monitor. Não há balde a agregar, então não há o problema de "um pico
// infla a média" que a bucketização resolve — e uma política de baldes sobre este agregado seria
// maquinário sem série para operar.

func TestSomaAsResolucoesDeTodasAsRevisoes(t *testing.T) {
	// "Este prompt está sendo usado quanto?" é sobre o PROMPT, não sobre uma revisão dele. Somar é
	// o que responde à pergunta do DoD ("a produção mudou"); escolher uma revisão exigiria uma
	// regra arbitrária sobre QUAL, e erraria justamente durante uma promoção, quando o tráfego
	// está dividido entre duas.
	resp := []byte(`{"promptName":"saudacao","windowDays":7,"rows":[
		{"revision":5,"resolutions":30,"totalTokens":100,"costUsd":null,"p50LatencyMs":12},
		{"revision":6,"resolutions":12,"totalTokens":40,"costUsd":0.1,"p50LatencyMs":9}]}`)

	v, ok := metricFromPromptUsage(resp, "prompt_resolutions")
	if !ok {
		t.Fatal("agregado com linhas tem de ser uma medição válida")
	}
	if v != 42 {
		t.Fatalf("resoluções = %v, quero 42 (30+12)", v)
	}
}

func TestAgregadoVazioEZeroHONESTOENaoAusencia(t *testing.T) {
	// O ponto mais delicado desta fatia, e onde ela DIVERGE de metricFromSeries de propósito.
	//
	// Em `metricFromSeries`, janela sem tráfego devolve (0, false) — foi o theo-cloud#247: `lt`/`lte`
	// são comparadores aceitos, `0 < limiar` é verdadeiro, e um workspace parado disparava alerta
	// falso permanente justamente na regra que serve para detectar que o pipeline PAROU.
	//
	// Aqui a resposta é a oposta, e o motivo é o transporte: `PromptUsage` já separa os dois fatos —
	// falha de leitura sobe como *UpstreamStatusError, nunca como agregado vazio
	// (`internal/thelens/data_client.go`, comentário do método). Então `rows: []` significa
	// literalmente "ninguém resolveu este prompt na janela", que é uma MEDIÇÃO.
	//
	// Se devolvêssemos (0, false) por simetria com o irmão, a regra "avise se este prompt parar de
	// ser usado" — a mais valiosa das duas direções — seria impossível de escrever: ela seria pulada
	// exatamente na condição que existe para detectar.
	resp := []byte(`{"promptName":"saudacao","windowDays":7,"rows":[]}`)

	v, ok := metricFromPromptUsage(resp, "prompt_resolutions")
	if !ok {
		t.Fatal("agregado vazio é zero medido, não ausência — a falha de leitura já sobe como erro " +
			"de transporte, e tratá-lo como ausência torna impossível a regra 'avise se parar'")
	}
	if v != 0 {
		t.Fatalf("valor = %v, quero 0", v)
	}
}

func TestCorpoIlegivelNaoEUmaMedicao(t *testing.T) {
	// O contra-exemplo do teste acima, e o que impede a leitura preguiçosa de "vazio é sempre zero".
	// Um corpo que não parseia não é medição nenhuma — é um contrato quebrado, e devolver (0, true)
	// aqui dispararia toda regra `lt` do workspace com base em lixo.
	for nome, corpo := range map[string][]byte{
		"json quebrado": []byte(`{"rows":[`),
		"vazio":         nil,
		"não é objeto":  []byte(`"saudacao"`),
	} {
		if _, ok := metricFromPromptUsage(corpo, "prompt_resolutions"); ok {
			t.Errorf("%s: corpo ilegível não pode virar medição", nome)
		}
	}
}

func TestMetricaDesconhecidaNaoEUmaMedicao(t *testing.T) {
	// Mesma razão que o `default` de metricFromSeries: um nome de métrica com erro de digitação
	// devolvendo (0, true) faria disparar toda regra `lt` do workspace.
	resp := []byte(`{"promptName":"saudacao","windowDays":7,"rows":[{"revision":1,"resolutions":9,"totalTokens":1,"costUsd":null,"p50LatencyMs":1}]}`)
	if _, ok := metricFromPromptUsage(resp, "prompt_p50_latency_typo"); ok {
		t.Error("métrica desconhecida não pode virar medição")
	}
}

func TestEscopoDePromptEReconhecidoPeloNomeDaMetrica(t *testing.T) {
	// O avaliador precisa decidir QUAL agregado buscar antes de ter os dados. A decisão é pelo nome
	// da métrica, e um `default` errado aqui faria uma regra de prompt consultar o agregado do
	// workspace inteiro — medindo outra coisa e disparando por motivo nenhum.
	if !isPromptScoped("prompt_resolutions") {
		t.Error("prompt_resolutions é escopada a prompt")
	}
	for _, m := range []string{"error_rate", "cost", "p95_latency", "monitor_breach", ""} {
		if isPromptScoped(m) {
			t.Errorf("%q não é escopada a prompt — consultaria o agregado errado", m)
		}
	}
	// E é allow-list, não PREFIXO. Um `HasPrefix(m, "prompt_")` passaria em tudo acima e ainda
	// assim estaria errado: qualquer métrica futura de nome parecido — mas de outra fonte — seria
	// buscada no agregado de prompt em silêncio. Sem esta asserção o comentário da função afirma
	// uma garantia que nenhum teste sustenta, que é como um contrato vira decoração.
	for _, m := range []string{"prompt_", "prompt_p50_latency", "prompt_resolutions_v2"} {
		if isPromptScoped(m) {
			t.Errorf("%q não está na allow-list — reconhecê-la por prefixo consultaria o agregado errado", m)
		}
	}
}
