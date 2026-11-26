// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package memory_webhook_worker

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Real-Postgres tests for the visibility-timeout reaper (loop-console#160) — the
// permanent-'delivering'-orphan fix the memory worker previously lacked. Uses a
// fixture schema so the test does not depend on the cross-repo engine migration.

func reaperDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("reaper test skipped: DATABASE_URL not set")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Skipf("reaper test skipped: open: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		t.Skipf("reaper test skipped: ping: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func reaperFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`DROP TABLE IF EXISTS memory_webhook_deliveries, memory_webhooks CASCADE`,
		`CREATE TABLE memory_webhooks (
			id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT, revoked_at TIMESTAMPTZ)`,
		`CREATE TABLE memory_webhook_deliveries (
			id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL,
			status TEXT NOT NULL, attempt_count INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ,
			last_response_status INT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)`,
		`INSERT INTO memory_webhooks (id, url, secret) VALUES ('mwh-1','https://hook.example.test','whsec_x')`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			t.Fatalf("fixture: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DROP TABLE IF EXISTS memory_webhook_deliveries, memory_webhooks CASCADE`)
	})
}

// seedReaperDelivery inserts a delivery. nextAttempt is a raw SQL expression
// (e.g. "NOW() - INTERVAL '5 minutes'" or "NULL").
func seedReaperDelivery(t *testing.T, db *sql.DB, id, status string, attempt int, nextAttempt string) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO memory_webhook_deliveries
		  (id, webhook_id, event_type, payload, status, attempt_count, next_attempt_at)
		VALUES ($1,'mwh-1','memory.updated','{"x":1}'::jsonb,$2,$3,`+nextAttempt+`)`,
		id, status, attempt); err != nil {
		t.Fatalf("seed delivery: %v", err)
	}
}

// A 'delivering' row whose lease deadline (next_attempt_at) has passed is an
// orphan (worker crashed mid-dispatch) — the reaper reclaims it as a failed
// attempt, counts it, and schedules a backed-off retry, so it is NOT lost.
func TestWorker_ReapStaleDelivery_Reclaims(t *testing.T) {
	db := reaperDB(t)
	reaperFixture(t, db)
	seedReaperDelivery(t, db, "mwd-stale", "delivering", 1, "NOW() - INTERVAL '5 minutes'")
	seedReaperDelivery(t, db, "mwd-fresh", "delivering", 1, "NOW() + INTERVAL '5 minutes'") // within lease

	n, err := New(db, nil, nil).reapStaleDeliveries(context.Background())
	if err != nil {
		t.Fatalf("reap: %v", err)
	}
	if n != 1 {
		t.Errorf("reaped %d, want 1 (only the stale orphan)", n)
	}
	var status string
	var attempt int
	var next sql.NullTime
	_ = db.QueryRow(`SELECT status, attempt_count, next_attempt_at FROM memory_webhook_deliveries WHERE id='mwd-stale'`).
		Scan(&status, &attempt, &next)
	if status != "failed" {
		t.Errorf("stale orphan status = %s, want failed", status)
	}
	if attempt != 2 {
		t.Errorf("attempt_count = %d, want 2 (reaper counts the orphaned attempt)", attempt)
	}
	if !next.Valid || !next.Time.After(time.Now().Add(time.Second)) {
		t.Errorf("next_attempt_at not backed off into the future (would tight-loop)")
	}
	// The fresh (within-lease) delivering row is NOT reaped.
	var freshStatus string
	_ = db.QueryRow(`SELECT status FROM memory_webhook_deliveries WHERE id='mwd-fresh'`).Scan(&freshStatus)
	if freshStatus != "delivering" {
		t.Errorf("fresh lease wrongly reaped: status=%s (want delivering)", freshStatus)
	}
}

// A stale orphan on its final attempt dead-letters, not re-queues forever.
func TestWorker_ReapStaleDelivery_DeadLettersAtCap(t *testing.T) {
	db := reaperDB(t)
	reaperFixture(t, db)
	seedReaperDelivery(t, db, "mwd-1", "delivering", MaxAttempts-1, "NOW() - INTERVAL '5 minutes'")

	if _, err := New(db, nil, nil).reapStaleDeliveries(context.Background()); err != nil {
		t.Fatalf("reap: %v", err)
	}
	var status string
	_ = db.QueryRow(`SELECT status FROM memory_webhook_deliveries WHERE id='mwd-1'`).Scan(&status)
	if status != "dead_letter" {
		t.Errorf("reaped-at-cap status = %s, want dead_letter", status)
	}
}

// claimDue must stamp a future lease deadline on next_attempt_at so the reaper
// can tell a live in-flight row from a crashed orphan.
func TestWorker_ClaimSetsLeaseDeadline(t *testing.T) {
	db := reaperDB(t)
	reaperFixture(t, db)
	seedReaperDelivery(t, db, "mwd-1", "pending", 0, "NULL")

	claimed, err := New(db, nil, nil).claimDue(context.Background(), 10)
	if err != nil {
		t.Fatalf("claimDue: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("claimed %d, want 1", len(claimed))
	}
	var status string
	var next sql.NullTime
	_ = db.QueryRow(`SELECT status, next_attempt_at FROM memory_webhook_deliveries WHERE id='mwd-1'`).Scan(&status, &next)
	if status != "delivering" {
		t.Errorf("status = %s, want delivering", status)
	}
	if !next.Valid || !next.Time.After(time.Now().Add(time.Second)) {
		t.Errorf("claim did not stamp a future lease deadline on next_attempt_at")
	}
}
