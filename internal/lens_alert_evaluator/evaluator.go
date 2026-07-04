// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// SeriesFetcher fetches a tenant's observability series over a window (seconds). In production this mints
// a per-tenant observability:read key via the lens Broker and calls DataClient.Observability; injected so
// the evaluator core is unit-testable without the broker (least-privilege wiring stays at construction).
type SeriesFetcher func(ctx context.Context, tenantID string, windowSeconds int) (json.RawMessage, error)

// Evaluator is the background alert-rule evaluator (theo-lens M53). It ticks periodically, fetches each
// tenant's observability series, evaluates each rule via the pure state machine, and on a fire enqueues a
// workspace_webhook_deliveries row for the existing J-16 worker to dispatch. It NEVER dispatches HTTP
// itself (reuse — Rule 9).
type Evaluator struct {
	db       *sql.DB
	fetch    SeriesFetcher
	logger   *slog.Logger
	now      func() time.Time
	interval time.Duration
}

// New constructs the evaluator. `fetch` is the per-tenant series fetcher (broker+data-client in prod).
func New(db *sql.DB, fetch SeriesFetcher, logger *slog.Logger) *Evaluator {
	if logger == nil {
		logger = slog.Default()
	}
	return &Evaluator{db: db, fetch: fetch, logger: logger, now: time.Now, interval: 60 * time.Second}
}

// alertRule is the subset of lens_alert_rules the evaluator reads.
type alertRule struct {
	id            string
	tenantID      string
	metric        string
	comparator    string
	threshold     float64
	windowSeconds int
	webhookID     string
	status        string
	lastTriggered sql.NullTime
	renotify      sql.NullInt64
}

// Run drives the periodic evaluation loop until ctx is cancelled (graceful shutdown).
func (e *Evaluator) Run(ctx context.Context) {
	ticker := time.NewTicker(e.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := e.Tick(ctx); err != nil {
				e.logger.Warn("lens alert evaluator: tick failed", "error", err)
			}
		}
	}
}

// Tick runs one evaluation pass: for each tenant with enabled rules, fetch the series once per distinct
// window and evaluate each rule. A per-tenant fetch error is logged + skipped (fail-closed: no data → no
// spurious fire), never aborting the whole tick.
func (e *Evaluator) Tick(ctx context.Context) error {
	rows, err := e.db.QueryContext(ctx, `
		SELECT id, tenant_id, metric, comparator, threshold, window_seconds, webhook_id, status,
		       last_triggered_at, renotify_interval_seconds
		FROM lens_alert_rules
		WHERE enabled
		ORDER BY tenant_id`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	// cache the fetched series per (tenant, window) so N rules on one window mint/fetch once.
	type key struct {
		tenant string
		window int
	}
	cache := map[key]json.RawMessage{}
	failed := map[key]bool{}

	for rows.Next() {
		var r alertRule
		if err := rows.Scan(&r.id, &r.tenantID, &r.metric, &r.comparator, &r.threshold, &r.windowSeconds,
			&r.webhookID, &r.status, &r.lastTriggered, &r.renotify); err != nil {
			e.logger.Warn("lens alert evaluator: scan failed", "error", err)
			continue
		}
		k := key{r.tenantID, r.windowSeconds}
		if failed[k] {
			continue
		}
		raw, ok := cache[k]
		if !ok {
			raw, err = e.fetch(ctx, r.tenantID, r.windowSeconds)
			if err != nil {
				e.logger.Warn("lens alert evaluator: fetch failed — skipping tenant window",
					"tenant", r.tenantID, "window", r.windowSeconds, "error", err)
				failed[k] = true
				continue
			}
			cache[k] = raw
		}
		if err := e.processRule(ctx, r, raw); err != nil {
			e.logger.Warn("lens alert evaluator: process rule failed", "rule", r.id, "error", err)
		}
	}
	return rows.Err()
}

// processRule evaluates one rule against its tenant's series, applies the state transition, and — when
// the state machine says fire — atomically wins the transition (conditional UPDATE) and enqueues exactly
// one delivery. Returns whether a delivery was enqueued (for tests). It is the integration seam; the
// decision itself is the pure `nextAlertState`.
func (e *Evaluator) processRule(ctx context.Context, r alertRule, raw json.RawMessage) error {
	var series observabilitySeries
	if err := json.Unmarshal(raw, &series); err != nil {
		return fmt.Errorf("parse series: %w", err)
	}
	value := metricFromSeries(series, r.metric)
	breached := evaluateBreach(value, r.threshold, r.comparator)

	lastTrig := time.Time{}
	if r.lastTriggered.Valid {
		lastTrig = r.lastTriggered.Time
	}
	renotify := 0
	if r.renotify.Valid {
		renotify = int(r.renotify.Int64)
	}
	now := e.now()
	d := nextAlertState(r.status, breached, lastTrig, renotify, now)

	if !d.fire {
		// Record the evaluation + any status change (e.g. TRIGGERED → OK on clear); unconditional.
		_, err := e.db.ExecContext(ctx,
			`UPDATE lens_alert_rules SET status = $1, last_evaluated_at = $2 WHERE id = $3`,
			d.nextStatus, now, r.id)
		return err
	}

	// Fire: the status flip AND the delivery INSERT run in ONE transaction so a failed INSERT rolls back
	// the flip (else the rule would be stuck TRIGGERED with no delivery — a silently-lost alert). The
	// UPDATE atomically WINS the transition (status + last_triggered_at optimistic lock) so a
	// multi-replica evaluator fires exactly once — a losing replica affects 0 rows and commits a no-op.
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }() // no-op after a successful Commit

	var res sql.Result
	if r.status != "TRIGGERED" {
		res, err = tx.ExecContext(ctx,
			`UPDATE lens_alert_rules SET status = 'TRIGGERED', last_triggered_at = $1, last_evaluated_at = $1
			 WHERE id = $2 AND status = 'OK'`, now, r.id)
	} else {
		res, err = tx.ExecContext(ctx,
			`UPDATE lens_alert_rules SET last_triggered_at = $1, last_evaluated_at = $1
			 WHERE id = $2 AND status = 'TRIGGERED' AND last_triggered_at IS NOT DISTINCT FROM $3`,
			now, r.id, r.lastTriggered)
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return tx.Commit() // another replica won the transition — commit the no-op, do not enqueue
	}
	if err := e.enqueueDelivery(ctx, tx, r, value, now); err != nil {
		return err // rolls back the status flip → the next tick retries
	}
	return tx.Commit()
}

// execer is satisfied by both *sql.DB and *sql.Tx — the enqueue runs inside the fire transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// enqueueDelivery inserts one workspace_webhook_deliveries row (the existing J-16 worker dispatches it
// SSRF-guarded). `transition_id` dedups repeated fires of the same rule within a second.
func (e *Evaluator) enqueueDelivery(ctx context.Context, ex execer, r alertRule, value float64, now time.Time) error {
	payload, _ := json.Marshal(map[string]any{
		"rule_id":    r.id,
		"tenant_id":  r.tenantID,
		"metric":     r.metric,
		"comparator": r.comparator,
		"threshold":  r.threshold,
		"value":      value,
		"fired_at":   now.UTC().Format(time.RFC3339),
	})
	transitionID := fmt.Sprintf("alert-%s-%d", r.id, now.Unix())
	_, err := ex.ExecContext(ctx,
		`INSERT INTO workspace_webhook_deliveries
		   (id, webhook_id, transition_id, tenant_id, event_type, payload, status, next_attempt_at)
		 VALUES ($1, $2, $3, $4, 'alert.threshold_breached', $5, 'pending', NOW())
		 ON CONFLICT (webhook_id, transition_id) DO NOTHING`,
		"wwd-"+randomHex16(), r.webhookID, transitionID, r.tenantID, payload)
	return err
}

// randomHex16 returns 16 hex chars (8 random bytes) for a delivery id. Local to avoid importing the
// routes package (the same idiom lives there for webhook ids).
func randomHex16() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "0000000000000000"
	}
	return hex.EncodeToString(b)
}
