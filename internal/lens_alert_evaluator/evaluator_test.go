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
		WithArgs("OK", sqlmock.AnyArg(), "lar-1", sqlmock.AnyArg(), sqlmock.AnyArg()).
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
			"last_triggered_at", "renotify_interval_seconds", "guard_id",
		}).AddRow("lar-1", "tn-1", "error_rate", "gt", 5.0, 3600, "wwh-1", "OK", nil, nil, nil))
	// NO UPDATE / INSERT expected — the fetch error skips the tenant.

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("fetch error must not touch the DB beyond the SELECT: %v", err)
	}
}

// ── M135 T3.1 — guard-backed alert rules ─────────────────────────────────────────────────────────
//
// A guard-backed rule thresholds the number of traces that breached a theo-lens guard in the
// window. Everything downstream — the state machine, the atomic transition, the delivery enqueue —
// is REUSED unchanged; only the source of the number differs. That is the whole point of the
// boundary decision (D1): theo-cloud already owns a correct anti-storm evaluator, so M135 must not
// grow a second one inside theo-lens.

// A guard rule with no data in the window MUST NOT fire — the same invariant as #247, one source
// further upstream. An empty window is absence, not "zero traces breached".
func TestProcessGuardRule_NoData_DoesNotFire(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	// The ONLY statement allowed is the evaluation stamp — status untouched. No Begin, no delivery.
	mock.ExpectExec("UPDATE lens_alert_rules SET last_evaluated_at").
		WillReturnResult(sqlmock.NewResult(0, 1))

	r := alertRule{id: "lar-g1", tenantID: "tn-1", metric: "guard_breach", comparator: "gt",
		threshold: 0, windowSeconds: 3600, webhookID: "wwh-1", status: "OK",
		guardID: sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r, GuardBreachWindow{HasData: false}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("no-data guard rule must not fire: %v", err)
	}
}

// A measured zero is NOT absence: traces WERE evaluated and none breached. The rule evaluates
// normally (and, for a `gt 0` rule, does not fire — but for the right reason).
func TestProcessGuardRule_MeasuredZero_EvaluatesNormally(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = \\$1, last_evaluated_at").
		WithArgs("OK", sqlmock.AnyArg(), "lar-g2", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	r := alertRule{id: "lar-g2", tenantID: "tn-1", metric: "guard_breach", comparator: "gt",
		threshold: 0, windowSeconds: 3600, webhookID: "wwh-1", status: "OK",
		guardID: sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r,
		GuardBreachWindow{HasData: true, EvaluatedCount: 40, BreachCount: 0}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A breach fires exactly once through the SAME atomic transition + delivery path as a series rule.
func TestProcessGuardRule_Breach_FiresOnce(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = 'TRIGGERED'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO workspace_webhook_deliveries").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO lens_fired_alerts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	r := alertRule{id: "lar-g3", tenantID: "tn-1", metric: "guard_breach", comparator: "gt",
		threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "OK",
		guardID: sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r,
		GuardBreachWindow{HasData: true, EvaluatedCount: 100, BreachCount: 12}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A SUSTAINED breach does not re-fire — the anti-storm suppression is the existing nextAlertState,
// reused unchanged. This is the assertion that proves reuse rather than reimplementation.
func TestProcessGuardRule_SustainedBreach_DoesNotReFire(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = \\$1, last_evaluated_at").
		WillReturnResult(sqlmock.NewResult(0, 1))

	r := alertRule{id: "lar-g4", tenantID: "tn-1", metric: "guard_breach", comparator: "gt",
		threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "TRIGGERED",
		lastTriggered: sql.NullTime{Time: time.Unix(1_699_999_000, 0), Valid: true},
		guardID:       sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r,
		GuardBreachWindow{HasData: true, EvaluatedCount: 100, BreachCount: 12}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a sustained guard breach must not re-fire: %v", err)
	}
}

// A guard rule whose fetch fails is skipped, not evaluated against a zero.
func TestTick_GuardFetchError_SkipsRule(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetchGuard = func(context.Context, string, string, int) (GuardBreachWindow, error) {
		return GuardBreachWindow{}, errors.New("carrier down")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(
		sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds",
			"webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "guard_id"}).
			AddRow("lar-g5", "tn-1", "guard_breach", "gt", 0.0, 3600, "wwh-1", "OK", nil, nil, "g-1"))

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	// No UPDATE, no delivery: a failed fetch must never be read as "zero breaches".
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// ── #248 — the non-fire write must be fenced, like the fire write already is ──────────────────────
//
// The fire path is a proper CAS (`WHERE id=$2 AND status='OK'`), so a losing replica affects 0 rows.
// The non-fire path wrote status UNCONDITIONALLY, which lets replica B — holding a legitimately
// newer non-breaching read — reset the TRIGGERED that replica A just latched. The next tick fires
// again with a fresh transition_id (second granularity), so ON CONFLICT does not dedupe it: an
// alert storm out of the very machinery that exists to prevent one.
//
// M135 does not introduce this; it ACTIVATES it. Two replicas reading the same 24h observability
// window usually agree. Two replicas reading a short, moving per-guard breach window at different
// instants routinely disagree.
func TestProcessRule_NonFireWriteIsFenced(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()

	// The fence: the write must carry the read-time status AND the read-time last_triggered_at, so
	// a replica whose read is stale affects 0 rows instead of clobbering the winner.
	lastTrig := time.Unix(1_699_999_000, 0)
	mock.ExpectExec("UPDATE lens_alert_rules SET status = \\$1, last_evaluated_at = \\$2").
		WithArgs("OK", sqlmock.AnyArg(), "lar-f", "TRIGGERED", lastTrig).
		WillReturnResult(sqlmock.NewResult(0, 0)) // 0 rows = we lost the race; must NOT error

	r := alertRule{id: "lar-f", tenantID: "tn-1", metric: "error_rate", comparator: "gt",
		threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "TRIGGERED",
		lastTriggered: sql.NullTime{Time: lastTrig, Valid: true}}

	if err := e.processRule(context.Background(), r, json.RawMessage(okSeries)); err != nil {
		t.Fatalf("losing the non-fire race is a no-op, not an error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("non-fire write must be fenced on read-time state: %v", err)
	}
}

// The stamp asymmetry is load-bearing and was previously undefended. A fetch error must NOT stamp
// last_evaluated_at — the timestamp freezing IS the durable, replica-agnostic signal that we
// stopped looking. A no-data window MUST stamp: we did look, and there was nothing.
//
// Anyone "fixing" this for symmetry destroys the only outage signal the system has.
func TestFetchErrorDoesNotStampLastEvaluated(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetchGuard = func(context.Context, string, string, int) (GuardBreachWindow, error) {
		return GuardBreachWindow{}, errors.New("carrier down")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(
		sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds",
			"webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "guard_id"}).
			AddRow("lar-s", "tn-1", "guard_breach", "gt", 0.0, 3600, "wwh-1", "OK", nil, nil, "g-1"))
	// NO UPDATE expected at all — sqlmock fails on any unexpected statement.

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a fetch error must leave last_evaluated_at frozen: %v", err)
	}
}
