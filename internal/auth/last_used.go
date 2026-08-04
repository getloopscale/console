// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package auth

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// janelaDeRegistroDeUso — granularidade de `last_used_at`. A coluna responde "esta chave está
// viva?", não "em que instante exato cada requisição chegou": um minuto é fino o bastante para a
// primeira pergunta e grosso o bastante para não escrever uma linha por requisição.
const janelaDeRegistroDeUso = time.Minute

// orcamentoDaEscritaDeUso — teto de tempo de UMA escrita, incluindo a espera na fila do pool.
//
// Era 3 s na primeira versão, herdado do middleware. Uma revisão MEDIU o efeito disso: com o pool de
// 10 conexões saturado, uma escrita com licença de esperar 3 s na fila empurra o SELECT de
// autenticação — que é síncrono e está no caminho de resposta — para trás dela. `database/sql`
// enfileira em FIFO, sem prioridade para quem está servindo a requisição. 250 ms mantém a escrita
// best-effort de fato: se não couber rápido, desiste.
const orcamentoDaEscritaDeUso = 250 * time.Millisecond

// Capacidade da fila e número de escritores. O ponto NÃO é vazão — é teto.
//
// `escritoresDeUso = 2` limita a **duas** as conexões que o registro pode tomar do pool de 10; o
// resto fica para a autenticação. `capacidadeDaFila` absorve rajadas curtas; cheia, o pedido é
// DESCARTADO, que é a semântica best-effort que esta coluna já assume.
const (
	escritoresDeUso  = 2
	capacidadeDaFila = 256
)

type pedidoDeRegistro struct {
	db    *sql.DB
	keyID string
}

var (
	filaDeRegistro    chan pedidoDeRegistro
	iniciarEscritores sync.Once

	// Deduplicação por chave, ANTES da fila.
	//
	// Sem ela, TODA autenticação enfileira — mesmo sabendo que ≥99 % vai casar zero linhas dentro da
	// janela. Uma revisão mediu a consequência: com o banco degradado a fila drena a ~8 escritas/s,
	// enche em ~2,8 s sob 100 auth/s, e a partir daí o descarte é **enviesado**. A chave quente
	// (ingestão OTLP) inunda os 256 slots; a chave fria, que autentica uma vez por hora, tem seu
	// único pedido descartado — e a chave fria é precisamente a população do #405, a que alguém
	// olharia para decidir revogar.
	//
	// O argumento original contra estado em memória ("exige global mutável") já não se aplica: a
	// fila introduziu exatamente isso. E o predicado no banco continua sendo a fonte de verdade —
	// este mapa só poupa round-trips redundantes, nunca causa uma escrita perdida além do que a
	// janela já permite.
	muUltimoEnfileiramento sync.Mutex
	ultimoEnfileiramento   = map[string]time.Time{}
	// Descartes observáveis: sem contador, a fila cheia é indistinguível de "nunca ninguém usou a
	// chave" — que é literalmente o defeito (#405) que este arquivo corrige, de volta por outra porta.
	registrosDescartados atomic.Int64
	registrosComFalha    atomic.Int64
)

// registrarUsoDaChave enfileira a marcação de `last_used_at`, fora do caminho de resposta.
//
// # Por que existe (usetheoai/theo-cloud#405)
//
// Havia DOIS caminhos de autenticação e só um gravava. `RequireScope` (rotas Bearer do próprio
// theo-cloud) atualizava a coluna; `ResolveAPIKey` — sobre a qual o ForwardAuth da borda é montado,
// e por onde passa todo produto Model-B — não. Toda chave entregue a um agente marcava `Never` para
// sempre, e a tela que existe para responder *quais credenciais estão vivas* respondia o oposto.
//
// A chamada mora em `lookupAPIKey`, o tronco que os DOIS caminhos atravessam, de propósito: um
// terceiro caminho futuro herda o registro por construção, em vez de nascer cego — que é exatamente
// como este defeito nasceu.
//
// # O que "usada" passa a significar
//
// `lookupAPIKey` roda ANTES da checagem de escopo. Logo o carimbo diz **"apresentada e
// autenticada"**, não "autorizada": uma chave válida barrada por falta de escopo (403) conta como
// usada. É deliberado — a pergunta operacional é *"esta credencial está em circulação?"*, e uma
// chave que alguém está tentando usar está em circulação. Para revogação, é a resposta certa;
// para auditoria de autorização, não é esta coluna que se lê.
//
// # Por que uma FILA com escritores fixos, e não uma goroutine por requisição
//
// A primeira versão disparava `go func()` por autenticação, com o comentário de que fire-and-forget
// protegia a disponibilidade. Uma revisão **falsificou isso por medição**: o UPDATE assíncrono sai do
// MESMO pool de 10 conexões que o SELECT de autenticação, e `database/sql` enfileira sem prioridade
// para o caminho síncrono. Com 200 autenticações concorrentes e o banco saudável, o p50 da auth ia
// de 44,6 ms para 181 ms — **4,1×**. Com o banco lento, 21×. Ou seja: no cenário que o comentário
// dizia prevenir, o desenho AMPLIFICAVA em vez de isolar.
//
// A fila conserta as três coisas de uma vez: teto de conexões tomadas do pool (`escritoresDeUso`),
// teto de goroutines (fixo, não 1:1 com o tráfego) e descarte explícito sob rajada, em vez de
// acúmulo. O acelerador de janela continua no banco — ele poupa a escrita de linha; a fila é o que
// poupa o POOL, e são problemas diferentes.
func registrarUsoDaChave(db *sql.DB, keyID string) {
	if db == nil || keyID == "" {
		return
	}
	if recemEnfileirada(keyID) {
		return
	}
	iniciarEscritores.Do(func() {
		filaDeRegistro = make(chan pedidoDeRegistro, capacidadeDaFila)
		for i := 0; i < escritoresDeUso; i++ {
			go escreverRegistros(filaDeRegistro)
		}
	})
	select {
	case filaDeRegistro <- pedidoDeRegistro{db: db, keyID: keyID}:
	default:
		// Fila cheia: desiste. A coluna é best-effort e a alternativa — bloquear — seria pagar com o
		// caminho de resposta exatamente o que esta fila existe para proteger.
		if n := registrosDescartados.Add(1); n == 1 || n%1000 == 0 {
			slog.Warn("registro de uso descartado: fila cheia", "descartes_totais", n)
		}
	}
}

// recemEnfileirada reporta se esta chave já foi enfileirada dentro da janela — e, quando não,
// registra o instante. O mapa é limpo por inteiro ao passar do teto: um mapa por chave cresceria
// sem limite num ambiente com muitas chaves, e o custo de limpar é, no pior caso, algumas escritas
// redundantes a mais — que o predicado do banco absorve.
const tetoDoMapaDeDedup = 10_000

func recemEnfileirada(keyID string) bool {
	agora := time.Now()
	muUltimoEnfileiramento.Lock()
	defer muUltimoEnfileiramento.Unlock()
	if quando, ok := ultimoEnfileiramento[keyID]; ok && agora.Sub(quando) < janelaDeRegistroDeUso {
		return true
	}
	if len(ultimoEnfileiramento) >= tetoDoMapaDeDedup {
		ultimoEnfileiramento = map[string]time.Time{}
	}
	ultimoEnfileiramento[keyID] = agora
	return false
}

func escreverRegistros(fila <-chan pedidoDeRegistro) {
	// `make_interval(secs => $2)` e não `$2::interval`: a forma textual de uma `time.Duration` é
	// `"1m0s"`, que o Postgres não parseia como intervalo. O erro cairia no log e o registro deixaria
	// de funcionar — a mesma classe de defeito que este arquivo corrige. `make_interval` recebe um
	// número e não depende de parsing textual.
	//
	// O predicado é o acelerador: dentro da janela o UPDATE casa zero linhas e não escreve. Ele
	// depende de `READ COMMITTED` (o default do servidor) para que duas escritas concorrentes da
	// mesma chave não virem duas linhas gravadas; sob `REPEATABLE READ` a segunda erraria com falha
	// de serialização — que o log abaixo torna visível em vez de engolir.
	const q = `UPDATE theo_api_keys
		SET last_used_at = NOW()
		WHERE id = $1
		  AND (last_used_at IS NULL OR last_used_at < NOW() - make_interval(secs => $2))`
	for p := range fila {
		ctx, cancel := context.WithTimeout(context.Background(), orcamentoDaEscritaDeUso)
		_, err := p.db.ExecContext(ctx, q, p.keyID, janelaDeRegistroDeUso.Seconds())
		cancel()
		if err != nil {
			// `Warn`, não `Debug`. O commit anterior argumentava contra falhas silenciosas e então
			// logava em `Debug` — invisível no nível de produção. Sem sinal, um segundo #405 nasce
			// igual ao primeiro. Amostrado para não virar ruído quando o banco cai.
			if n := registrosComFalha.Add(1); n == 1 || n%100 == 0 {
				slog.Warn("registro de uso da chave falhou", "error", err, "key_id", p.keyID, "falhas_totais", n)
			}
		}
	}
}
