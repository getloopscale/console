package monitor

import (
	"testing"
	"time"
)

// M21 DoD-5 — a politica de alerta, testada sem banco, sem lens e sem tela.
//
// O risco #2 do milestone: "alerta mal calibrado e pior que alerta nenhum". Os testes aqui sao a
// calibragem, e cada um deles corresponde a uma forma concreta de o alerta virar ruido.

func TestPicoDeUmBaldeNaoAbreIncidente(t *testing.T) {
	// O caso que motiva o bucketing inteiro. Um alerta de limiar sobre a MEDIA da janela dispararia
	// aqui: a media dos seis baldes passa do limiar por causa do pico. A avaliacao por balde nao —
	// cinco dos seis baldes ficam abaixo, e cinco falhas com tolerancia 1 nao abrem nada.
	counts := []float64{1, 1, 1, 90, 1, 1}
	if ShouldOpen(counts, 10) {
		t.Fatalf("um pico de um balde nao pode abrir incidente; falhando=%d de %d, teto=%d",
			CountFailingBuckets(counts, 10), len(counts), MaxFailingBuckets(len(counts), FailTolerance))
	}
}

func TestViolacaoSustentadaAbreMesmoComUmBaldeAbaixo(t *testing.T) {
	// O CONTROLE do teste acima. Sem ele, uma politica que nunca abrisse passaria — e um alerta que
	// nao dispara e indistinguivel de alerta nenhum.
	//
	// A tolerancia existe para este caso: uma violacao real sentada perto do limiar oscila, e um
	// balde abaixo nao pode impedir a abertura.
	counts := []float64{20, 20, 20, 9, 20, 20, 20, 20, 20, 20}
	if !ShouldOpen(counts, 10) {
		t.Fatalf("violacao sustentada com um balde abaixo deve abrir; falhando=%d, teto=%d",
			CountFailingBuckets(counts, 10), MaxFailingBuckets(len(counts), FailTolerance))
	}
}

func TestBaldeVazioSempreFalhaMesmoComLimiarZero(t *testing.T) {
	// A guarda contra a vacuidade. Com limiar 0, todo balde "satisfaz" a condicao — inclusive os
	// buracos —, e a serie inteira pareceria uma violacao sustentada. Um buraco significa que a
	// violacao NAO foi sustentada, e sustentada e a propriedade que separa incidente de pico.
	if got := CountFailingBuckets([]float64{0, 0, 0}, 0); got != 3 {
		t.Fatalf("balde vazio tem de falhar mesmo com limiar zero: falhando=%d, quero 3", got)
	}
}

func TestToleranciaTemPisoDeUmBaldeEmJanelaCurta(t *testing.T) {
	// A decisao mais importante da politica. `floor(0.1 * 5) = 0` tornaria a regra ESTRITA
	// exatamente onde a variancia e maior — janelas curtas, que sao as que um prompt tem, porque um
	// prompt nao tem volume de trace. Sem o piso, a politica so funcionaria para quem ja tem escala.
	casos := []struct {
		n    int
		quer int
	}{
		{5, 1}, {10, 1}, {12, 1}, {24, 2}, {50, 5},
	}
	for _, c := range casos {
		if got := MaxFailingBuckets(c.n, FailTolerance); got != c.quer {
			t.Errorf("MaxFailingBuckets(%d) = %d, quero %d", c.n, got, c.quer)
		}
	}
}

func TestToleranciaZeroDesligaAFolga(t *testing.T) {
	// Quem pede regra estrita a recebe — e o zero e o unico jeito de pedi-la.
	if got := MaxFailingBuckets(50, 0); got != 0 {
		t.Fatalf("tolerancia zero tem de dar teto zero, deu %d", got)
	}
}

func TestLarguraDeBaldeMudaNoCorteDeQuinzeMinutos(t *testing.T) {
	// Dois tamanhos para limitar a CONTAGEM de baldes em janelas longas. A pressao e maior aqui que
	// no peer, que roda armazenamento colunar: agregar N baldes sobre Postgres custa mais.
	if got := BucketWidth(15 * time.Minute); got != BucketSmall {
		t.Errorf("janela de 15min deve usar balde pequeno, usou %v", got)
	}
	if got := BucketWidth(16 * time.Minute); got != BucketLarge {
		t.Errorf("janela acima do corte deve usar balde grande, usou %v", got)
	}
}

func TestSerieVaziaNaoAbreNemFecha(t *testing.T) {
	// "Nao consegui medir" nao e "esta ruim", e tampouco "a condicao cessou". As duas confusoes sao
	// caras e opostas: a primeira acorda alguem sem motivo; a segunda declara recuperacao com base
	// em ausencia de evidencia, e o problema segue em pe sem ninguem olhando.
	if ShouldOpen(nil, 10) {
		t.Error("serie vazia nao pode abrir incidente")
	}
	if ShouldClose(nil, 10) {
		t.Error("serie vazia nao pode fechar incidente")
	}
}

func TestAbrirEFecharUsamAMesmaContagem(t *testing.T) {
	// Simetria deliberada: uma regra para abrir e outra para fechar produz a faixa em que o
	// incidente nem abre nem fecha — e e nessa faixa que os alertas piscam.
	//
	// A serie abaixo abre (uma falha, teto 1). A mesma serie, contra o mesmo limiar, nao fecha.
	counts := []float64{20, 20, 20, 9, 20, 20, 20, 20, 20, 20}
	if !ShouldOpen(counts, 10) {
		t.Fatal("pre-condicao: esta serie deveria abrir")
	}
	if ShouldClose(counts, 10) {
		t.Fatal("a mesma serie que abre nao pode fechar — e a faixa onde os alertas piscam")
	}
}

func TestRecuperacaoFechaOIncidente(t *testing.T) {
	// O outro lado, e o que impede um incidente eterno: quando a condicao cessa de verdade, ele
	// fecha. Sem este teste, uma politica que nunca fechasse passaria em todos os anteriores.
	recuperada := []float64{1, 1, 1, 1, 1, 1, 1, 1, 1, 1}
	if !ShouldClose(recuperada, 10) {
		t.Fatalf("serie recuperada deve fechar; falhando=%d de %d, teto=%d",
			CountFailingBuckets(recuperada, 10), len(recuperada),
			MaxFailingBuckets(len(recuperada), FailTolerance))
	}
}
