// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package workspace_webhook_worker dispatches workspace_webhook_deliveries
// (engine migration 000052) to customer-registered URLs — the final stage of
// the J-16 webhook-delivery pipeline (Option C, MEET-2026-07-03-005).
//
// It mirrors memory_webhook_worker and REUSES its exported, well-tested
// primitives (Dispatch / NextBackoff / IsTerminalAttempt / Delivery /
// DispatchResult) so the signing + retry + single-attempt HTTP logic is not
// duplicated (DRY). It adds the two things the memory worker lacks, per the
// slice-3 distributed-systems review:
//
//   - a per-attempt LEASE (claimed_at / claimed_by), and
//   - a VISIBILITY-TIMEOUT REAPER that resets rows stuck in 'delivering' past
//     the lease (worker crash / shutdown mid-dispatch) — closing the permanent
//     'delivering'-orphan class.
//
// The HTTP client is safehttp's SSRF-guarded client (rejects the resolved
// destination IP if internal, no redirects) — the delivery target is a
// customer-controlled URL (theo-cloud#149).
package workspace_webhook_worker

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	mww "github.com/usetheodev/theo-cloud/internal/memory_webhook_worker"
	"github.com/usetheodev/theo-cloud/internal/metrics"
	"github.com/usetheodev/theo-cloud/internal/safehttp"
)

const (
	defaultPollInterval      = 5 * time.Second
	defaultMaxInFlight       = 10
	defaultClaimBatch        = 50
	defaultHTTPClientTimeout = 35 * time.Second
	// leaseTimeout bounds how long a row may sit in 'delivering' before the
	// reaper reclaims it: > the 30s per-attempt timeout + record margin.
	leaseTimeout = 90 * time.Second
)

// Worker is the background dispatcher for workspace_webhook_deliveries.
type Worker struct {
	db        *sql.DB
	logger    *slog.Logger
	replicaID string
	semaCh    chan struct{}
	inflight  sync.WaitGroup
	httpc     *http.Client
}

// New constructs a Worker with the SSRF-guarded delivery client.
func New(db *sql.DB, logger *slog.Logger, replicaID string) *Worker {
	if logger == nil {
		logger = slog.Default()
	}
	if replicaID == "" {
		replicaID = "worker"
	}
	return &Worker{
		db:        db,
		logger:    logger,
		replicaID: replicaID,
		semaCh:    make(chan struct{}, defaultMaxInFlight),
		// The SSRF guard's rejections feed theo_workspace_webhook_ssrf_rejected_total
		// (wiring-triad security metric, MEET-2026-07-03-005) — any non-zero value
		// in prod is a probe/misconfig signal worth a log correlation.
		httpc: safehttp.NewClient(defaultHTTPClientTimeout,
			safehttp.WithRejectionObserver(metrics.IncWorkspaceWebhookSSRFRejected)),
	}
}

// Run enters the poll loop until ctx is canceled, draining in-flight
// dispatches before returning.
func (w *Worker) Run(ctx context.Context) {
	w.logger.Info("workspace webhook worker started", "poll_interval", defaultPollInterval, "replica", w.replicaID)
	ticker := time.NewTicker(defaultPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			w.logger.Info("workspace webhook worker: draining")
			w.inflight.Wait()
			w.logger.Info("workspace webhook worker stopped")
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

// tick reaps stale leases, then claims + dispatches a batch.
func (w *Worker) tick(ctx context.Context) {
	if n, err := w.reapStaleLeases(ctx); err != nil {
		w.logger.Warn("workspace webhook worker: reap failed", "error", err)
	} else if n > 0 {
		w.logger.Info("workspace webhook worker: reaped stale leases", "count", n)
	}
	deliveries, err := w.claimDue(ctx, defaultClaimBatch)
	if err != nil {
		w.logger.Warn("workspace webhook worker: claim failed", "error", err)
		return
	}
	for _, d := range deliveries {
		select {
		case <-ctx.Done():
			return
		case w.semaCh <- struct{}{}:
			w.inflight.Add(1)
			go func(dd *mww.Delivery) {
				defer func() { <-w.semaCh; w.inflight.Done() }()
				result := mww.Dispatch(ctx, w.httpc, w.logger, dd)
				w.recordResult(dd, result)
			}(d)
		}
	}
}

// reapStaleLeases resets rows stuck in 'delivering' past the lease timeout back
// to 'failed' (due now), so a crashed worker's claims are retried rather than
// orphaned forever. Returns the number reaped.
func (w *Worker) reapStaleLeases(ctx context.Context) (int64, error) {
	res, err := w.db.ExecContext(ctx, `
		UPDATE workspace_webhook_deliveries
		SET status='failed', next_attempt_at=NOW(), claimed_at=NULL, claimed_by=NULL
		WHERE status='delivering' AND claimed_at < NOW() - $1::interval`,
		fmt.Sprintf("%d seconds", int(leaseTimeout.Seconds())))
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// claimDue selects due deliveries with FOR UPDATE SKIP LOCKED (multi-replica
// safe) and marks each 'delivering' with a lease (claimed_at/claimed_by), all
// in one tx. Each row is loaded with its parent webhook's url + secret.
func (w *Worker) claimDue(ctx context.Context, limit int) ([]*mww.Delivery, error) {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	const sel = `
		SELECT d.id, d.webhook_id, w.url, w.secret, d.event_type, d.payload, d.attempt_count
		FROM workspace_webhook_deliveries d
		JOIN workspace_webhooks w ON w.id = d.webhook_id
		WHERE d.status IN ('pending','failed')
		  AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
		  AND w.revoked_at IS NULL
		ORDER BY d.next_attempt_at NULLS FIRST
		LIMIT $1
		FOR UPDATE SKIP LOCKED`
	rows, err := tx.QueryContext(ctx, sel, limit)
	if err != nil {
		return nil, err
	}
	var deliveries []*mww.Delivery
	for rows.Next() {
		d := &mww.Delivery{}
		if err := rows.Scan(&d.ID, &d.WebhookID, &d.URL, &d.Secret, &d.EventType, &d.Payload, &d.AttemptCount); err != nil {
			_ = rows.Close()
			return nil, err
		}
		deliveries = append(deliveries, d)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	for _, d := range deliveries {
		if _, err := tx.ExecContext(ctx,
			`UPDATE workspace_webhook_deliveries SET status='delivering', claimed_at=NOW(), claimed_by=$2 WHERE id=$1`,
			d.ID, w.replicaID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return deliveries, nil
}

// recordResult updates the delivery row from the dispatch outcome, clearing the
// lease on every transition. Mirrors memory_webhook_worker.recordResult on the
// workspace table + lease-aware.
func (w *Worker) recordResult(d *mww.Delivery, r mww.DispatchResult) {
	bg, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	newAttempt := d.AttemptCount + 1

	if r.Delivered {
		_, _ = w.db.ExecContext(bg, `
			UPDATE workspace_webhook_deliveries
			SET status='delivered', attempt_count=$1, last_response_status=$2, last_response_body=$3,
			    last_error_message=NULL, next_attempt_at=NULL, claimed_at=NULL, claimed_by=NULL, completed_at=NOW()
			WHERE id=$4`, newAttempt, r.StatusCode, r.Body, d.ID)
		metrics.IncWorkspaceWebhookDelivery("delivered")
		return
	}

	statusValue := sql.NullInt64{Int64: int64(r.StatusCode), Valid: r.StatusCode != 0}
	if mww.IsTerminalAttempt(newAttempt) {
		_, _ = w.db.ExecContext(bg, `
			UPDATE workspace_webhook_deliveries
			SET status='dead_letter', attempt_count=$1, last_response_status=$2, last_response_body=$3,
			    last_error_message=$4, next_attempt_at=NULL, claimed_at=NULL, claimed_by=NULL, completed_at=NOW()
			WHERE id=$5`, newAttempt, statusValue, r.Body, r.ErrorMessage, d.ID)
		metrics.IncWorkspaceWebhookDelivery("dead_letter")
		w.logger.Warn("workspace webhook delivery dead-lettered", "delivery_id", d.ID, "webhook_id", d.WebhookID, "attempts", newAttempt)
		return
	}

	nextAt := time.Now().Add(mww.NextBackoff(newAttempt))
	_, _ = w.db.ExecContext(bg, `
		UPDATE workspace_webhook_deliveries
		SET status='failed', attempt_count=$1, last_response_status=$2, last_response_body=$3,
		    last_error_message=$4, next_attempt_at=$5, claimed_at=NULL, claimed_by=NULL
		WHERE id=$6`, newAttempt, statusValue, r.Body, r.ErrorMessage, nextAt, d.ID)
	metrics.IncWorkspaceWebhookDelivery("failed")
}
