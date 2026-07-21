// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/usetheodev/theo-cloud/internal/metrics"
	"time"
)

// SeriesFetcher fetches a tenant's observability series over a window (seconds). In production this mints
// a per-tenant observability:read key via the lens Broker and calls DataClient.Observability; injected so
// the evaluator core is unit-testable without the broker (least-privilege wiring stays at construction).
type SeriesFetcher func(ctx context.Context, tenantID string, windowSeconds int) (json.RawMessage, error)

// MetricGuardBreach is the sentinel metric of a guard-backed rule (M135). Such a rule thresholds the
// number of traces that breached a theo-lens guard in the window, instead of a workspace aggregate.
const MetricGuardBreach = "guard_breach"

// GuardBreachWindow mirrors theo-lens `GET /v1/guards/:id/breach-window`.
//
// HasData is the load-bearing field. A window where traces WERE evaluated and none breached
// (HasData true, BreachCount 0) is a MEASUREMENT of zero; a window with nothing to evaluate
// (HasData false) is ABSENCE. Collapsing the two is #247: an empty window read as a real zero and
// fired every below-threshold rule permanently — in exactly the tenants whose traffic had stopped.
type GuardBreachWindow struct {
	BreachCount    int  `json:"breachCount"`
	EvaluatedCount int  `json:"evaluatedCount"`
	HasData        bool `json:"hasData"`
}

// GuardBreachFetcher fetches one guard's windowed breach summary. Injected for the same reason as
// SeriesFetcher: the evaluator core stays unit-testable without the broker.
type GuardBreachFetcher func(ctx context.Context, tenantID, guardID string, windowSeconds int) (GuardBreachWindow, error)

// Evaluator is the background alert-rule evaluator (theo-lens M53). It ticks periodically, fetches each
// tenant's observability series, evaluates each rule via the pure state machine, and on a fire enqueues a
// workspace_webhook_deliveries row for the existing J-16 worker to dispatch. It NEVER dispatches HTTP
// itself (reuse — Rule 9).
type Evaluator struct {
	db         *sql.DB
	fetch      SeriesFetcher
	fetchGuard GuardBreachFetcher
	logger   *slog.Logger
	now      func() time.Time
	interval time.Duration
}

// ErrGuardNotFound is the DEFINITIVE "this guard no longer exists" answer, as distinct from any
// transport failure. The distinction is the same discipline HasData applies to absence-vs-zero: a
// transient failure self-heals and must be retried; a deleted guard never does and must stop
// pretending to be armed. Collapsing the two into one `error` is how a rule goes dark forever.
var ErrGuardNotFound = errors.New("lens alert evaluator: guard not found")

// guardFetchTimeout bounds ONE carrier call. Tick is a single sequential loop, so without this an
// unresponsive theo-lens serializes N guard rules inside one tick and stalls the series-backed
// rules queued behind them — rules that have no theo-lens dependency at all. A scoped dependency
// failure would become a fleet-wide alerting outage.
const guardFetchTimeout = 5 * time.Second

// guardFailureBudget stops the remaining guard rules for THIS tick after K consecutive carrier
// failures. Same shape as the series path's `failed` map: bound the damage in-tick, carry no state
// across ticks. 500 rules against a hung lens is ~42min with only a per-call timeout; ~15s with this.
const guardFailureBudget = 3

// New constructs the evaluator. Both fetchers are REQUIRED positional arguments, deliberately: an
// optional guard fetcher is how the feature shipped nil in production once already, making every
// guard-backed rule permanently dead while reading "armed" on the customer's screen. A compile
// error is a better gate than a runtime warning.
func New(db *sql.DB, fetch SeriesFetcher, fetchGuard GuardBreachFetcher, logger *slog.Logger) *Evaluator {
	if logger == nil {
		logger = slog.Default()
	}
	return &Evaluator{db: db, fetch: fetch, fetchGuard: fetchGuard, logger: logger,
		now: time.Now, interval: 60 * time.Second}
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
	guardID       sql.NullString
}

// guardKey caches one carrier answer per (tenant, guard, window) within a tick.
type guardKey struct {
	tenant string
	guard  string
	window int
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
		       last_triggered_at, renotify_interval_seconds, guard_id
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

	// The guard path caches by (tenant, guard, window) for the same reason the series path caches
	// by (tenant, window): N rules on one guard must not mint N keys and issue N calls.
	type guardKeyT = guardKey
	guardCache := map[guardKeyT]GuardBreachWindow{}
	guardFailures := 0

	for rows.Next() {
		var r alertRule
		if err := rows.Scan(&r.id, &r.tenantID, &r.metric, &r.comparator, &r.threshold, &r.windowSeconds,
			&r.webhookID, &r.status, &r.lastTriggered, &r.renotify, &r.guardID); err != nil {
			e.logger.Warn("lens alert evaluator: scan failed", "error", err)
			continue
		}
		// M135: a guard-backed rule reads the per-guard carrier, not the workspace series. The
		// series is a workspace aggregate returning one float per window and cannot answer a
		// per-guard question — hence a second fetcher rather than a new metric case.
		if r.metric == MetricGuardBreach {
			// Unreachable once migration 000058's pairing CHECK is applied — kept as belt-and-braces
			// so a reader does not infer the database permits this state.
			if e.fetchGuard == nil || !r.guardID.Valid {
				metrics.IncLensAlertEvaluation("unwired")
				e.logger.Error("lens alert evaluator: guard rule cannot be evaluated — no fetcher or no guard id",
					"rule", r.id)
				continue
			}
			if guardFailures >= guardFailureBudget {
				// In-tick bulkhead: the carrier is clearly unwell; stop burning the tick budget on
				// it so series-backed rules — which do not depend on theo-lens at all — still run.
				metrics.IncLensAlertEvaluation("fetch_error")
				continue
			}
			gk := guardKey{r.tenantID, r.guardID.String, r.windowSeconds}
			w, cached := guardCache[gk]
			if !cached {
				fctx, cancel := context.WithTimeout(ctx, guardFetchTimeout)
				var ferr error
				w, ferr = e.fetchGuard(fctx, r.tenantID, r.guardID.String, r.windowSeconds)
				cancel()
				if ferr != nil {
					// A DEFINITIVE 404 is not a transient failure: the guard is gone and no number
					// of retries brings it back. Disable the rule so the customer sees a disabled
					// rule instead of an armed one that can never fire — an honest downgrade. A
					// transport error keeps skipping, because auto-disabling on a blip would
					// permanently disarm every guard rule in the fleet.
					if errors.Is(ferr, ErrGuardNotFound) {
						metrics.IncLensAlertEvaluation("guard_missing")
						e.logger.Warn("lens alert evaluator: guard no longer exists — disabling rule",
							"rule", r.id, "guard", r.guardID.String)
						if _, derr := e.db.ExecContext(ctx,
							`UPDATE lens_alert_rules SET enabled = FALSE WHERE id = $1`, r.id); derr != nil {
							e.logger.Warn("lens alert evaluator: disable failed", "rule", r.id, "error", derr)
						}
						continue
					}
					// Fail-closed: a failed fetch is absence, never zero. Deliberately NOT stamping
					// last_evaluated_at — the freeze IS the durable outage signal.
					guardFailures++
					metrics.IncLensAlertEvaluation("fetch_error")
					e.logger.Warn("lens alert evaluator: guard fetch failed — skipping rule",
						"rule", r.id, "guard", r.guardID.String, "error", ferr)
					continue
				}
				guardCache[gk] = w
			}
			if w.HasData {
				metrics.IncLensAlertEvaluation("ok")
			} else {
				metrics.IncLensAlertEvaluation("no_data")
			}
			if perr := e.processGuardRule(ctx, r, w); perr != nil {
				e.logger.Warn("lens alert evaluator: process guard rule failed", "rule", r.id, "error", perr)
			}
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
	value, ok := metricFromSeries(series, r.metric)
	if !ok {
		// No data in the window (or an unrecognised metric). Never evaluated as a measurement —
		// that is #247. But the rule WAS looked at, so the evaluation is recorded: freezing
		// last_evaluated_at would make the screen claim we stopped checking, which is a second
		// silent lie of the same family as the first.
		return e.recordEvaluation(ctx, r)
	}
	return e.decide(ctx, r, value)
}

// processGuardRule is the guard-backed twin of processRule (M135). It resolves the number from the
// windowed breach summary and hands it to the SAME decision path — the state machine, the atomic
// transition and the delivery enqueue are reused verbatim.
func (e *Evaluator) processGuardRule(ctx context.Context, r alertRule, w GuardBreachWindow) error {
	if !w.HasData {
		// Absence, not zero. Not evaluating here is the whole reason the carrier reports HasData at
		// all; thresholding BreachCount==0 from an empty window is #247 with a different source.
		// The evaluation itself is still recorded — see recordEvaluation.
		return e.recordEvaluation(ctx, r)
	}
	return e.decide(ctx, r, float64(w.BreachCount))
}

// recordEvaluation stamps last_evaluated_at without touching status, for a window that held no
// measurement. "We looked and there was nothing" and "we stopped looking" are different facts and
// the screen must be able to tell them apart.
func (e *Evaluator) recordEvaluation(ctx context.Context, r alertRule) error {
	_, err := e.db.ExecContext(ctx,
		`UPDATE lens_alert_rules SET last_evaluated_at = $1 WHERE id = $2`, e.now(), r.id)
	return err
}

// decide applies the pure state machine to an already-resolved value and performs the transition.
// Splitting it out is what lets a guard rule reuse the anti-storm machinery rather than grow a
// second copy of it — the reuse boundary the milestone turns on.
func (e *Evaluator) decide(ctx context.Context, r alertRule, value float64) error {
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
		// Record the evaluation + any status change (e.g. TRIGGERED → OK on clear), FENCED on the
		// state we read (#248). It used to be unconditional, which let a replica holding a stale
		// non-breaching read reset a TRIGGERED another replica had just latched — and because
		// transition_id is `alert-{rule}-{unix-second}`, the resulting re-fire got a fresh id and
		// ON CONFLICT did not dedupe it. An alert storm out of the anti-storm machinery.
		//
		// transition_id is defence-in-depth; the conditional UPDATE is the only real serialization
		// point, so BOTH write paths must use it. Zero rows means another replica moved the rule
		// since our read: a no-op, not an error.
		//
		// The monotone last_evaluated_at clause is not cosmetic. A frozen last_evaluated_at is the
		// only durable signal that evaluation stopped, so a late writer must never rewind it nor
		// refresh it in a way that masks an outage.
		_, err := e.db.ExecContext(ctx,
			`UPDATE lens_alert_rules SET status = $1, last_evaluated_at = $2
			 WHERE id = $3
			   AND status = $4
			   AND last_triggered_at IS NOT DISTINCT FROM $5
			   AND (last_evaluated_at IS NULL OR last_evaluated_at <= $2)`,
			d.nextStatus, now, r.id, r.status, r.lastTriggered)
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
	// M84: the delivery enqueue AND the fired-alert history row run in the SAME transaction as the
	// status flip — a breach yields exactly one delivery AND one history row, or none (all-or-nothing).
	deliveryID, transitionID := deliveryIDFor(), transitionIDFor(r.id, now)
	if err := e.enqueueDelivery(ctx, tx, r, value, now, deliveryID, transitionID); err != nil {
		return err // rolls back the status flip → the next tick retries
	}
	if err := e.insertFiredAlert(ctx, tx, r, value, now, deliveryID, transitionID); err != nil {
		return err // rolls back the flip + the delivery → retried next tick
	}
	return tx.Commit()
}

// deliveryIDFor / transitionIDFor centralize the id shapes so the delivery row and its history row
// share the SAME transition_id (the anti-storm dedup key) and reference the SAME delivery id.
func deliveryIDFor() string                    { return "wwd-" + randomHex16() }
func transitionIDFor(ruleID string, now time.Time) string {
	return fmt.Sprintf("alert-%s-%d", ruleID, now.Unix())
}

// execer is satisfied by both *sql.DB and *sql.Tx — the enqueue runs inside the fire transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// enqueueDelivery inserts one workspace_webhook_deliveries row (the existing J-16 worker dispatches it
// SSRF-guarded). `transitionID` dedups repeated fires of the same rule within a second; `deliveryID`
// is the row id the history row soft-references.
func (e *Evaluator) enqueueDelivery(ctx context.Context, ex execer, r alertRule, value float64, now time.Time, deliveryID, transitionID string) error {
	payload, _ := json.Marshal(map[string]any{
		"rule_id":    r.id,
		"tenant_id":  r.tenantID,
		"metric":     r.metric,
		"comparator": r.comparator,
		"threshold":  r.threshold,
		"value":      value,
		"fired_at":   now.UTC().Format(time.RFC3339),
	})
	_, err := ex.ExecContext(ctx,
		`INSERT INTO workspace_webhook_deliveries
		   (id, webhook_id, transition_id, tenant_id, event_type, payload, status, next_attempt_at)
		 VALUES ($1, $2, $3, $4, 'alert.threshold_breached', $5, 'pending', NOW())
		 ON CONFLICT (webhook_id, transition_id) DO NOTHING`,
		deliveryID, r.webhookID, transitionID, r.tenantID, payload)
	return err
}

// insertFiredAlert records ONE history row for this breach (M84). Same anti-storm dedup as the
// delivery: `ON CONFLICT (rule_id, transition_id) DO NOTHING` so a multi-replica evaluator writing the
// same transition never double-records. Runs inside the fire transaction (all-or-nothing with the
// flip + the delivery enqueue).
func (e *Evaluator) insertFiredAlert(ctx context.Context, ex execer, r alertRule, value float64, now time.Time, deliveryID, transitionID string) error {
	_, err := ex.ExecContext(ctx,
		`INSERT INTO lens_fired_alerts
		   (id, rule_id, tenant_id, metric, comparator, threshold, value, fired_at, transition_id, delivery_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (rule_id, transition_id) DO NOTHING`,
		"lfa-"+randomHex16(), r.id, r.tenantID, r.metric, r.comparator, r.threshold, value, now, transitionID, deliveryID)
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
