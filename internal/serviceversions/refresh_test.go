package serviceversions_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/getloopscale/loop-console/internal/serviceversions"
)

// O CORACAO DO loopscale-workspace#37. O estado da frota so virava real quando um humano
// AUTENTICADO abria o painel: `Collect` era disparado exclusivamente pelo handler de
// `/v1/dashboard/status/versions`. Consequencia medida — um container recem-recriado
// servia `/metrics` sem nenhuma serie de version, e o `not_collected` semeado ficava
// ali para sempre. Nenhum programa conseguia responder "qual e o estado da frota
// AGORA", que e exatamente a pergunta que se quer automatizar.
//
// O refresher desacopla a coleta da requisicao. Estes testes fixam o contrato dele.

type coletorEspiao struct {
	mu     sync.Mutex
	chamou int
	ping   chan struct{}
}

func (c *coletorEspiao) Collect(ctx context.Context) serviceversions.Report {
	c.mu.Lock()
	c.chamou++
	c.mu.Unlock()
	select {
	case c.ping <- struct{}{}:
	default:
	}
	return serviceversions.Report{}
}

func (c *coletorEspiao) vezes() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.chamou
}

// espera ate `cond` valer ou o prazo estourar. Sem sleep fixo: um teste que dorme
// reprova codigo correto em maquina carregada, e essa flakiness ja custou tempo
// neste ecossistema.
func esperar(t *testing.T, prazo time.Duration, cond func() bool) bool {
	t.Helper()
	limite := time.Now().Add(prazo)
	for time.Now().Before(limite) {
		if cond() {
			return true
		}
		time.Sleep(time.Millisecond)
	}
	return cond()
}

func TestRefresher_coleta_sem_requisicao_humana(t *testing.T) {
	// Arrange — nenhum handler, nenhum request, nenhum token.
	espiao := &coletorEspiao{ping: make(chan struct{}, 1)}
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()

	// Act
	go serviceversions.Refresh(ctx, espiao, time.Millisecond)

	// Assert — a serie passa a existir por conta propria.
	if !esperar(t, 2*time.Second, func() bool { return espiao.vezes() >= 2 }) {
		t.Fatalf("o refresher nao coletou sozinho: %d chamadas (esperado >= 2)", espiao.vezes())
	}
}

func TestRefresher_coleta_imediatamente_sem_esperar_o_primeiro_intervalo(t *testing.T) {
	// A primeira coleta NAO pode esperar um tick. Com intervalo de 60s, um scrape
	// no primeiro minuto de vida do processo veria `not_collected` em toda a frota
	// e um alerta razoavel dispararia em todo deploy.
	espiao := &coletorEspiao{ping: make(chan struct{}, 1)}
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()

	go serviceversions.Refresh(ctx, espiao, time.Hour) // intervalo que jamais dispara no teste

	if !esperar(t, 2*time.Second, func() bool { return espiao.vezes() >= 1 }) {
		t.Fatal("o refresher esperou o primeiro tick — a frota ficaria not_collected ate la")
	}
}

func TestRefresher_para_quando_o_contexto_e_cancelado(t *testing.T) {
	// Um refresher que sobrevive ao shutdown segura o processo e sonda uma frota
	// que ninguem mais observa.
	espiao := &coletorEspiao{ping: make(chan struct{}, 1)}
	ctx, cancelar := context.WithCancel(context.Background())

	parou := make(chan struct{})
	go func() { serviceversions.Refresh(ctx, espiao, time.Millisecond); close(parou) }()

	<-espiao.ping // garante que ja entrou no laco
	cancelar()

	select {
	case <-parou:
	case <-time.After(2 * time.Second):
		t.Fatal("Refresh nao retornou apos o cancelamento do contexto")
	}
}

func TestRefresher_intervalo_nao_positivo_e_recusado(t *testing.T) {
	// Fail-fast: um intervalo <= 0 faria `time.NewTicker` entrar em panic dentro de
	// uma goroutine de background — o processo morreria com um stack trace que nao
	// menciona configuracao. Recusar e retornar e' honesto e visivel.
	for _, intervalo := range []time.Duration{0, -time.Second} {
		espiao := &coletorEspiao{ping: make(chan struct{}, 1)}
		parou := make(chan struct{})
		go func() { serviceversions.Refresh(context.Background(), espiao, intervalo); close(parou) }()

		select {
		case <-parou:
		case <-time.After(2 * time.Second):
			t.Fatalf("Refresh nao retornou com intervalo %v — deveria recusar em vez de girar", intervalo)
		}
		if espiao.vezes() != 0 {
			t.Fatalf("intervalo %v: coletou %d vez(es) — um intervalo invalido nao deve sondar a frota", intervalo, espiao.vezes())
		}
	}
}
