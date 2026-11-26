// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package lens_alert_evaluator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// loopprompt M21 DoD-5 — a regra escopada a prompt dentro do avaliador que já existe.
//
// Segue o precedente do M135 (`processGuardRule`): quando o agregado do workspace não sabe
// responder a pergunta, entra um FETCHER novo — não um case novo de métrica sobre a série errada.

const usoDePrompt = `{"promptName":"saudacao","windowDays":7,"rows":[{"revision":6,"resolutions":42,"totalTokens":10,"costUsd":null,"p50LatencyMs":9}]}`

// linhaDeRegraDePrompt monta o resultado do SELECT do Tick para uma regra escopada a prompt.
func linhaDeRegraDePrompt(comparator string, limiar float64) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds", "webhook_id",
		"status", "last_triggered_at", "renotify_interval_seconds", "monitor_id", "prompt_name",
	}).AddRow("lar-p1", "t1", MetricPromptResolutions, comparator, limiar, 3600, "wh-1",
		"OK", nil, nil, nil, "saudacao")
}

func TestRegraDePromptConsultaOAgregadoDePromptENaoASerieDoWorkspace(t *testing.T) {
	// O defeito que este teste existe para impedir é o mais caro do avaliador: medir OUTRA COISA.
	// A série do workspace devolve um float por janela e não sabe dizer nada sobre um prompt; se a
	// regra caísse nela, o alerta dispararia (ou não) por um número que não tem relação com o
	// prompt que o cliente escolheu — e a tela mostraria o nome do prompt ao lado dele.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	serieChamada := false
	fetchSerie := func(context.Context, string, int) (json.RawMessage, error) {
		serieChamada = true
		return json.RawMessage(breachedSeries), nil
	}

	var promptPedido, tenantPedido string
	fetchPrompt := func(_ context.Context, tenantID, promptName string, _ int) (json.RawMessage, error) {
		tenantPedido, promptPedido = tenantID, promptName
		return json.RawMessage(usoDePrompt), nil
	}

	e := New(db, fetchSerie, nil, fetchPrompt, nil)

	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(linhaDeRegraDePrompt("gt", 10))
	// 42 > 10 ⇒ dispara, e o disparo percorre o MESMO caminho atômico das outras métricas.
	// O disparo roda em UMA transação (M84): o flip, a entrega e a linha de histórico commitam
	// juntos ou nenhum deles — é o que garante um aviso por violação, e um registro por aviso.
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO workspace_webhook_deliveries").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO lens_fired_alerts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := e.Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}

	if serieChamada {
		t.Error("a regra de prompt consultou a série do WORKSPACE — mediria outra coisa e " +
			"dispararia por um número sem relação com o prompt escolhido")
	}
	if promptPedido != "saudacao" {
		t.Errorf("prompt consultado = %q, quero \"saudacao\" — o nome vem da regra, nunca de um default", promptPedido)
	}
	if tenantPedido != "t1" {
		t.Errorf("tenant = %q, quero \"t1\" — o agregado tem de ser lido no tenant DONO da regra", tenantPedido)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("o disparo não percorreu o caminho atômico existente: %v", err)
	}
}

func TestFalhaDeLeituraDoAgregadoDePromptNaoDisparaNemCongelaOutrasRegras(t *testing.T) {
	// Fail-closed, como o caminho por guard: leitura que falhou é AUSÊNCIA, nunca zero. Um zero
	// fabricado aqui dispararia toda regra `lt` — que é justamente a regra "avise se este prompt
	// parar de ser usado", a mais valiosa das duas direções.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	fetchPrompt := func(context.Context, string, string, int) (json.RawMessage, error) {
		return nil, errors.New("looptrace fora do ar")
	}
	e := New(db, nil, nil, fetchPrompt, nil)

	// `lt 10`: com um zero fabricado a regra dispararia. Nenhum Exec é esperado — nem o de disparo,
	// nem o de last_evaluated_at: o congelamento É o sinal durável de que a avaliação parou, e
	// carimbá-lo apagaria a única evidência de indisponibilidade.
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(linhaDeRegraDePrompt("lt", 10))

	if err := e.Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("uma leitura falha escreveu no banco: %v", err)
	}
}

func TestAgregadoVazioDePromptAvaliaZeroEDisparaARegraDeQueda(t *testing.T) {
	// O contra-exemplo do teste acima, e a razão de o bool divergir do irmão. "Ninguém resolveu
	// este prompt" é uma MEDIÇÃO — a falha de leitura já subiu como erro no teste anterior. Sem
	// isto, a regra "avise se este prompt parar de ser usado" seria pulada exatamente na condição
	// que ela existe para detectar, e o cliente veria uma regra armada que nunca dispara.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	fetchPrompt := func(context.Context, string, string, int) (json.RawMessage, error) {
		return json.RawMessage(`{"promptName":"saudacao","windowDays":7,"rows":[]}`), nil
	}
	e := New(db, nil, nil, fetchPrompt, nil)

	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(linhaDeRegraDePrompt("lt", 1))
	// O disparo roda em UMA transação (M84): o flip, a entrega e a linha de histórico commitam
	// juntos ou nenhum deles — é o que garante um aviso por violação, e um registro por aviso.
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO workspace_webhook_deliveries").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO lens_fired_alerts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := e.Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("0 resoluções não disparou a regra de queda: %v", err)
	}
}

func TestRegraDePromptSemFetcherNaoEAvaliadaEmSilencio(t *testing.T) {
	// A lição que o construtor do caminho por guard já documenta: "um fetcher opcional foi como a
	// feature subiu nil em produção". Sem fetcher a regra não pode ser avaliada — e o que não pode
	// acontecer é ela ser PULADA sem registro, porque aí o cliente vê uma regra armada que nunca
	// dispara e nada no sistema diz por quê.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	e := New(db, nil, nil, nil, nil)
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(linhaDeRegraDePrompt("gt", 10))

	if err := e.Tick(context.Background()); err != nil {
		t.Fatalf("Tick não pode abortar por causa de UMA regra: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sem fetcher nada deve ser escrito: %v", err)
	}
}

// A regra escopada a prompt sem nome de prompt é irrepresentável no banco (CHECK de pareamento da
// migração 000060). Este teste é cinto-e-suspensório pelo mesmo motivo que o caminho por guard tem
// o dele: para que um leitor não conclua que o banco permite o estado.
func TestRegraDePromptSemNomeDePromptNaoEAvaliada(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	chamou := false
	fetchPrompt := func(context.Context, string, string, int) (json.RawMessage, error) {
		chamou = true
		return json.RawMessage(usoDePrompt), nil
	}
	e := New(db, nil, nil, fetchPrompt, nil)

	linha := sqlmock.NewRows([]string{
		"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds", "webhook_id",
		"status", "last_triggered_at", "renotify_interval_seconds", "monitor_id", "prompt_name",
	}).AddRow("lar-p1", "t1", MetricPromptResolutions, "gt", 10.0, 3600, "wh-1",
		"OK", nil, nil, nil, sql.NullString{})
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(linha)

	if err := e.Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if chamou {
		t.Error("sem nome de prompt não há o que consultar — buscar assim mediria um prompt vazio")
	}
}
