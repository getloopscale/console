// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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
	e := New(db, nil, nil, nil)
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
			"last_triggered_at", "renotify_interval_seconds", "monitor_id",
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

	r := alertRule{id: "lar-g1", tenantID: "tn-1", metric: "monitor_breach", comparator: "gt",
		threshold: 0, windowSeconds: 3600, webhookID: "wwh-1", status: "OK",
		monitorID: sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r, MonitorBreachWindow{HasData: false}); err != nil {
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

	r := alertRule{id: "lar-g2", tenantID: "tn-1", metric: "monitor_breach", comparator: "gt",
		threshold: 0, windowSeconds: 3600, webhookID: "wwh-1", status: "OK",
		monitorID: sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r,
		MonitorBreachWindow{HasData: true, EvaluatedCount: 40, BreachCount: 0}); err != nil {
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

	r := alertRule{id: "lar-g3", tenantID: "tn-1", metric: "monitor_breach", comparator: "gt",
		threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "OK",
		monitorID: sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r,
		MonitorBreachWindow{HasData: true, EvaluatedCount: 100, BreachCount: 12}); err != nil {
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

	r := alertRule{id: "lar-g4", tenantID: "tn-1", metric: "monitor_breach", comparator: "gt",
		threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "TRIGGERED",
		lastTriggered: sql.NullTime{Time: time.Unix(1_699_999_000, 0), Valid: true},
		monitorID:     sql.NullString{String: "g-1", Valid: true}}

	if err := e.processGuardRule(context.Background(), r,
		MonitorBreachWindow{HasData: true, EvaluatedCount: 100, BreachCount: 12}); err != nil {
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
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		return MonitorBreachWindow{}, errors.New("carrier down")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(
		sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds",
			"webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "monitor_id"}).
			AddRow("lar-g5", "tn-1", "monitor_breach", "gt", 0.0, 3600, "wwh-1", "OK", nil, nil, "g-1"))

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
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		return MonitorBreachWindow{}, errors.New("carrier down")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(
		sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold", "window_seconds",
			"webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "monitor_id"}).
			AddRow("lar-s", "tn-1", "monitor_breach", "gt", 0.0, 3600, "wwh-1", "OK", nil, nil, "g-1"))
	// NO UPDATE expected at all — sqlmock fails on any unexpected statement.

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a fetch error must leave last_evaluated_at frozen: %v", err)
	}
}

// ── SRE condition 6 — a deleted guard is not a transient failure ─────────────────────────────────
//
// A transport failure self-heals; a deleted guard never does. Skipping forever is correct for
// neither. On a DEFINITIVE 404 the rule is disabled, so the customer sees a disabled rule rather
// than an armed one that can never fire — an honest downgrade. The customer has no reason to
// connect "I deleted a guard in theo-lens" with "an alert in theo-cloud went dark"; the disabled
// flag is the breadcrumb.
func TestTick_GuardNotFound_DisablesTheRule(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		return MonitorBreachWindow{}, ErrMonitorNotFound
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(monitorRuleRow("lar-gone", "g-gone"))
	mock.ExpectExec("UPDATE lens_alert_rules SET enabled = FALSE").
		WithArgs("lar-gone").WillReturnResult(sqlmock.NewResult(0, 1))

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a definitive 404 must disable the rule: %v", err)
	}
}

// A TRANSPORT error must NOT disable — auto-disabling on a blip would permanently disarm every
// guard rule in the fleet the first time theo-lens hiccups. This is the assertion that makes the
// test above safe rather than dangerous.
func TestTick_TransportError_DoesNotDisable(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		return MonitorBreachWindow{}, errors.New("connection reset")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(monitorRuleRow("lar-blip", "g-1"))
	// No UPDATE of any kind expected.

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a transport blip must never disarm a rule: %v", err)
	}
}

// The in-tick bulkhead: after K consecutive carrier failures the remaining guard rules are skipped
// for this tick, so a hung theo-lens cannot serialize N × timeout inside one tick and stall the
// series-backed rules queued behind it — rules with no theo-lens dependency at all.
func TestTick_GuardBulkheadStopsAfterBudget(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	calls := 0
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		calls++
		return MonitorBreachWindow{}, errors.New("hung")
	}
	rows := sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold",
		"window_seconds", "webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "monitor_id"})
	for i := 0; i < 10; i++ {
		rows.AddRow(fmt.Sprintf("lar-%d", i), "tn-1", "monitor_breach", "gt", 0.0, 3600, "wwh-1", "OK", nil, nil,
			fmt.Sprintf("g-%d", i)) // distinct guards, so the per-guard cache cannot mask the budget
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(rows)

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != monitorFailureBudget {
		t.Fatalf("bulkhead must stop the carrier after %d failures, got %d calls", monitorFailureBudget, calls)
	}
}

// N rules on ONE guard must mint one key and issue one call, mirroring the series path's cache.
func TestTick_GuardResultIsCachedPerGuardAndWindow(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	calls := 0
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		calls++
		return MonitorBreachWindow{HasData: true, EvaluatedCount: 10, BreachCount: 0}, nil
	}
	rows := sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold",
		"window_seconds", "webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "monitor_id"})
	for i := 0; i < 3; i++ {
		rows.AddRow(fmt.Sprintf("lar-c%d", i), "tn-1", "monitor_breach", "gt", 5.0, 3600, "wwh-1", "OK", nil, nil, "g-same")
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(rows)
	for i := 0; i < 3; i++ {
		mock.ExpectExec("UPDATE lens_alert_rules SET status").WillReturnResult(sqlmock.NewResult(0, 1))
	}

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("3 rules on one guard must issue 1 carrier call, got %d", calls)
	}
}

func monitorRuleRow(ruleID, monitorID string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold",
		"window_seconds", "webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "monitor_id"}).
		AddRow(ruleID, "tn-1", "monitor_breach", "gt", 0.0, 3600, "wwh-1", "OK", nil, nil, monitorID)
}

// The fence must not WEDGE a fresh rule. A rule evaluated for the first time has status='OK',
// last_triggered_at NULL and last_evaluated_at NULL — if any of the three fence predicates failed to
// match that shape, the rule would never stamp last_evaluated_at and would read permanently stale,
// turning the outage signal added alongside it into a permanent false alarm.
//
// `NULL IS NOT DISTINCT FROM NULL` is TRUE, which is precisely why the fence uses it rather than `=`.
func TestProcessRule_FenceDoesNotWedgeAFreshRule(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	mock.ExpectExec("UPDATE lens_alert_rules SET status = \\$1, last_evaluated_at = \\$2").
		WithArgs("OK", sqlmock.AnyArg(), "lar-new", "OK", nil).
		WillReturnResult(sqlmock.NewResult(0, 1))

	r := alertRule{id: "lar-new", tenantID: "tn-1", metric: "error_rate", comparator: "gt",
		threshold: 5, windowSeconds: 3600, webhookID: "wwh-1", status: "OK"} // both timestamps zero

	if err := e.processRule(context.Background(), r, json.RawMessage(okSeries)); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a fresh rule must still stamp last_evaluated_at: %v", err)
	}
}

// ── The review finding: guardExists, not a 404 ───────────────────────────────────────────────────
//
// The previous test injected ErrMonitorNotFound at the fetcher seam — downstream of the only code
// that could construct it — so it proved the double worked while the production path was dead: the
// carrier never emits 404 (a 404 would confirm the id to another workspace). This test drives the
// SHAPE the carrier actually returns.
func TestProcessGuardRule_GuardExistsFalse_DisablesTheRule(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		return MonitorBreachWindow{MonitorExists: false, HasData: false}, nil // exactly what the wire carries
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(monitorRuleRow("lar-del", "g-del"))
	mock.ExpectExec("UPDATE lens_alert_rules SET enabled = FALSE").
		WithArgs("lar-del").WillReturnResult(sqlmock.NewResult(0, 1))

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a deleted guard must disable its rule: %v", err)
	}
}

// The companion that keeps the test above from being dangerous: a REAL guard whose window is simply
// empty must NOT be disabled. {MonitorExists:true, HasData:false} and {false,false} differ by one
// field and by everything that matters.
func TestProcessGuardRule_RealGuardEmptyWindow_IsNotDisabled(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	e.fetchMonitor = func(context.Context, string, string, int) (MonitorBreachWindow, error) {
		return MonitorBreachWindow{MonitorExists: true, HasData: false}, nil
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(monitorRuleRow("lar-quiet", "g-1"))
	mock.ExpectExec("UPDATE lens_alert_rules SET last_evaluated_at").
		WillReturnResult(sqlmock.NewResult(0, 1)) // stamped, NOT disabled

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a quiet guard must not be disarmed: %v", err)
	}
}

// The bulkhead counts CONSECUTIVE failures, as its constant name promises. A success between
// failures clears the streak — otherwise three unrelated bad tenants would starve every healthy
// guard rule in the fleet for the remainder of the tick, and which rules got starved would shift
// per tick, presenting as intermittent.
func TestTick_BulkheadStreakResetsOnSuccess(t *testing.T) {
	e, mock, db := newEval(t)
	defer func() { _ = db.Close() }()
	calls := 0
	e.fetchMonitor = func(_ context.Context, _, monitorID string, _ int) (MonitorBreachWindow, error) {
		calls++
		if monitorID == "g-ok" {
			return MonitorBreachWindow{MonitorExists: true, HasData: true, EvaluatedCount: 1}, nil
		}
		return MonitorBreachWindow{}, errors.New("hung")
	}
	rows := sqlmock.NewRows([]string{"id", "tenant_id", "metric", "comparator", "threshold",
		"window_seconds", "webhook_id", "status", "last_triggered_at", "renotify_interval_seconds", "monitor_id"})
	// fail, fail, SUCCESS, fail, fail, fail  → without the reset the 6th is never attempted.
	for i, g := range []string{"g-a", "g-b", "g-ok", "g-c", "g-d", "g-e"} {
		rows.AddRow(fmt.Sprintf("lar-b%d", i), "tn-1", "monitor_breach", "gt", 5.0, 3600, "wwh-1", "OK", nil, nil, g)
	}
	mock.ExpectQuery("SELECT id, tenant_id, metric").WillReturnRows(rows)
	mock.ExpectExec("UPDATE lens_alert_rules SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	if err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 6 {
		t.Fatalf("a success must clear the failure streak: want 6 carrier calls, got %d", calls)
	}
}

// ── The other half of the cross-repo contract ────────────────────────────────────────────────────
//
// theo-lens pins the exact key set it emits (evaluators-route.integration.test.ts). This pins that
// we decode that same body correctly. Neither test alone would have caught the shipped defect: the
// consumer branched on a 404 the producer never emits, and each side's tests passed because each
// was written against its own author's intent rather than against the wire.
//
// The literal below is a VERBATIM response body. If theo-lens renames or drops a key, its own test
// fails there; if we change what we expect, this fails here. The pair is the contract.
func TestGuardBreachWindow_DecodesTheWireShapeTheoLensEmits(t *testing.T) {
	// Verbatim from theo-lens, which emits BOTH names during its deprecation window (M136).
	const wire = `{"breachCount":12,"evaluatedCount":100,"hasData":true,"monitorExists":true,"guardExists":true,"windowSeconds":3600}`

	var w MonitorBreachWindow
	if err := json.Unmarshal([]byte(wire), &w); err != nil {
		t.Fatal(err)
	}
	if w.BreachCount != 12 || w.EvaluatedCount != 100 || !w.HasData || !w.MonitorExists {
		t.Fatalf("decoded %+v from the real wire shape — a silently-renamed key would land here", w)
	}

	// The deleted-guard body. This is the one that matters: every field is zero/false EXCEPT that
	// guardExists distinguishes it from a quiet-but-healthy guard. If the field is ever dropped,
	// Go's zero value makes it decode as false — which happens to be the SAFE direction here (a
	// dropped field disables rules rather than arming dead ones), but it is safe by luck, not by
	// design, so the theo-lens side pins the key set explicitly.
	var gone MonitorBreachWindow
	if err := json.Unmarshal([]byte(`{"breachCount":0,"evaluatedCount":0,"hasData":false,"monitorExists":false,"guardExists":false,"windowSeconds":60}`), &gone); err != nil {
		t.Fatal(err)
	}
	if gone.MonitorExists || gone.HasData {
		t.Fatalf("a deleted guard must decode as absent on both axes, got %+v", gone)
	}
}
