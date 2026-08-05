package monitor

import "time"

// TetoDeDuracao — depois disto, um incidente aberto fecha por timeout, mesmo com a condicao valendo.
//
// Um incidente cujo monitor parou de ser avaliado — prompt apagado, revisao arquivada, varredura que
// morreu — fica aberto para sempre e envenena a lista de "incidentes ativos". Datadog, CloudWatch e
// GCP todos tem o equivalente. E barato: um filtro por `started_at` na varredura.
const TetoDeDuracao = 72 * time.Hour

// Razao pela qual um incidente terminou. Nao e decorativa: ela DECIDE a notificacao.
type Razao string

const (
	// RazaoRecuperado — a condicao cessou. Notifica: e a boa noticia que o operador espera.
	RazaoRecuperado Razao = "recuperado"
	// RazaoTimeout — o teto de duracao. Notifica, porque ninguem pediu: o sistema desistiu de medir.
	RazaoTimeout Razao = "timeout"
	// RazaoResolvido — o USUARIO fechou. NAO notifica.
	//
	// Um "resolvido" seguido de um aviso "boa noticia, recuperou!" e exatamente o ruido que ensina o
	// time a ignorar o canal. A pessoa acabou de dizer que sabe.
	RazaoResolvido Razao = "resolvido"
)

// Notifica diz se esta razao deve gerar aviso de recuperacao.
func (r Razao) Notifica() bool { return r != RazaoResolvido }

// Incidente — o registro de que uma condicao se sustentou.
//
// **O estado e derivado de `Fim`**, e nao ha coluna de status a divergir dele: aberto e `Fim == nil`.
// Duas fontes para o mesmo fato divergem no primeiro caminho de escrita que esquecer uma delas.
type Incidente struct {
	ID string
	// MonitorID — a chave pela qual o sistema fecha. O usuario resolve pelo ID do incidente.
	MonitorID string
	Inicio    time.Time
	// Fim nil = ABERTO. E a unica definicao.
	Fim   *time.Time
	Razao Razao
	// LimiarCongelado — o valor avaliado QUANDO O INCIDENTE ABRIU.
	//
	// O lado de fechamento compara contra ele, nunca contra um recomputado. Sem isto, em modo
	// multiplicador as proprias medicoes elevadas do incidente entram na baseline, a baseline sobe,
	// o limiar sobe, e o incidente SE FECHA SOZINHO com o problema ainda em pe. E o item de maior
	// retorno por linha de codigo desta fatia.
	LimiarCongelado float64
}

// Aberto diz se o incidente ainda esta em curso.
func (i *Incidente) Aberto() bool { return i != nil && i.Fim == nil }

// Transicao — o que um tick decidiu fazer.
type Transicao string

const (
	TransicaoNenhuma Transicao = "nenhuma"
	TransicaoAbrir   Transicao = "abrir"
	TransicaoFechar  Transicao = "fechar"
)

// Decisao de um tick.
type Decisao struct {
	Transicao Transicao
	Razao     Razao
	// Limiar a congelar, quando a transicao e abrir.
	Limiar float64
}

// Avaliar decide o que fazer com um monitor, dada a serie medida e o incidente aberto (ou nil).
//
// `serie` vazia significa "nao consegui medir" — e nao abre nem fecha nada. As duas confusoes sao
// caras e opostas: tratar ausencia como violacao acorda alguem sem motivo; trata-la como recuperacao
// declara que o problema passou com base em ausencia de evidencia.
//
// **Um incidente aberto E o dedup.** Enquanto ele existe, o tick devolve `nenhuma` — nao ha
// re-alerta a cada varredura, que e como um alerta legitimo vira ruido.
func Avaliar(serie []float64, limiar float64, aberto *Incidente, agora time.Time) Decisao {
	if aberto.Aberto() {
		// Teto de duracao ANTES da avaliacao: um incidente orfao pode nem ter serie para medir, e e
		// justamente ele que o teto existe para encerrar.
		if agora.Sub(aberto.Inicio) >= TetoDeDuracao {
			return Decisao{Transicao: TransicaoFechar, Razao: RazaoTimeout}
		}
		if ShouldClose(serie, aberto.LimiarCongelado) {
			return Decisao{Transicao: TransicaoFechar, Razao: RazaoRecuperado}
		}
		return Decisao{Transicao: TransicaoNenhuma}
	}

	if ShouldOpen(serie, limiar) {
		return Decisao{Transicao: TransicaoAbrir, Limiar: limiar}
	}
	return Decisao{Transicao: TransicaoNenhuma}
}

// Resolver fecha um incidente por acao do USUARIO.
//
// Idempotente por construcao: um incidente ja fechado devolve `false`, e o chamador nao emite evento
// algum. Sem isso, um duplo-clique gera uma segunda notificacao de um incidente que ja tinha
// terminado — e a segunda e sempre a que faz alguem parar de ler o canal.
func Resolver(i *Incidente, agora time.Time) bool {
	if !i.Aberto() {
		return false
	}
	i.Fim = &agora
	i.Razao = RazaoResolvido
	return true
}

// Fechar encerra um incidente por decisao do SISTEMA. Idempotente pelo mesmo motivo.
func Fechar(i *Incidente, razao Razao, agora time.Time) bool {
	if !i.Aberto() {
		return false
	}
	i.Fim = &agora
	i.Razao = razao
	return true
}
