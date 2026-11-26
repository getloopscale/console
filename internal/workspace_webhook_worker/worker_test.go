// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package workspace_webhook_worker

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	mww "github.com/getloopscale/loop-console/internal/memory_webhook_worker"
)

// Real-Postgres tests for the NEW worker logic — the lease claim, the
// delivered/retry/dead_letter transitions, and the visibility-timeout reaper.
// The HTTP dispatch itself is memory_webhook_worker.Dispatch (already tested);
// and it cannot be exercised against a loopback test server because the safehttp
// SSRF guard (correctly) refuses loopback. Uses a fixture schema so the test
// does not depend on the cross-repo engine migrations.

func workerDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5432/loopscale_test?sslmode=disable"
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Skipf("worker test skipped: open: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		t.Skipf("worker test skipped: ping: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func workerFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`DROP TABLE IF EXISTS workspace_webhook_deliveries, workspace_webhooks CASCADE`,
		`CREATE TABLE workspace_webhooks (
			id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL, revoked_at TIMESTAMPTZ)`,
		`CREATE TABLE workspace_webhook_deliveries (
			id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, transition_id TEXT NOT NULL,
			tenant_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL,
			status TEXT NOT NULL, attempt_count INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ,
			claimed_at TIMESTAMPTZ, claimed_by TEXT, last_response_status INT, last_response_body TEXT,
			last_error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			t.Fatalf("fixture: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DROP TABLE IF EXISTS workspace_webhook_deliveries, workspace_webhooks CASCADE`)
	})
	if _, err := db.Exec(`INSERT INTO workspace_webhooks (id, url, secret) VALUES ('wwh-1','https://hook.example.test','whsec_x')`); err != nil {
		t.Fatalf("seed webhook: %v", err)
	}
}

func seedDelivery(t *testing.T, db *sql.DB, id, status string, attempt int, claimedAt string) {
	t.Helper()
	claimed := "NULL"
	if claimedAt != "" {
		claimed = claimedAt
	}
	if _, err := db.Exec(`
		INSERT INTO workspace_webhook_deliveries
		  (id, webhook_id, transition_id, tenant_id, event_type, payload, status, attempt_count, next_attempt_at, claimed_at, claimed_by)
		VALUES ($1,'wwh-1',$1,'tn-a','deploy.succeeded','{"status":"success"}'::jsonb,$2,$3,NOW(),`+claimed+`, CASE WHEN `+claimed+` IS NULL THEN NULL ELSE 'old-worker' END)`,
		id, status, attempt); err != nil {
		t.Fatalf("seed delivery: %v", err)
	}
}

func TestWorker_ClaimDue_SetsLease(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	seedDelivery(t, db, "wwd-1", "pending", 0, "")

	w := New(db, nil, "replica-A")
	claimed, err := w.claimDue(context.Background(), 10)
	if err != nil {
		t.Fatalf("claimDue: %v", err)
	}
	if len(claimed) != 1 || claimed[0].ID != "wwd-1" {
		t.Fatalf("claimed = %+v, want [wwd-1]", claimed)
	}
	// URL + secret loaded from the parent webhook (JOIN).
	if claimed[0].URL != "https://hook.example.test" || claimed[0].Secret.String != "whsec_x" {
		t.Errorf("claim did not load webhook url+secret: %+v", claimed[0])
	}
	var status, by string
	var at sql.NullTime
	_ = db.QueryRow(`SELECT status, claimed_by, claimed_at FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status, &by, &at)
	if status != "delivering" || by != "replica-A" || !at.Valid {
		t.Errorf("lease not set: status=%s claimed_by=%s claimed_at.valid=%v", status, by, at.Valid)
	}
}

func TestWorker_ClaimDue_SkipsRevokedWebhook(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	_, _ = db.Exec(`UPDATE workspace_webhooks SET revoked_at=NOW() WHERE id='wwh-1'`)
	seedDelivery(t, db, "wwd-1", "pending", 0, "")

	claimed, err := New(db, nil, "r").claimDue(context.Background(), 10)
	if err != nil {
		t.Fatalf("claimDue: %v", err)
	}
	if len(claimed) != 0 {
		t.Errorf("claimed %d for a revoked webhook, want 0", len(claimed))
	}
}

func TestWorker_RecordResult_Delivered_ClearsLease(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	seedDelivery(t, db, "wwd-1", "delivering", 0, "NOW()")

	New(db, nil, "old-worker").recordResult(
		&mww.Delivery{ID: "wwd-1", AttemptCount: 0},
		mww.DispatchResult{Delivered: true, StatusCode: 200, Body: "ok"},
	)
	var status string
	var claimedAt, completedAt sql.NullTime
	_ = db.QueryRow(`SELECT status, claimed_at, completed_at FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status, &claimedAt, &completedAt)
	if status != "delivered" || claimedAt.Valid || !completedAt.Valid {
		t.Errorf("delivered branch wrong: status=%s claimed_at.valid=%v completed_at.valid=%v", status, claimedAt.Valid, completedAt.Valid)
	}
}

func TestWorker_RecordResult_5xx_SchedulesRetry(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	seedDelivery(t, db, "wwd-1", "delivering", 0, "NOW()")

	New(db, nil, "old-worker").recordResult(
		&mww.Delivery{ID: "wwd-1", AttemptCount: 0},
		mww.DispatchResult{Delivered: false, StatusCode: 500, ErrorMessage: "non-2xx: 500"},
	)
	var status string
	var next sql.NullTime
	_ = db.QueryRow(`SELECT status, next_attempt_at FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status, &next)
	if status != "failed" || !next.Valid || !next.Time.After(time.Now()) {
		t.Errorf("retry branch wrong: status=%s next_attempt_at future=%v", status, next.Valid && next.Time.After(time.Now()))
	}
}

func TestWorker_RecordResult_LastAttempt_DeadLetters(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	// AttemptCount = MaxAttempts-1 so the next attempt is the final one.
	seedDelivery(t, db, "wwd-1", "delivering", mww.MaxAttempts-1, "NOW()")

	New(db, nil, "old-worker").recordResult(
		&mww.Delivery{ID: "wwd-1", AttemptCount: mww.MaxAttempts - 1},
		mww.DispatchResult{Delivered: false, StatusCode: 500, ErrorMessage: "still failing"},
	)
	var status string
	_ = db.QueryRow(`SELECT status FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status)
	if status != "dead_letter" {
		t.Errorf("status = %s after final failed attempt, want dead_letter", status)
	}
}

// The reaper reclaims rows stuck in 'delivering' past the lease timeout — the
// permanent-orphan fix the memory worker lacks.
func TestWorker_ReapStaleLeases_ReclaimsOrphan(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	// Claimed 5 minutes ago (> 90s lease) — a crashed worker's orphan.
	seedDelivery(t, db, "wwd-1", "delivering", 1, "NOW() - INTERVAL '5 minutes'")
	// A freshly-claimed row (within lease) must NOT be reaped.
	seedDelivery(t, db, "wwd-2", "delivering", 1, "NOW()")

	n, err := New(db, nil, "r").reapStaleLeases(context.Background())
	if err != nil {
		t.Fatalf("reap: %v", err)
	}
	if n != 1 {
		t.Errorf("reaped %d, want 1 (only the stale orphan)", n)
	}
	var s1, s2 string
	var c1 sql.NullTime
	_ = db.QueryRow(`SELECT status, claimed_at FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&s1, &c1)
	_ = db.QueryRow(`SELECT status FROM workspace_webhook_deliveries WHERE id='wwd-2'`).Scan(&s2)
	if s1 != "failed" || c1.Valid {
		t.Errorf("stale orphan not reclaimed: status=%s claimed_at.valid=%v (want failed, cleared)", s1, c1.Valid)
	}
	if s2 != "delivering" {
		t.Errorf("fresh lease wrongly reaped: status=%s (want delivering)", s2)
	}
}

// B2 (loop-console#155): a stale worker whose lease was reaped + reclaimed by
// another replica must NOT clobber the row when its own dispatch finally
// returns. recordResult is guarded on (claimed_by, status='delivering'); a
// non-owning write affects 0 rows and is dropped — no lost update, no
// resurrection of a row another worker now owns.
func TestWorker_RecordResult_LeaseLost_DropsStaleWrite(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	seedDelivery(t, db, "wwd-1", "delivering", 2, "NOW()") // seeded claimed_by='old-worker'
	// The reaper reclaimed it and 'new-worker' took the lease.
	if _, err := db.Exec(`UPDATE workspace_webhook_deliveries SET claimed_by='new-worker' WHERE id='wwd-1'`); err != nil {
		t.Fatalf("reassign lease: %v", err)
	}
	// 'old-worker' (stale) finally returns a 200 and tries to record delivered.
	New(db, nil, "old-worker").recordResult(
		&mww.Delivery{ID: "wwd-1", AttemptCount: 2},
		mww.DispatchResult{Delivered: true, StatusCode: 200, Body: "ok"},
	)
	var status, by string
	_ = db.QueryRow(`SELECT status, claimed_by FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status, &by)
	if status != "delivering" || by != "new-worker" {
		t.Errorf("stale write not dropped: status=%s claimed_by=%s (want delivering/new-worker)", status, by)
	}
}

// B3 (loop-console#155): the reaper must count the orphaned attempt and back off,
// not reset next_attempt_at=NOW() (which would tight-loop) and not leave
// attempt_count unchanged (which would bypass the dead-letter budget forever).
func TestWorker_ReapStaleLeases_CountsAttemptAndBacksOff(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	seedDelivery(t, db, "wwd-1", "delivering", 1, "NOW() - INTERVAL '5 minutes'")

	if _, err := New(db, nil, "r").reapStaleLeases(context.Background()); err != nil {
		t.Fatalf("reap: %v", err)
	}
	var status string
	var attempt int
	var next sql.NullTime
	_ = db.QueryRow(`SELECT status, attempt_count, next_attempt_at FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status, &attempt, &next)
	if attempt != 2 {
		t.Errorf("attempt_count = %d, want 2 (reaper counts the orphaned attempt)", attempt)
	}
	if !next.Valid || !next.Time.After(time.Now().Add(time.Second)) {
		t.Errorf("next_attempt_at not backed off into the future (would tight-loop): valid=%v", next.Valid)
	}
	if status != "failed" {
		t.Errorf("status = %s, want failed (under the dead-letter cap)", status)
	}
}

// B3 (loop-console#155): a row reaped on its final attempt must dead-letter, not
// re-queue forever.
func TestWorker_ReapStaleLeases_DeadLettersAtCap(t *testing.T) {
	db := workerDB(t)
	workerFixture(t, db)
	seedDelivery(t, db, "wwd-1", "delivering", mww.MaxAttempts-1, "NOW() - INTERVAL '5 minutes'")

	if _, err := New(db, nil, "r").reapStaleLeases(context.Background()); err != nil {
		t.Fatalf("reap: %v", err)
	}
	var status string
	var next sql.NullTime
	_ = db.QueryRow(`SELECT status, next_attempt_at FROM workspace_webhook_deliveries WHERE id='wwd-1'`).Scan(&status, &next)
	if status != "dead_letter" || next.Valid {
		t.Errorf("reaped-at-cap: status=%s next_attempt_at.valid=%v (want dead_letter, cleared)", status, next.Valid)
	}
}
