// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// M149 / usetheoai/theo-cloud#405 — a semântica do acelerador, contra Postgres de verdade.
//
//	AUTH_TEST_DATABASE_URL=postgres://... go test -tags=integration ./internal/auth/...
//
// # Por que este arquivo existe, e não só o teste com sqlmock
//
// O `sqlmock` prova que o comando é EMITIDO e que carrega o predicado. Ele não prova nada sobre o
// que o Postgres FAZ com o comando — e o risco real mora justamente aí: se `make_interval` não
// aceitasse o parâmetro, ou se o predicado estivesse invertido, o `UPDATE` falharia (ou escreveria
// sempre) e o único sinal seria uma linha de log `Debug`. Um acelerador que não acelera em silêncio
// é o mesmo defeito de observabilidade que este milestone corrige, mudado de lugar.
//
// A tabela criada aqui é a MÍNIMA que o comando toca. O objetivo não é reproduzir o schema de
// produção — é exercitar a semântica de uma instrução contra o motor que a executa.

package auth

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func bancoDeTeste(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("AUTH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("AUTH_TEST_DATABASE_URL não definida — pulando")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("abrir banco: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	_, err = db.Exec(`
		DROP TABLE IF EXISTS theo_api_keys;
		CREATE TABLE theo_api_keys (
			id           text PRIMARY KEY,
			last_used_at timestamptz
		)`)
	if err != nil {
		t.Fatalf("criar tabela: %v", err)
	}
	return db
}

/** Executa o mesmo comando de produção, de forma síncrona, para o teste poder observar o efeito. */
func gravarUso(t *testing.T, db *sql.DB, keyID string) int64 {
	t.Helper()
	const q = `UPDATE theo_api_keys
		SET last_used_at = NOW()
		WHERE id = $1
		  AND (last_used_at IS NULL OR last_used_at < NOW() - make_interval(secs => $2))`
	res, err := db.ExecContext(context.Background(), q, keyID, janelaDeRegistroDeUso.Seconds())
	if err != nil {
		t.Fatalf("o UPDATE de produção falhou contra Postgres real: %v", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		t.Fatalf("RowsAffected: %v", err)
	}
	return n
}

func TestIntegracao_OComandoDeRegistroEValidoNoPostgres(t *testing.T) {
	// Se `make_interval(secs => $2)` não fosse aceito, isto falharia — e em produção o erro só
	// apareceria num log `Debug` que ninguém lê.
	db := bancoDeTeste(t)
	if _, err := db.Exec(`INSERT INTO theo_api_keys (id) VALUES ('k1')`); err != nil {
		t.Fatalf("semear: %v", err)
	}
	if n := gravarUso(t, db, "k1"); n != 1 {
		t.Fatalf("a primeira gravação deveria afetar 1 linha, afetou %d", n)
	}
	var usadaEm sql.NullTime
	if err := db.QueryRow(`SELECT last_used_at FROM theo_api_keys WHERE id='k1'`).Scan(&usadaEm); err != nil {
		t.Fatalf("ler: %v", err)
	}
	if !usadaEm.Valid {
		t.Fatal("last_used_at continua NULL depois de uma gravação bem-sucedida")
	}
}

func TestIntegracao_NAutenticacoesNaJanelaProduzemUMAEscrita(t *testing.T) {
	// O critério de gargalo. Sem ele, "acelera" é intenção; com ele, é fato.
	db := bancoDeTeste(t)
	if _, err := db.Exec(`INSERT INTO theo_api_keys (id) VALUES ('k2')`); err != nil {
		t.Fatalf("semear: %v", err)
	}

	escritas := int64(0)
	for i := 0; i < 5; i++ {
		escritas += gravarUso(t, db, "k2")
	}
	if escritas != 1 {
		t.Fatalf("5 autenticações na janela deveriam produzir UMA escrita, produziram %d", escritas)
	}
}

func TestIntegracao_PassadaAJanelaOUsoEGravadoDeNovo(t *testing.T) {
	// O contrapeso do teste acima: um acelerador que nunca mais grava também está errado, e passaria
	// pela asserção anterior. Sem este caso, `WHERE false` seria indistinguível do comportamento certo.
	db := bancoDeTeste(t)
	// Semeia um uso ANTIGO — mais velho que a janela.
	if _, err := db.Exec(
		`INSERT INTO theo_api_keys (id, last_used_at) VALUES ('k3', NOW() - make_interval(secs => $1))`,
		janelaDeRegistroDeUso.Seconds()*2,
	); err != nil {
		t.Fatalf("semear: %v", err)
	}
	if n := gravarUso(t, db, "k3"); n != 1 {
		t.Fatalf("passada a janela, a gravação deveria voltar a acontecer; afetou %d", n)
	}

	var usadaEm time.Time
	if err := db.QueryRow(`SELECT last_used_at FROM theo_api_keys WHERE id='k3'`).Scan(&usadaEm); err != nil {
		t.Fatalf("ler: %v", err)
	}
	if time.Since(usadaEm) > time.Minute {
		t.Fatalf("o carimbo não foi renovado: %v", usadaEm)
	}
}
