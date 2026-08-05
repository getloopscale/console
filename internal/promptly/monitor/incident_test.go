package monitor

import (
	"testing"
	"time"
)

// M21 DoD-5 — a maquina de estados do incidente.
//
// "Um alerta que dispara e nao pode ser fechado vira ruido que se aprende a ignorar." Metade destes
// testes e sobre o FIM do incidente, e nao sobre o comeco.

var agora = time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)

func sustentada() []float64 { return []float64{20, 20, 20, 20, 20, 20, 20, 20, 20, 20} }
func recuperada() []float64 { return []float64{1, 1, 1, 1, 1, 1, 1, 1, 1, 1} }

func TestCondicaoSustentadaAbreUmIncidente(t *testing.T) {
	d := Avaliar(sustentada(), 10, nil, agora)
	if d.Transicao != TransicaoAbrir {
		t.Fatalf("transicao = %q, quero abrir", d.Transicao)
	}
	// O limiar a congelar viaja na decisao: quem grava nao recomputa.
	if d.Limiar != 10 {
		t.Fatalf("limiar a congelar = %v, quero 10", d.Limiar)
	}
}

func TestIncidenteAbertoSuprimeNovaAbertura(t *testing.T) {
	// O incidente aberto E o dedup. Sem isto, cada varredura reabriria — e um alerta legitimo vira
	// ruido pela repeticao, nao pelo conteudo.
	aberto := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-time.Hour), LimiarCongelado: 10}
	d := Avaliar(sustentada(), 10, aberto, agora)
	if d.Transicao != TransicaoNenhuma {
		t.Fatalf("com incidente aberto a transicao tem de ser nenhuma, foi %q", d.Transicao)
	}
}

func TestFecharComparaContraOLimiarCongeladoENaoORecomputado(t *testing.T) {
	// O teste que protege o item de maior retorno da fatia.
	//
	// Cenario: o incidente abriu com limiar 10. Enquanto ele corre, a baseline SOBE — porque as
	// proprias medicoes elevadas do incidente entram nela — e o limiar recomputado viraria 25. A
	// serie continua em 20: acima do congelado (o problema segue), abaixo do recomputado.
	//
	// Com o congelado: nao fecha, corretamente. Com o recomputado: fecharia sozinho, com o problema
	// em pe e ninguem olhando.
	aberto := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-time.Hour), LimiarCongelado: 10}
	serie := sustentada() // tudo em 20

	if d := Avaliar(serie, 25 /* limiar recomputado, mais alto */, aberto, agora); d.Transicao != TransicaoNenhuma {
		t.Fatalf("o fechamento usou o limiar recomputado — o incidente se fecharia sozinho; transicao=%q", d.Transicao)
	}

	// E o CONTROLE: quando a condicao de fato cessa, ele fecha.
	if d := Avaliar(recuperada(), 25, aberto, agora); d.Transicao != TransicaoFechar {
		t.Fatalf("serie recuperada deve fechar, transicao=%q", d.Transicao)
	}
}

func TestTetoDeDuracaoFechaIncidenteOrfao(t *testing.T) {
	// Um incidente cujo monitor parou de ser avaliado fica aberto para sempre e envenena a lista de
	// ativos. O teto fecha mesmo SEM serie — que e o estado de um orfao de verdade.
	orfao := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-73 * time.Hour), LimiarCongelado: 10}
	d := Avaliar(nil, 10, orfao, agora)
	if d.Transicao != TransicaoFechar || d.Razao != RazaoTimeout {
		t.Fatalf("orfao deve fechar por timeout; transicao=%q razao=%q", d.Transicao, d.Razao)
	}
}

func TestDentroDoTetoUmIncidenteSemSerieNaoFecha(t *testing.T) {
	// O CONTROLE do teste acima, e a distincao que mais importa neste dominio: "nao consegui medir"
	// nao e "a condicao cessou". Fechar aqui declararia recuperacao por ausencia de evidencia.
	aberto := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-time.Hour), LimiarCongelado: 10}
	if d := Avaliar(nil, 10, aberto, agora); d.Transicao != TransicaoNenhuma {
		t.Fatalf("sem serie e dentro do teto, nada muda; transicao=%q", d.Transicao)
	}
}

func TestResolverDoUsuarioSuprimeANotificacaoDeRecuperacao(t *testing.T) {
	// A distincao que decide o ruido. Um "resolvido" seguido de "boa noticia, recuperou!" e o aviso
	// que ensina o time a ignorar o canal — a pessoa acabou de dizer que sabe.
	i := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-time.Hour), LimiarCongelado: 10}
	if !Resolver(i, agora) {
		t.Fatal("resolver um incidente aberto deve ter efeito")
	}
	if i.Aberto() {
		t.Fatal("resolvido continua aberto")
	}
	if i.Razao.Notifica() {
		t.Fatalf("razao %q nao pode notificar recuperacao", i.Razao)
	}
}

func TestFecharDoSistemaNotificaARecuperacao(t *testing.T) {
	// O outro lado: recuperacao organica E a boa noticia que o operador espera.
	i := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-time.Hour), LimiarCongelado: 10}
	if !Fechar(i, RazaoRecuperado, agora) {
		t.Fatal("fechar um incidente aberto deve ter efeito")
	}
	if !i.Razao.Notifica() {
		t.Fatalf("razao %q deve notificar", i.Razao)
	}
	// E o timeout tambem notifica: ninguem pediu, o sistema desistiu de medir.
	j := &Incidente{ID: "i2", MonitorID: "m1", Inicio: agora.Add(-80 * time.Hour), LimiarCongelado: 10}
	Fechar(j, RazaoTimeout, agora)
	if !j.Razao.Notifica() {
		t.Error("timeout deve notificar")
	}
}

func TestResolverEFecharSaoIDEMPOTENTES(t *testing.T) {
	// Sem isto, um duplo-clique gera uma SEGUNDA notificacao de um incidente que ja terminou — e a
	// segunda e sempre a que faz alguem parar de ler o canal.
	i := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora.Add(-time.Hour), LimiarCongelado: 10}
	Resolver(i, agora)
	if Resolver(i, agora.Add(time.Minute)) {
		t.Error("resolver duas vezes tem de ser no-op na segunda")
	}
	if Fechar(i, RazaoRecuperado, agora.Add(time.Minute)) {
		t.Error("fechar um incidente ja resolvido tem de ser no-op")
	}
	// E a razao NAO foi sobrescrita: quem resolveu foi o usuario, e o registro tem de dizer isso.
	if i.Razao != RazaoResolvido {
		t.Fatalf("a razao virou %q — o registro perdeu quem fechou", i.Razao)
	}
}

func TestOEstadoEDerivadoDeFimENaoDeUmaColunaDeStatus(t *testing.T) {
	// Duas fontes para o mesmo fato divergem no primeiro caminho de escrita que esquecer uma delas.
	i := &Incidente{ID: "i1", MonitorID: "m1", Inicio: agora}
	if !i.Aberto() {
		t.Fatal("sem Fim, o incidente esta aberto")
	}
	fim := agora.Add(time.Hour)
	i.Fim = &fim
	if i.Aberto() {
		t.Fatal("com Fim, o incidente esta fechado")
	}
	// E um ponteiro nil e "nao ha incidente", que tambem nao esta aberto.
	var nenhum *Incidente
	if nenhum.Aberto() {
		t.Fatal("incidente nil nao pode estar aberto")
	}
}
