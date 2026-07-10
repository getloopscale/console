// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const breachedSeries = `{"traffic":[{"traceCount":100,"errorCount":20,"errorRate":0.2}],"latency":[{"p95Ms":900}],"tokensByModel":[{"costUsd":1.0}]}`
const okSeries = `{"traffic":[{"traceCount":100,"errorCount":1,"errorRate":0.01}],"latency":[{"p95Ms":50}],"tokensByModel":[{"costUsd":0.01}]}`

func newEval(t *testing.T) (*Evaluator, sqlmock.Sqlmock, *sql.DB) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	e := New(db, nil, nil)
	e.now = func() time.Time { return time.Unix(1_700_000_000, 0).UTC() }
	return e, mock, db
}

// OK + breach → the atomic OK→TRIGGERED UPDATE fires AND one delivery is enqueued.
func TestProcessRule_OKBreach_FiresAndEnqueues(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	// the fire flip + the delivery INSERT + the fired-alert history INSERT run in ONE transaction
	// (M84 — a breach yields exactly one delivery AND one history row, atomically).
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO workspace_webhook_deliveries").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO lens_fired_alerts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	r := alertRule{id: "lar-1", tenantID: "tn-1", metric: "error_rate", comparator: "gt", threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "OK"}
	if err := e.processRule(context.Background(), r, json.RawMessage(breachedSeries)); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("expectations: %v", err) // an INSERT that never happens (or an extra one) fails here
	}
}

// M84 — a failed history INSERT rolls back the WHOLE fire (flip + delivery), so the next tick retries
// (no silently-lost alert, no delivery without its audit row).
func TestProcessRule_FiredAlertInsertFails_RollsBack(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO workspace_webhook_deliveries").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO lens_fired_alerts").WillReturnError(errors.New("boom"))
	mock.ExpectRollback()

	r := alertRule{id: "lar-1", tenantID: "tn-1", metric: "error_rate", comparator: "gt", threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "OK"}
	if err := e.processRule(context.Background(), r, json.RawMessage(breachedSeries)); err == nil {
		t.Fatal("expected the failed history INSERT to surface an error (→ tx rollback)")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("expectations: %v", err)
	}
}

// TRIGGERED + still breached (no renotify) → the non-fire UPDATE runs, but NO new delivery (anti-storm).
func TestProcessRule_StillBreached_NoReEnqueue(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	// only the last_evaluated UPDATE; a second INSERT would be an unexpected exec → ExpectationsWereMet fails.
	mock.ExpectExec("UPDATE lens_alert_rules SET status = \\$1, last_evaluated_at").WillReturnResult(sqlmock.NewResult(0, 1))

	r := alertRule{id: "lar-1", tenantID: "tn-1", metric: "error_rate", comparator: "gt", threshold: 5, windowSeconds: 3600,
		webhookID: "wwh-1", status: "TRIGGERED", lastTriggered: sql.NullTime{Time: time.Unix(1_699_990_000, 0), Valid: true}}
	if err := e.processRule(context.Background(), r, json.RawMessage(breachedSeries)); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("expectations (a re-INSERT would break this): %v", err)
	}
}

// TRIGGERED + cleared → status reset to OK via the non-fire UPDATE, no delivery.
func TestProcessRule_Cleared_ResetsToOK(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = \\$1, last_evaluated_at").
		WithArgs("OK", sqlmock.AnyArg(), "lar-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	r := alertRule{id: "lar-1", tenantID: "tn-1", metric: "error_rate", comparator: "gt", threshold: 5, windowSeconds: 3600,
		webhookID: "wwh-1", status: "TRIGGERED", lastTriggered: sql.NullTime{Time: time.Unix(1_699_990_000, 0), Valid: true}}
	if err := e.processRule(context.Background(), r, json.RawMessage(okSeries)); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("expectations: %v", err)
	}
}

// A losing replica (conditional UPDATE affects 0 rows) does NOT enqueue.
func TestProcessRule_LostTransition_NoEnqueue(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 0)) // 0 rows → lost
	mock.ExpectCommit()                                                                                           // the no-op transition commits; NO INSERT

	r := alertRule{id: "lar-1", tenantID: "tn-1", metric: "error_rate", comparator: "gt", threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "OK"}
	if err := e.processRule(context.Background(), r, json.RawMessage(breachedSeries)); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("a lost transition must not INSERT: %v", err)
	}
}

// A per-tenant fetch error skips that tenant's rules (fail-closed: no spurious fire), tick doesn't abort.
func TestTick_FetchErrorSkipsTenant(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetch = func(_ context.Context, _ string, _ int) (json.RawMessage, error) {
		return nil, errors.New("theo-lens down")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric, comparator").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds", "webhook_id", "status",
			"last_triggered_at", "renotify_interval_seconds",
		}).AddRow("lar-1", "tn-1", "error_rate", "gt", 5.0, 3600, "wwh-1", "OK", nil, nil))
	// NO UPDATE / INSERT expected — the fetch error skips the tenant.

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("fetch error must not touch the DB beyond the SELECT: %v", err)
	}
}
