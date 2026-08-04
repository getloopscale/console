// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package auth

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

// janelaDeRegistroDeUso — granularidade de `last_used_at`. A coluna responde "esta chave está
// viva?", não "em que instante exato cada requisição chegou": um minuto é fino o bastante para a
// primeira pergunta e grosso o bastante para não escrever por requisição.
const janelaDeRegistroDeUso = time.Minute

// orcamentoDaEscritaDeUso — teto de tempo da escrita assíncrona. Independente do contexto da
// requisição, que morre quando a resposta termina.
const orcamentoDaEscritaDeUso = 3 * time.Second

// registrarUsoDaChave marca `last_used_at` da chave, fora do caminho de resposta.
//
// # Por que existe (usetheoai/theo-cloud#405)
//
// Havia DOIS caminhos de autenticação e só um gravava. `RequireScope` (rotas Bearer do próprio
// theo-cloud) atualizava a coluna; `ResolveAPIKey` — sobre a qual o ForwardAuth da borda é montado,
// e por onde passa todo produto Model-B — não. Toda chave entregue a um agente marcava `Never` para
// sempre, e a tela que existe para responder *quais credenciais estão vivas* respondia o oposto.
//
// A função é chamada de `lookupAPIKey`, o tronco que os DOIS caminhos atravessam, de propósito: um
// terceiro caminho futuro herda o registro por construção, em vez de nascer cego — que é exatamente
// como este defeito nasceu.
//
// # Por que o acelerador é o BANCO
//
// O predicado de janela vai no próprio `UPDATE`. As alternativas foram medidas e recusadas:
//
//   - um limitador em memória compartilhado precisa viver fora da chamada para acelerar, o que exige
//     estado global mutável (que `architecture.md` § 6 flagra) ou 58 edições para injetá-lo — e
//     aceleraria por RÉPLICA, escrevendo N vezes com N réplicas;
//   - não acelerar significaria uma escrita de linha por requisição no caminho de INGESTÃO, o de
//     maior volume do produto: WAL, índice e autovacuum por lote OTLP.
//
// Com o predicado não há estado compartilhado, mutex, global nem vazamento entre testes, e o
// comportamento é correto com qualquer número de réplicas. O comando ainda faz round-trip; o que ele
// evita é a escrita de linha. Isso é aceitável porque a autenticação acontece uma vez por REQUISIÇÃO
// e um lote OTLP carrega muitos spans numa só.
//
// # Por que fire-and-forget
//
// A borda autentica todo o tráfego de data-plane. Uma escrita lenta ou um banco indisponível não
// podem derrubar a autenticação — trocar um defeito de observabilidade por um de disponibilidade
// seria um negócio pior que o defeito original.
func registrarUsoDaChave(db *sql.DB, keyID string) {
	if db == nil || keyID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), orcamentoDaEscritaDeUso)
		defer cancel()
		// `make_interval(secs => $2)` e não `$2::interval`: a forma textual de uma `time.Duration` é
		// `"1m0s"`, que o Postgres não parseia como intervalo. O erro cairia no log `Debug` e o
		// registro deixaria de funcionar EM SILÊNCIO — a mesma classe de defeito que este arquivo
		// existe para corrigir. `make_interval` recebe um número e não depende de parsing textual.
		const q = `UPDATE theo_api_keys
			SET last_used_at = NOW()
			WHERE id = $1
			  AND (last_used_at IS NULL OR last_used_at < NOW() - make_interval(secs => $2))`
		if _, err := db.ExecContext(ctx, q, keyID, janelaDeRegistroDeUso.Seconds()); err != nil {
			slog.Debug("registro de uso da chave falhou", "error", err, "key_id", keyID)
		}
	}()
}
