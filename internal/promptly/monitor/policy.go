// Package monitor implementa a politica de alerta sobre metricas de prompt (M21 DoD-5).
//
// O risco #2 declarado do milestone: "alerta mal calibrado e pior que alerta nenhum. Um limite fixo
// sobre latencia dispara em toda variacao de carga e ensina o time a ignorar." A mitigacao que o
// milestone exige e decidir a politica ANTES de escrever a tela — e e isto aqui.
//
// A politica e PURA: sem banco, sem lens, sem tela. E onde o alerta e calibrado, e o unico lugar
// onde da para testar a calibragem sem um ambiente inteiro.
package monitor

import "time"

// A largura de um balde, e o corte entre as duas.
//
// Baldes existem porque a condicao e avaliada POR BALDE, nunca sobre a media da janela: um pico de
// uma vez so infla um balde e deixa o resto falhando, entao e filtrado. Um alerta de limiar sobre a
// media dispara nesse pico — e e assim que o time aprende a ignorar o canal.
//
// Dois tamanhos, com corte em 15 min, para que a CONTAGEM de baldes fique limitada em janelas
// longas. A pressao e maior aqui que no peer estudado, que roda armazenamento colunar: agregar N
// baldes sobre Postgres custa mais.
const (
	BucketSmall      = time.Minute
	BucketLarge      = 5 * time.Minute
	BucketSizeCutoff = 15 * time.Minute
)

// A fracao de baldes que pode falhar sem impedir a abertura nem forcar o fechamento.
//
// Absorve a variancia de uma violacao sentada perto do limiar. Sem ela, uma violacao real que
// oscila em torno do limite nunca abriria incidente; com ela demais, um problema intermitente
// abriria. 10% e o valor do peer, e o que sustenta o piso abaixo.
const FailTolerance = 0.1

// BucketWidth devolve a largura de balde para uma janela.
func BucketWidth(window time.Duration) time.Duration {
	if window <= BucketSizeCutoff {
		return BucketSmall
	}
	return BucketLarge
}

// MaxFailingBuckets devolve quantos baldes podem falhar numa janela de n baldes.
//
// **O piso de 1 e a decisao mais importante desta funcao.** `floor(0.1 * 5) = 0` tornaria a regra
// ESTRITA exatamente onde a variancia e maior — janelas curtas, que sao as que um prompt tem, porque
// um prompt nao tem volume de trace. Sem o piso, a politica so funcionaria para quem ja tem escala.
//
// Tolerancia zero ou negativa desliga a folga por completo, e isso e deliberado: quem pede regra
// estrita a recebe.
func MaxFailingBuckets(n int, tolerance float64) int {
	if tolerance <= 0 {
		return 0
	}
	if v := int(float64(n) * tolerance); v > 0 {
		return v
	}
	return 1
}

// CountFailingBuckets conta quantos baldes NAO satisfazem o limiar.
//
// **Um balde vazio SEMPRE falha**, mesmo quando o proprio limiar e zero. A razao e o que a
// contagem significa: um buraco na serie quer dizer que a violacao nao foi SUSTENTADA, e sustentada
// e exatamente a propriedade que separa um incidente de um pico. E a guarda contra o caso em que a
// baseline e zero e todo balde "satisfaz" um limiar de zero por vacuidade.
func CountFailingBuckets(counts []float64, threshold float64) int {
	failing := 0
	for _, c := range counts {
		if c <= 0 || c < threshold {
			failing++
		}
	}
	return failing
}

// ShouldOpen decide se uma serie bucketizada sustenta a abertura de um incidente.
//
// Serie vazia NUNCA abre: sem balde algum, nao ha violacao sustentada a afirmar — e abrir aqui
// transformaria "nao medi nada" em "esta ruim", que e a confusao mais cara deste dominio.
func ShouldOpen(counts []float64, threshold float64) bool {
	if len(counts) == 0 {
		return false
	}
	return CountFailingBuckets(counts, threshold) <= MaxFailingBuckets(len(counts), FailTolerance)
}

// ShouldClose decide se um incidente aberto deve fechar.
//
// Simetrica a ShouldOpen de proposito: a MESMA contagem decide os dois lados. Uma regra para abrir e
// outra para fechar produz a faixa em que o incidente nem abre nem fecha, e e nessa faixa que os
// alertas piscam.
//
// O `threshold` que chega aqui e o CONGELADO na abertura — ver o incidente. Recomputa-lo faria as
// proprias medicoes elevadas do incidente arrastarem a baseline, o limiar subir, e o incidente se
// fechar sozinho com o problema ainda em pe.
func ShouldClose(counts []float64, frozenThreshold float64) bool {
	if len(counts) == 0 {
		// Sem dado, nao se fecha: "nao consegui medir" nao e "a condicao cessou". Fechar aqui
		// declararia recuperacao com base em ausencia de evidencia.
		return false
	}
	return CountFailingBuckets(counts, frozenThreshold) > MaxFailingBuckets(len(counts), FailTolerance)
}
