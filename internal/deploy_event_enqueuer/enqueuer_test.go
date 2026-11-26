// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package deploy_event_enqueuer

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Real-Postgres tests for the deploy-events → deliveries fan-out. Skipped
// without a reachable DB; RUN by provisioning an ephemeral PG + exporting
// DATABASE_URL. Uses a minimal fixture schema (the columns the enqueuer
// touches) so the test does not depend on the cross-repo engine migrations.

func enqueuerDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5432/loopscale_test?sslmode=disable"
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Skipf("enqueuer test skipped: open: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		t.Skipf("enqueuer test skipped: ping: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// fixtureSchema creates a minimal, isolated copy of the three tables the
// enqueuer touches (a fresh schema per test run keeps it hermetic).
func fixtureSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`DROP TABLE IF EXISTS workspace_webhook_deliveries, deploy_events, workspace_webhooks CASCADE`,
		`CREATE TABLE workspace_webhooks (
			id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, url TEXT NOT NULL,
			events JSONB NOT NULL, secret TEXT NOT NULL, revoked_at TIMESTAMPTZ)`,
		`CREATE TABLE deploy_events (
			id BIGSERIAL PRIMARY KEY, transition_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL,
			tenant_id TEXT NOT NULL, correlation_id TEXT, payload JSONB NOT NULL,
			occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), drained_at TIMESTAMPTZ)`,
		`CREATE TABLE workspace_webhook_deliveries (
			id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, transition_id TEXT NOT NULL,
			tenant_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL,
			status TEXT NOT NULL, attempt_count INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (webhook_id, transition_id))`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			t.Fatalf("fixture schema: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DROP TABLE IF EXISTS workspace_webhook_deliveries, deploy_events, workspace_webhooks CASCADE`)
	})
}

func seedWebhook(t *testing.T, db *sql.DB, id, tenant, eventsJSON string, revoked bool) {
	t.Helper()
	rev := "NULL"
	if revoked {
		rev = "NOW()"
	}
	if _, err := db.Exec(
		`INSERT INTO workspace_webhooks (id, tenant_id, url, events, secret, revoked_at)
		 VALUES ($1, $2, 'https://hook.example.test', $3::jsonb, 'whsec_x', `+rev+`)`,
		id, tenant, eventsJSON); err != nil {
		t.Fatalf("seed webhook: %v", err)
	}
}

func seedEvent(t *testing.T, db *sql.DB, transition, eventType, tenant string) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO deploy_events (transition_id, event_type, tenant_id, payload)
		 VALUES ($1, $2, $3, '{"status":"success"}'::jsonb)`,
		transition, eventType, tenant); err != nil {
		t.Fatalf("seed event: %v", err)
	}
}

func TestEnqueuer_FansOutAndMarksDrained(t *testing.T) {
	db := enqueuerDB(t)
	fixtureSchema(t, db)
	seedWebhook(t, db, "wwh-1", "tn-a", `["deploy.succeeded","deploy.failed"]`, false)
	seedEvent(t, db, "tr-1", "deploy.succeeded", "tn-a")

	if err := New(db, nil).Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}

	var (
		count          int
		webhookID, tid string
		status         string
	)
	if err := db.QueryRow(`SELECT count(*) FROM workspace_webhook_deliveries`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("deliveries = %d, want 1", count)
	}
	if err := db.QueryRow(
		`SELECT webhook_id, transition_id, status FROM workspace_webhook_deliveries`).
		Scan(&webhookID, &tid, &status); err != nil {
		t.Fatal(err)
	}
	if webhookID != "wwh-1" || tid != "tr-1" || status != "pending" {
		t.Errorf("delivery = (%s,%s,%s); want (wwh-1,tr-1,pending)", webhookID, tid, status)
	}

	var drained sql.NullTime
	if err := db.QueryRow(`SELECT drained_at FROM deploy_events WHERE transition_id='tr-1'`).Scan(&drained); err != nil {
		t.Fatal(err)
	}
	if !drained.Valid {
		t.Error("deploy_events.drained_at not set after fan-out")
	}

	// Idempotent re-tick: the event is drained → no new delivery.
	if err := New(db, nil).Tick(context.Background()); err != nil {
		t.Fatalf("second Tick: %v", err)
	}
	_ = db.QueryRow(`SELECT count(*) FROM workspace_webhook_deliveries`).Scan(&count)
	if count != 1 {
		t.Errorf("deliveries after re-tick = %d, want 1 (drained event must not re-fan)", count)
	}
}

func TestEnqueuer_UnsubscribedEvent_NoDelivery(t *testing.T) {
	db := enqueuerDB(t)
	fixtureSchema(t, db)
	seedWebhook(t, db, "wwh-1", "tn-a", `["deploy.failed"]`, false) // only failed
	seedEvent(t, db, "tr-1", "deploy.succeeded", "tn-a")            // succeeded

	if err := New(db, nil).Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	var count int
	_ = db.QueryRow(`SELECT count(*) FROM workspace_webhook_deliveries`).Scan(&count)
	if count != 0 {
		t.Errorf("deliveries = %d, want 0 (webhook not subscribed to deploy.succeeded)", count)
	}
}

func TestEnqueuer_RevokedWebhook_NoDelivery(t *testing.T) {
	db := enqueuerDB(t)
	fixtureSchema(t, db)
	seedWebhook(t, db, "wwh-1", "tn-a", `["deploy.succeeded"]`, true) // revoked
	seedEvent(t, db, "tr-1", "deploy.succeeded", "tn-a")

	if err := New(db, nil).Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	var count int
	_ = db.QueryRow(`SELECT count(*) FROM workspace_webhook_deliveries`).Scan(&count)
	if count != 0 {
		t.Errorf("deliveries = %d, want 0 (revoked webhook must not receive fan-out)", count)
	}
}

func TestEnqueuer_CrossTenantIsolation(t *testing.T) {
	db := enqueuerDB(t)
	fixtureSchema(t, db)
	seedWebhook(t, db, "wwh-b", "tn-b", `["deploy.succeeded"]`, false) // tenant B's hook
	seedEvent(t, db, "tr-1", "deploy.succeeded", "tn-a")               // tenant A's event

	if err := New(db, nil).Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	var count int
	_ = db.QueryRow(`SELECT count(*) FROM workspace_webhook_deliveries`).Scan(&count)
	if count != 0 {
		t.Errorf("deliveries = %d, want 0 (tenant A's event must NOT reach tenant B's webhook)", count)
	}
}
