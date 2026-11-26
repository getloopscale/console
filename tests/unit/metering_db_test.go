// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package unit

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"github.com/getloopscale/loop-console/internal/billing"
	"github.com/getloopscale/loop-console/internal/metering"
)

// T4.2 — the reporter claims pending rows with FOR UPDATE SKIP LOCKED inside a
// transaction and marks them reported in the same tx, so two replicas never
// report the same usage (no duplicate billing).
func TestReportPending_LocksAndCommits(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = db.Close() }()

	stripeHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		stripeHits++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	stripe := billing.NewStripeClientWithURL("sk_test", srv.URL)

	mock.ExpectBegin()
	mock.ExpectQuery("FOR UPDATE OF ur SKIP LOCKED").
		WillReturnRows(sqlmock.NewRows(
			[]string{"id", "tenant_id", "metric", "quantity", "created_at", "stripe_subscription_item_id"}).
			AddRow("ur_1", "tn_1", "builds", 3, time.Unix(1700000000, 0), "si_1"))
	mock.ExpectExec("UPDATE usage_records SET reported_to_stripe = true").
		WithArgs("ur_1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	r := metering.NewReporter(db, stripe, slog.New(slog.DiscardHandler))
	if err := r.ReportPending(); err != nil {
		t.Fatalf("ReportPending: %v", err)
	}
	if stripeHits != 1 {
		t.Fatalf("expected exactly 1 Stripe report, got %d", stripeHits)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expected lock+mark+commit: %v", err)
	}
}

// B-090 / #471 — `recorded == 0` é AUSÊNCIA, não drift, e a reconciliação
// precisa semear.
//
// ## O defeito que este teste fixa
//
// O reconciler compara a contagem gravada em `usage_records` com a contagem real
// em `builds`, e decide por porcentagem:
//
//	driftPct = |recorded - actual| / actual * 100
//
// Com `recorded = 0` — que é o estado de toda conta, porque nada nunca escreveu
// a primeira linha — a conta dá **100%** para qualquer `actual` maior que zero.
// Como 100 > 5, o caminho de auto-correção nunca executa: o reconciler roda,
// mede certo, avisa "requires manual review", e não escreve nada.
//
// O teto de 5% existe para impedir que uma reconciliação ERRADA sobrescreva
// dados de cobrança bons. É uma proteção correta — e quando não há dado nenhum,
// não há o que proteger. Recusar-se a semear é o que manteve `usage_records`
// vazia desde que a métrica foi definida, e é por isso que o Stripe nunca
// recebeu uso de build e a tela mostra "0 de 100" para todo mundo.
//
// ## Por que semear é seguro, e auto-corrigir 100% de drift não seria
//
// Semear escreve onde não havia linha: não existe valor a perder. Sobrescrever
// um valor existente com um que diverge 100% é outra coisa — pode ser a
// reconciliação que está errada, e aí a fatura é corrompida. O teto continua
// valendo para esse caso, que é o que ele foi escrito para cobrir.
func TestReconcile_SeedsWhenNothingRecorded(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = db.Close() }()

	const tenant = "tenant-a"
	const buildsReais = 42

	mock.ExpectQuery("FROM builds").
		WillReturnRows(sqlmock.NewRows([]string{"tenant_id", "actual_count"}).
			AddRow(tenant, buildsReais))
	// Nada gravado ainda — o estado de toda conta hoje.
	mock.ExpectQuery("SELECT COALESCE\\(quantity, 0\\) FROM usage_records").
		WillReturnRows(sqlmock.NewRows([]string{"quantity"}).AddRow(0))
	// É ISTO que falta hoje: a linha tem de ser criada com a contagem real.
	mock.ExpectExec("INSERT INTO usage_records").
		WithArgs(sqlmock.AnyArg(), tenant, buildsReais, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	r := metering.NewReconciler(db, slog.Default())
	if err := r.ReconcileBuilds(); err != nil {
		t.Fatalf("ReconcileBuilds: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("o reconciler não semeou `usage_records` com a contagem real: %v", err)
	}
}

// B-090 / #471 — o teto de drift continua valendo onde JÁ existe valor gravado.
//
// A mudança que fez a semeadura acontecer afrouxou uma condição, e este caso é o
// que impede o afrouxamento de ir longe demais. Com uma linha já gravada e
// divergência acima do teto, o reconciler NÃO sobrescreve: ele avisa e chama o
// callback, porque nesse caso quem pode estar errada é a própria reconciliação, e
// sobrescrever corromperia uma fatura.
//
// A distinção inteira é essa: ausência não tem valor a perder; divergência tem.
func TestReconcile_NaoSobrescreveQuandoDriftExcedeOTeto(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = db.Close() }()

	const tenant = "tenant-b"

	mock.ExpectQuery("FROM builds").
		WillReturnRows(sqlmock.NewRows([]string{"tenant_id", "actual_count"}).
			AddRow(tenant, 100))
	// 10 gravados contra 100 reais = 90% de divergência, muito acima do teto.
	mock.ExpectQuery("SELECT COALESCE\\(quantity, 0\\) FROM usage_records").
		WillReturnRows(sqlmock.NewRows([]string{"quantity"}).AddRow(10))
	// Nenhum ExpectExec: qualquer INSERT aqui reprova o teste.

	var avisou bool
	r := metering.NewReconciler(db, slog.Default())
	r.DriftCallback = func(_, _ string, recorded, actual int, driftPct float64) {
		avisou = true
		if recorded != 10 || actual != 100 {
			t.Errorf("callback recebeu recorded=%d actual=%d; queria 10 e 100", recorded, actual)
		}
	}
	if err := r.ReconcileBuilds(); err != nil {
		t.Fatalf("ReconcileBuilds: %v", err)
	}

	if !avisou {
		t.Error("divergência acima do teto tem de chamar o DriftCallback — ela exige revisão humana")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("o reconciler escreveu onde não devia: %v", err)
	}
}
