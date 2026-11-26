// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Package deploy_event_enqueuer drains the deploy_events transactional outbox
// (engine migration 000051) and fans each event out to the subscribed
// workspace_webhooks (000050) as workspace_webhook_deliveries (000052) rows.
//
// This is the CONSUMER half of the J-16 webhook-delivery pipeline (Option C,
// MEET-2026-07-03-005): the engine emits generic deploy events on the release
// tx; this loop (in loop-console) turns them into per-webhook deliveries that the
// delivery worker then dispatches. Keeping fan-out here — not in the engine —
// preserves the decoupling invariant (the engine never references the webhook
// tables).
//
// It performs NO outbound HTTP (that is the delivery worker's job) — it is pure
// DB fan-out, so it needs no SSRF guard.
package deploy_event_enqueuer

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/getloopscale/loop-console/internal/metrics"
)

const (
	defaultPollInterval = 5 * time.Second
	defaultDrainBatch   = 100
	deliveryIDPrefix    = "wwd-"
)

// Enqueuer is the background deploy-events → deliveries fan-out loop.
type Enqueuer struct {
	db           *sql.DB
	logger       *slog.Logger
	pollInterval time.Duration
	drainBatch   int
}

// New constructs the enqueuer. logger may be nil.
func New(db *sql.DB, logger *slog.Logger) *Enqueuer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Enqueuer{
		db:           db,
		logger:       logger,
		pollInterval: defaultPollInterval,
		drainBatch:   defaultDrainBatch,
	}
}

// Run polls until ctx is canceled.
func (e *Enqueuer) Run(ctx context.Context) {
	e.logger.Info("deploy-event enqueuer started", "poll_interval", e.pollInterval)
	ticker := time.NewTicker(e.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			e.logger.Info("deploy-event enqueuer stopped")
			return
		case <-ticker.C:
			if err := e.Tick(ctx); err != nil {
				e.logger.Warn("deploy-event enqueuer: tick failed", "error", err)
			}
		}
	}
}

// Tick drains one batch of undrained deploy_events, fanning each out to matching
// webhooks and marking it drained — all in a single tx per batch. Exposed for
// tests. Returns the number of events drained.
func (e *Enqueuer) Tick(ctx context.Context) error {
	_, err := e.drainBatchTx(ctx)
	return err
}

// event is one undrained outbox row.
type event struct {
	id            int64
	transitionID  string
	eventType     string
	tenantID      string
	correlationID sql.NullString
	payload       []byte
}

// drainBatchTx claims up to drainBatch undrained events with FOR UPDATE SKIP
// LOCKED (multi-replica safe — two enqueuer replicas never claim the same
// event), fans each out, and marks it drained, atomically.
func (e *Enqueuer) drainBatchTx(ctx context.Context) (int, error) {
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	const sel = `
		SELECT id, transition_id, event_type, tenant_id, correlation_id, payload
		FROM deploy_events
		WHERE drained_at IS NULL
		ORDER BY id
		LIMIT $1
		FOR UPDATE SKIP LOCKED`
	rows, err := tx.QueryContext(ctx, sel, e.drainBatch)
	if err != nil {
		return 0, err
	}
	var events []event
	for rows.Next() {
		var ev event
		if err := rows.Scan(&ev.id, &ev.transitionID, &ev.eventType, &ev.tenantID, &ev.correlationID, &ev.payload); err != nil {
			_ = rows.Close()
			return 0, err
		}
		events = append(events, ev)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	_ = rows.Close()

	for _, ev := range events {
		if err := e.fanOut(ctx, tx, ev); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE deploy_events SET drained_at = NOW() WHERE id = $1`, ev.id); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(events), nil
}

// fanOut inserts one delivery per active webhook subscribed to ev.eventType for
// ev.tenantID. ON CONFLICT (webhook_id, transition_id) DO NOTHING makes the
// fan-out idempotent: re-draining the same event never double-enqueues (the
// engine's outbox is at-least-once; this makes delivery effectively once).
func (e *Enqueuer) fanOut(ctx context.Context, tx *sql.Tx, ev event) error {
	// jsonb `?` containment: the webhook's events array contains the event type.
	const sel = `
		SELECT id FROM workspace_webhooks
		WHERE tenant_id = $1 AND events ? $2 AND revoked_at IS NULL`
	rows, err := tx.QueryContext(ctx, sel, ev.tenantID, ev.eventType)
	if err != nil {
		return err
	}
	var webhookIDs []string
	for rows.Next() {
		var wid string
		if err := rows.Scan(&wid); err != nil {
			_ = rows.Close()
			return err
		}
		webhookIDs = append(webhookIDs, wid)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()

	for _, wid := range webhookIDs {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO workspace_webhook_deliveries
			  (id, webhook_id, transition_id, tenant_id, event_type, payload, status, next_attempt_at)
			VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
			ON CONFLICT (webhook_id, transition_id) DO NOTHING`,
			deliveryIDPrefix+randomHex16(), wid, ev.transitionID, ev.tenantID, ev.eventType, ev.payload,
		)
		if err != nil {
			return err
		}
		// Count only rows actually enqueued (ON CONFLICT no-ops don't count) —
		// the wiring-triad runtime metric (MEET-2026-07-03-005).
		if n, _ := res.RowsAffected(); n > 0 {
			metrics.IncWorkspaceWebhookEnqueued(ev.eventType)
		}
	}
	return nil
}

// randomHex16 returns 16 hex chars from 8 crypto-random bytes.
func randomHex16() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
