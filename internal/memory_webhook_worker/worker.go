// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package memory_webhook_worker

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Defaults — overridable via Config when constructing Worker.
const (
	defaultPollInterval = 5 * time.Second
	defaultMaxInFlight  = 10
	// Claim only what we can immediately dispatch (== MaxInFlight). If the claim
	// batch exceeds in-flight concurrency, batch-tail rows block in the semaphore
	// while their lease clock runs — the reaper could then reclaim a row this
	// worker still holds → concurrent double-delivery (theo-cloud#160 B1). New()
	// clamps a custom ClaimBatch down to MaxInFlight to preserve this invariant.
	defaultClaimBatch        = defaultMaxInFlight
	defaultHTTPClientTimeout = 35 * time.Second // > httpAttemptTimeout (30s) so the client doesn't kill mid-flight
	// leaseTimeout bounds how long a row may sit in 'delivering' before the
	// reaper reclaims it. Larger than the worst-case single dispatch (~55s: 30s
	// attempt ctx + dial + record) so a LIVE dispatch is never reaped — only a
	// crashed worker's permanent orphan is (theo-cloud#160).
	defaultLeaseTimeout = 90 * time.Second
)

// Config tunes the worker. Zero values fall back to defaults.
type Config struct {
	PollInterval time.Duration
	MaxInFlight  int
	ClaimBatch   int
	HTTPClient   *http.Client
}

// Worker is the background dispatcher for memory_webhook_deliveries.
// Per D4: single goroutine + worker-pool semaphore with bounded
// concurrency. Started once at cloud service startup; shutdown via
// context cancellation.
type Worker struct {
	db       *sql.DB
	logger   *slog.Logger
	cfg      Config
	semaCh   chan struct{}
	inflight sync.WaitGroup
	httpc    *http.Client
}

// New constructs a Worker. Pass nil cfg for defaults.
func New(db *sql.DB, logger *slog.Logger, cfg *Config) *Worker {
	if logger == nil {
		logger = slog.Default()
	}
	c := Config{
		PollInterval: defaultPollInterval,
		MaxInFlight:  defaultMaxInFlight,
		ClaimBatch:   defaultClaimBatch,
	}
	if cfg != nil {
		if cfg.PollInterval > 0 {
			c.PollInterval = cfg.PollInterval
		}
		if cfg.MaxInFlight > 0 {
			c.MaxInFlight = cfg.MaxInFlight
		}
		if cfg.ClaimBatch > 0 {
			c.ClaimBatch = cfg.ClaimBatch
		}
		if cfg.HTTPClient != nil {
			c.HTTPClient = cfg.HTTPClient
		}
	}
	if c.HTTPClient == nil {
		c.HTTPClient = &http.Client{Timeout: defaultHTTPClientTimeout}
	}
	// Invariant (theo-cloud#160 B1): never claim more than we can immediately
	// dispatch, else batch-tail rows expire their lease while queued and the
	// reaper double-fires them.
	if c.ClaimBatch > c.MaxInFlight {
		c.ClaimBatch = c.MaxInFlight
	}
	return &Worker{
		db:     db,
		logger: logger,
		cfg:    c,
		semaCh: make(chan struct{}, c.MaxInFlight),
		httpc:  c.HTTPClient,
	}
}

// Run enters the poll loop. Blocks until ctx is canceled, at which point
// it waits for in-flight dispatches to finish before returning.
func (w *Worker) Run(ctx context.Context) {
	w.logger.Info("memory webhook worker started",
		"poll_interval", w.cfg.PollInterval,
		"max_in_flight", w.cfg.MaxInFlight,
	)
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("memory webhook worker: draining")
			w.inflight.Wait()
			w.logger.Info("memory webhook worker stopped")
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

// tick claims a batch of due deliveries and dispatches each via a
// semaphore-bounded goroutine.
func (w *Worker) tick(ctx context.Context) {
	if n, err := w.reapStaleDeliveries(ctx); err != nil {
		w.logger.Warn("memory webhook worker: reap failed", "error", err)
	} else if n > 0 {
		w.logger.Info("memory webhook worker: reaped stale leases", "count", n)
	}
	deliveries, err := w.claimDue(ctx, w.cfg.ClaimBatch)
	if err != nil {
		w.logger.Warn("memory webhook worker: claim failed", "error", err)
		return
	}
	for _, d := range deliveries {
		select {
		case <-ctx.Done():
			return
		case w.semaCh <- struct{}{}:
			w.inflight.Add(1)
			go w.dispatch(ctx, d)
		}
	}
}

// dispatch is the per-delivery goroutine. Releases the semaphore on exit.
func (w *Worker) dispatch(ctx context.Context, d *Delivery) {
	defer func() {
		<-w.semaCh
		w.inflight.Done()
	}()

	result := Dispatch(ctx, w.httpc, w.logger, d)
	w.recordResult(ctx, d, result)
}

// claimDue selects + marks `status='delivering'` on up to limit due rows
// in a single tx. Each row is loaded with its parent webhook's URL and
// secret. Atomicity ensures no double-dispatch even if multiple ticks
// race (single-replica deployment per D4 — multi-replica needs leader
// election in a future plan).
func (w *Worker) claimDue(ctx context.Context, limit int) ([]*Delivery, error) {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	const sel = `
		SELECT d.id, d.webhook_id, w.url, w.secret, d.event_type, d.payload, d.attempt_count
		FROM memory_webhook_deliveries d
		JOIN memory_webhooks w ON w.id = d.webhook_id
		WHERE d.status IN ('pending', 'failed')
		  AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
		  AND w.revoked_at IS NULL
		ORDER BY d.next_attempt_at NULLS FIRST
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`
	rows, err := tx.QueryContext(ctx, sel, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var deliveries []*Delivery
	for rows.Next() {
		d := &Delivery{}
		if err := rows.Scan(&d.ID, &d.WebhookID, &d.URL, &d.Secret, &d.EventType, &d.Payload, &d.AttemptCount); err != nil {
			return nil, err
		}
		deliveries = append(deliveries, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	_ = rows.Close()

	// Mark each as delivering + stamp a lease deadline on next_attempt_at (which
	// claimDue never reads for a 'delivering' row) so the reaper can distinguish
	// a live in-flight row (deadline future) from a crashed orphan (deadline
	// past) without a claimed_at column (theo-cloud#160).
	leaseSecs := int(defaultLeaseTimeout.Seconds())
	for _, d := range deliveries {
		if _, err := tx.ExecContext(ctx,
			`UPDATE memory_webhook_deliveries
			 SET status='delivering', next_attempt_at = NOW() + make_interval(secs => $2)
			 WHERE id=$1`, d.ID, leaseSecs); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if len(deliveries) == 0 {
		return nil, nil
	}
	return deliveries, nil
}

// reapStaleDeliveries reclaims rows stuck in 'delivering' past their lease
// deadline (next_attempt_at) — a worker that crashed mid-dispatch. Each is
// treated as a real failed attempt: counted, backed off, and dead-lettered at
// the cap (reusing NextBackoff/IsTerminalAttempt, DRY), so an orphaned delivery
// is retried instead of silently lost forever (theo-cloud#160). Because the
// claim batch is capped at MaxInFlight, a LIVE dispatch never outlives its lease
// — the reaper only ever touches genuinely-crashed orphans (whose worker is gone
// and will not write), so no lost-update guard is needed. Returns the count.
func (w *Worker) reapStaleDeliveries(ctx context.Context) (int64, error) {
	rows, err := w.db.QueryContext(ctx,
		`SELECT id, attempt_count FROM memory_webhook_deliveries
		 WHERE status='delivering' AND next_attempt_at IS NOT NULL AND next_attempt_at < NOW()`)
	if err != nil {
		return 0, err
	}
	type stale struct {
		id      string
		attempt int
	}
	var staleRows []stale
	for rows.Next() {
		var s stale
		if err := rows.Scan(&s.id, &s.attempt); err != nil {
			_ = rows.Close()
			return 0, err
		}
		staleRows = append(staleRows, s)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	_ = rows.Close()

	const reapErr = "delivery lease expired (worker crash/stall)"
	var reaped int64
	for _, s := range staleRows {
		newAttempt := s.attempt + 1
		var res sql.Result
		if IsTerminalAttempt(newAttempt) {
			res, err = w.db.ExecContext(ctx,
				`UPDATE memory_webhook_deliveries
				 SET status='dead_letter', attempt_count=$1, next_attempt_at=NULL, completed_at=NOW()
				 WHERE id=$2 AND status='delivering'`, newAttempt, s.id)
		} else {
			nextAt := time.Now().Add(NextBackoff(newAttempt))
			res, err = w.db.ExecContext(ctx,
				`UPDATE memory_webhook_deliveries
				 SET status='failed', attempt_count=$1, next_attempt_at=$2
				 WHERE id=$3 AND status='delivering'`, newAttempt, nextAt, s.id)
		}
		if err != nil {
			w.logger.Warn("memory webhook worker: reap update failed", "delivery_id", s.id, "error", err)
			continue
		}
		if n, _ := res.RowsAffected(); n > 0 {
			reaped++
		}
	}
	return reaped, nil
}

// recordResult updates the delivery row based on the dispatch outcome.
func (w *Worker) recordResult(ctx context.Context, d *Delivery, r DispatchResult) {
	bg, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Ignore the inbound ctx for the audit write — if the worker is
	// shutting down, we still want the row updated.
	_ = ctx

	newAttemptCount := d.AttemptCount + 1
	if r.Delivered {
		_, err := w.db.ExecContext(bg,
			`UPDATE memory_webhook_deliveries
			 SET status='delivered',
			     attempt_count=$1,
			     last_response_status=$2,
			     last_response_body=$3,
			     last_error_message=NULL,
			     next_attempt_at=NULL,
			     completed_at=NOW()
			 WHERE id=$4`,
			newAttemptCount, r.StatusCode, r.Body, d.ID,
		)
		if err != nil {
			w.logger.Warn("memory webhook delivery: mark delivered failed", "error", err, "id", d.ID)
		}
		return
	}

	// Non-delivered branch.
	statusValue := sql.NullInt64{Int64: int64(r.StatusCode), Valid: r.StatusCode != 0}
	if IsTerminalAttempt(newAttemptCount) {
		// 9 attempts exhausted → dead_letter.
		_, err := w.db.ExecContext(bg,
			`UPDATE memory_webhook_deliveries
			 SET status='dead_letter',
			     attempt_count=$1,
			     last_response_status=$2,
			     last_response_body=$3,
			     last_error_message=$4,
			     next_attempt_at=NULL,
			     completed_at=NOW()
			 WHERE id=$5`,
			newAttemptCount, statusValue, r.Body, r.ErrorMessage, d.ID,
		)
		if err != nil {
			w.logger.Warn("memory webhook delivery: mark dead_letter failed", "error", err, "id", d.ID)
		}
		return
	}

	// Retry scheduled.
	delay := NextBackoff(newAttemptCount)
	nextAt := time.Now().Add(delay)
	_, err := w.db.ExecContext(bg,
		`UPDATE memory_webhook_deliveries
		 SET status='failed',
		     attempt_count=$1,
		     last_response_status=$2,
		     last_response_body=$3,
		     last_error_message=$4,
		     next_attempt_at=$5
		 WHERE id=$6`,
		newAttemptCount, statusValue, r.Body, r.ErrorMessage, nextAt, d.ID,
	)
	if err != nil {
		w.logger.Warn("memory webhook delivery: mark failed-retry failed", "error", err, "id", d.ID)
	}
}

// ErrAlreadyRunning is reserved for a future plan where Run is
// idempotent / re-entrant. v0.1 callers MUST start Run only once.
var ErrAlreadyRunning = errors.New("worker already running")
