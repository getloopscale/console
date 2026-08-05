// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jackc/pgx/v5/pgconn"
)

// Defasagem entre schema e código, no único ponto onde ela é fatal.
//
// A coluna `prompt_name` nasce na migração 000060 do engine; a consulta que a lê nasce nesta
// imagem do theo-cloud. **Nada no sistema ordena os dois deploys** — o engine migra por um
// pipeline, o theo-cloud publica em `develop` por outro. Se a imagem chegar primeiro, o SELECT
// falha com 42703 e o Tick devolve erro ANTES de avaliar qualquer linha: todas as regras de alerta
// do parque param, inclusive as que não têm relação alguma com prompt.
//
// Uma falha assim é indistinguível de "está tudo calmo" para quem olha a tela: as regras seguem
// `enabled`, o status segue `OK`, e ninguém é avisado de nada. Depender de o operador acertar a
// ordem é frágil demais para um modo de falha desse tamanho.

func erroDeColunaAusente() error {
	return &pgconn.PgError{Code: "42703", Message: `column "prompt_name" does not exist`}
}

func linhaLegada() *sqlmock.Rows {
	// A projeção de ANTES da 000060 — onze colunas, sem prompt_name.
	return sqlmock.NewRows([]string{
		"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds", "webhook_id",
		"status", "last_triggered_at", "renotify_interval_seconds", "monitor_id",
	}).AddRow("lar-1", "tn-1", "error_rate", "gt", 5.0, 3600, "wwh-1", "OK", nil, nil, nil)
}

func TestSemAColunaNovaAsRegrasDeWorkspaceContinuamSendoAvaliadas(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	e := New(db, func(context.Context, string, int) (json.RawMessage, error) {
		return json.RawMessage(breachedSeries), nil
	}, nil, nil, nil)

	// A consulta com a coluna nova falha; a defasagem NÃO pode derrubar o resto.
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnError(erroDeColunaAusente())
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(linhaLegada())
	// E a regra de workspace segue seu curso normal: 20% > 5 ⇒ dispara.
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO workspace_webhook_deliveries").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO lens_fired_alerts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := e.Tick(context.Background()); err != nil {
		t.Fatalf("a ausência da coluna nova não pode abortar o Tick: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("as regras de workspace não foram avaliadas na defasagem: %v", err)
	}
}

func TestQualquerOutroErroDeConsultaNaoERetentado(t *testing.T) {
	// O contra-exemplo, e o motivo de a detecção ser por SQLSTATE e não por texto. Uma falha de
	// conexão retentada com a projeção legada dobraria a consulta a cada tick contra um banco que
	// já está mal — e, pior, esconderia o erro real atrás de um segundo, diferente.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	e := New(db, nil, nil, nil, nil)
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnError(errors.New("conexão recusada"))

	if err := e.Tick(context.Background()); err == nil {
		t.Fatal("um erro que não é coluna-ausente tem de subir")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("houve uma segunda consulta que não deveria existir: %v", err)
	}
}

func TestOutroSQLSTATENaoDisparaOCaminhoDeDefasagem(t *testing.T) {
	// 42P01 é "tabela não existe" — também é erro de schema, e também NÃO é a defasagem que esta
	// defesa cobre. Retentar com a projeção legada falharia igual, escondendo a causa real.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	e := New(db, nil, nil, nil, nil)
	mock.ExpectQuery("SELECT id, tenant_id, metric").
		WillReturnError(&pgconn.PgError{Code: "42P01", Message: `relation "lens_alert_rules" does not exist`})

	if err := e.Tick(context.Background()); err == nil {
		t.Fatal("42P01 não é a defasagem de coluna — tem de subir")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("houve uma segunda consulta que não deveria existir: %v", err)
	}
}
