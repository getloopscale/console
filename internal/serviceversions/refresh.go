package serviceversions

import (
	"context"
	"time"
)

// Collectable e' o que o refresher precisa: colher o estado da frota uma vez.
//
// Declarada AQUI, do lado do consumidor, e satisfeita implicitamente — a mesma
// disciplina que `routes.VersionCollector` ja usa. E' o que permite ao refresher
// receber o coletor DECORADO (`routes.NewSelfReportingCollector`) sem que este
// pacote importe `routes`, o que seria um ciclo. Importa mais do que estilo: o
// decorator e' quem acrescenta a propria linha do gateway, e um refresher ligado
// ao coletor cru publicaria uma frota sem ela.
type Collectable interface {
	Collect(ctx context.Context) Report
}

// Refresh mantem o estado da frota atualizado SEM depender de requisicao.
//
// O PROBLEMA QUE ELE RESOLVE (theo-workspace#37). `Collect` so era disparado pelo
// handler de `/v1/dashboard/status/versions`, que exige Bearer. Consequencia: a
// metrica de frota — servida sem auth em `/metrics`, justamente para ser lida por
// programa — so passava a refletir a realidade depois que um HUMANO AUTENTICADO
// abria o painel, e voltava a `not_collected` a cada restart do container. Toda
// verificacao automatica da frota dependia de alguem clicar.
//
// POR QUE PERIODICO E NAO DISPARADO POR SCRAPE. As duas formas foram consideradas
// (ADR 0010). Coletar dentro do handler de `/metrics` amarra o custo do fan-out ao
// NUMERO DE SCRAPERS: dois Prometheus a 15s dobram a sondagem sobre toda a frota, e
// nada no codigo revela essa multiplicacao. O laco periodico torna o custo funcao de
// UMA constante declarada — o que se le no composition root e' o que a frota sofre.
// Cache com TTL foi descartado por resolver o mesmo com mais partes moveis (chave,
// expiracao, corrida entre scrapers concorrentes) e um modo de falha pior: sob TTL, um
// scrape azarado paga a latencia do fan-out inteiro dentro da propria requisicao.
//
// A publicacao acontece pelo `OnResult` do coletor, nao aqui — este laco nao conhece
// metrica alguma. E' o mesmo caminho que o painel usa, e essa unicidade e' deliberada:
// um segundo caminho de coleta e' como os dois censos divergem.
//
// Bloqueia ate o contexto ser cancelado; feito para rodar em sua propria goroutine.
func Refresh(ctx context.Context, c Collectable, intervalo time.Duration) {
	// FAIL-FAST em vez de panic tardio: `time.NewTicker` entra em panic com intervalo
	// <= 0, e dentro de uma goroutine de background isso derruba o processo com um
	// stack trace que nao menciona configuracao. Retornar deixa a frota em
	// `not_collected` — que e' o estado honesto de "ninguem coletou", exatamente o
	// sentinela semeado no boot.
	if intervalo <= 0 {
		return
	}

	// A PRIMEIRA COLETA NAO ESPERA O TICK. Com um intervalo de minutos, um scrape no
	// inicio da vida do processo veria a frota inteira em `not_collected` e um alerta
	// razoavel dispararia a cada deploy — o alarme falso que ensina a ignorar o alarme.
	c.Collect(ctx)

	t := time.NewTicker(intervalo)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			// O proprio coletor ja impoe seus tetos (PerService/Global) sobre este ctx,
			// entao um alvo pendurado nao empilha coletas: o tick seguinte so chega
			// depois que este retorna.
			c.Collect(ctx)
		}
	}
}
