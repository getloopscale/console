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

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/usetheoai/theo-cloud/internal/metrics"
	"time"
)

// SeriesFetcher fetches a tenant's observability series over a window (seconds). In production this mints
// a per-tenant observability:read key via the lens Broker and calls DataClient.Observability; injected so
// the evaluator core is unit-testable without the broker (least-privilege wiring stays at construction).
type SeriesFetcher func(ctx context.Context, tenantID string, windowSeconds int) (json.RawMessage, error)

// MetricMonitorBreach is the sentinel metric of a monitor-backed rule (M135, renamed M136). It thresholds the
// number of traces that breached a theo-lens monitor in the window, instead of a workspace aggregate.
const // The STORED value stays "guard_breach" until the engine migration widens the CHECK constraint
// (M136 Phase 4b, T2-gated). Renaming the Go constant without the migration would make every
// existing rule unroutable — the code would look for a metric no row can hold.
MetricMonitorBreach = "monitor_breach"

// MonitorBreachWindow mirrors theo-lens `GET /v1/guards/:id/breach-window`.
//
// HasData is the load-bearing field. A window where traces WERE evaluated and none breached
// (HasData true, BreachCount 0) is a MEASUREMENT of zero; a window with nothing to evaluate
// (HasData false) is ABSENCE. Collapsing the two is #247: an empty window read as a real zero and
// fired every below-threshold rule permanently — in exactly the tenants whose traffic had stopped.
type MonitorBreachWindow struct {
	BreachCount    int  `json:"breachCount"`
	EvaluatedCount int  `json:"evaluatedCount"`
	HasData        bool `json:"hasData"`
	// MonitorExists is false when no guard with this id exists in this tenant's workspace — covering
	// both "deleted" and "belongs to someone else". It is NOT HasData: a real guard with an empty
	// window is {MonitorExists:true, HasData:false}; a deleted one is {false, false}. The first
	// self-heals, the second never does.
	// The wire carries BOTH names during theo-lens's deprecation window (M136). We decode the
	// canonical one; `guardExists` is its deprecated twin and always holds the same value.
	MonitorExists bool `json:"monitorExists"`
}

// MonitorBreachFetcher fetches one guard's windowed breach summary. Injected for the same reason as
// SeriesFetcher: the evaluator core stays unit-testable without the broker.
type MonitorBreachFetcher func(ctx context.Context, tenantID, monitorID string, windowSeconds int) (MonitorBreachWindow, error)

// PromptUsageFetcher fetches one prompt's windowed usage aggregate (theo-promptly M21 DoD-5).
// Injected for exactly the reason MonitorBreachFetcher is: the workspace series returns one float
// per window and cannot answer a per-PROMPT question, so the answer comes from a different upstream
// call — a third fetcher, not a new metric case reading the wrong aggregate.
type PromptUsageFetcher func(ctx context.Context, tenantID, promptName string, windowSeconds int) (json.RawMessage, error)

// Evaluator is the background alert-rule evaluator (theo-lens M53). It ticks periodically, fetches each
// tenant's observability series, evaluates each rule via the pure state machine, and on a fire enqueues a
// workspace_webhook_deliveries row for the existing J-16 worker to dispatch. It NEVER dispatches HTTP
// itself (reuse — Rule 9).
type Evaluator struct {
	db           *sql.DB
	fetch        SeriesFetcher
	fetchMonitor MonitorBreachFetcher
	fetchPrompt  PromptUsageFetcher
	logger       *slog.Logger
	now          func() time.Time
	interval     time.Duration
}

// ErrMonitorNotFound is the DEFINITIVE "this guard no longer exists" answer, as distinct from any
// transport failure. The distinction is the same discipline HasData applies to absence-vs-zero: a
// transient failure self-heals and must be retried; a deleted guard never does and must stop
// pretending to be armed. Collapsing the two into one `error` is how a rule goes dark forever.
var ErrMonitorNotFound = errors.New("lens alert evaluator: guard not found")

// monitorFetchTimeout bounds ONE carrier call. Tick is a single sequential loop, so without this an
// unresponsive theo-lens serializes N guard rules inside one tick and stalls the series-backed
// rules queued behind them — rules that have no theo-lens dependency at all. A scoped dependency
// failure would become a fleet-wide alerting outage.
const monitorFetchTimeout = 5 * time.Second

// monitorFailureBudget stops the remaining guard rules for THIS tick after K consecutive carrier
// failures. Same shape as the series path's `failed` map: bound the damage in-tick, carry no state
// across ticks. 500 rules against a hung lens is ~42min with only a per-call timeout; ~15s with this.
const monitorFailureBudget = 3

// New constructs the evaluator. ALL fetchers are REQUIRED positional arguments, deliberately: an
// optional guard fetcher is how the feature shipped nil in production once already, making every
// guard-backed rule permanently dead while reading "armed" on the customer's screen. A compile
// error is a better gate than a runtime warning.
//
// The prompt fetcher was added to THIS signature rather than to a second constructor for the same
// reason. A `NewWithPrompt` alongside `New` would reintroduce exactly the failure it is meant to
// prevent: the old call site keeps compiling, prompt rules silently never evaluate, and the screen
// again shows an armed rule that can never fire.
func New(db *sql.DB, fetch SeriesFetcher, fetchMonitor MonitorBreachFetcher, fetchPrompt PromptUsageFetcher, logger *slog.Logger) *Evaluator {
	if logger == nil {
		logger = slog.Default()
	}
	return &Evaluator{db: db, fetch: fetch, fetchMonitor: fetchMonitor, fetchPrompt: fetchPrompt,
		logger: logger, now: time.Now, interval: 60 * time.Second}
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
	monitorID     sql.NullString
	promptName    sql.NullString
}

// monitorKey caches one carrier answer per (tenant, guard, window) within a tick.
type monitorKey struct {
	tenant string
	guard  string
	window int
}

// promptKey caches one prompt-usage answer per (tenant, prompt, window) within a tick.
type promptKey struct {
	tenant string
	prompt string
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

// colunaAusente is SQLSTATE 42703 (undefined_column) — the ONE error that means "this deployment is
// ahead of the database", as opposed to any other reason a query can fail.
const colunaAusente = "42703"

const colunasDeRegra = `id, tenant_id, metric, comparator, threshold, window_seconds, webhook_id, status,
		       last_triggered_at, renotify_interval_seconds, monitor_id`

// queryRules reads the enabled rules, degrading gracefully when this deployment is AHEAD of the
// database — that is, when the image carrying the prompt-scoped path shipped before the engine
// migration that adds `prompt_name` landed.
//
// Nothing in the platform orders those two deploys: the engine migrates through one pipeline and
// theo-cloud publishes to `develop` through another. Without this, arriving first makes the SELECT
// fail with 42703 and Tick return BEFORE evaluating a single row — every alert rule in the fleet
// stops being evaluated, including every rule that has nothing to do with prompts.
//
// That failure is indistinguishable from calm on the customer's screen: the rules stay `enabled`,
// the status stays `OK`, and nobody is told anything. Making a fleet-wide alerting outage depend on
// an operator getting two deploys in the right order is not a risk worth taking for one column.
//
// The detection is by SQLSTATE, never by message text — the same discipline `internal/auth/tenant.go`
// already applies to 23505. A connection failure must NOT be retried with the legacy projection: it
// would double the query against a database that is already unwell, and hide the real error behind
// a second, different one.
func (e *Evaluator) queryRules(ctx context.Context) (*sql.Rows, bool, error) {
	rows, err := e.db.QueryContext(ctx, `SELECT `+colunasDeRegra+`, prompt_name
		FROM lens_alert_rules
		WHERE enabled
		ORDER BY tenant_id`)
	if err == nil {
		return rows, true, nil
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != colunaAusente {
		return nil, false, err
	}
	// Loud, because it is a real misconfiguration that MUST be fixed — but not fatal, because the
	// rules that predate the column are still perfectly evaluable.
	e.logger.Error("lens alert evaluator: database is behind this deployment — prompt-scoped rules "+
		"cannot be evaluated until the engine migration adding lens_alert_rules.prompt_name lands. "+
		"Every other rule continues to be evaluated.", "sqlstate", pgErr.Code)
	rows, err = e.db.QueryContext(ctx, `SELECT `+colunasDeRegra+`
		FROM lens_alert_rules
		WHERE enabled
		ORDER BY tenant_id`)
	return rows, false, err
}

// Tick runs one evaluation pass: for each tenant with enabled rules, fetch the series once per distinct
// window and evaluate each rule. A per-tenant fetch error is logged + skipped (fail-closed: no data → no
// spurious fire), never aborting the whole tick.
func (e *Evaluator) Tick(ctx context.Context) error {
	rows, comPrompt, err := e.queryRules(ctx)
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
	type guardKeyT = monitorKey
	monitorCache := map[guardKeyT]MonitorBreachWindow{}
	monitorFailures := 0

	// The prompt path caches by (tenant, prompt, window) for the same reason the other two cache:
	// N rules over one prompt must issue ONE upstream call, not N.
	promptCache := map[promptKey]json.RawMessage{}
	promptFailed := map[promptKey]bool{}

	for rows.Next() {
		var r alertRule
		alvos := []any{&r.id, &r.tenantID, &r.metric, &r.comparator, &r.threshold, &r.windowSeconds,
			&r.webhookID, &r.status, &r.lastTriggered, &r.renotify, &r.monitorID}
		if comPrompt {
			alvos = append(alvos, &r.promptName)
		}
		if err := rows.Scan(alvos...); err != nil {
			e.logger.Warn("lens alert evaluator: scan failed", "error", err)
			continue
		}
		// M135: a guard-backed rule reads the per-guard carrier, not the workspace series. The
		// series is a workspace aggregate returning one float per window and cannot answer a
		// per-guard question — hence a second fetcher rather than a new metric case.
		if r.metric == MetricMonitorBreach {
			// Unreachable once migration 000058's pairing CHECK is applied — kept as belt-and-braces
			// so a reader does not infer the database permits this state.
			if e.fetchMonitor == nil || !r.monitorID.Valid {
				metrics.IncLensAlertEvaluation("unwired")
				e.logger.Error("lens alert evaluator: guard rule cannot be evaluated — no fetcher or no guard id",
					"rule", r.id)
				continue
			}
			if monitorFailures >= monitorFailureBudget {
				// In-tick bulkhead: the carrier is clearly unwell; stop burning the tick budget on
				// it so series-backed rules — which do not depend on theo-lens at all — still run.
				metrics.IncLensAlertEvaluation("bulkhead_skipped")
				continue
			}
			gk := monitorKey{r.tenantID, r.monitorID.String, r.windowSeconds}
			w, cached := monitorCache[gk]
			if !cached {
				fctx, cancel := context.WithTimeout(ctx, monitorFetchTimeout)
				var ferr error
				w, ferr = e.fetchMonitor(fctx, r.tenantID, r.monitorID.String, r.windowSeconds)
				cancel()
				if ferr != nil {
					// A DEFINITIVE 404 is not a transient failure: the guard is gone and no number
					// of retries brings it back. Disable the rule so the customer sees a disabled
					// rule instead of an armed one that can never fire — an honest downgrade. A
					// transport error keeps skipping, because auto-disabling on a blip would
					// permanently disarm every guard rule in the fleet.
					if errors.Is(ferr, ErrMonitorNotFound) {
						metrics.IncLensAlertEvaluation("guard_missing")
						e.logger.Warn("lens alert evaluator: guard no longer exists — disabling rule",
							"rule", r.id, "guard", r.monitorID.String)
						if _, derr := e.db.ExecContext(ctx,
							`UPDATE lens_alert_rules SET enabled = FALSE WHERE id = $1`, r.id); derr != nil {
							e.logger.Warn("lens alert evaluator: disable failed", "rule", r.id, "error", derr)
						}
						continue
					}
					// Fail-closed: a failed fetch is absence, never zero. Deliberately NOT stamping
					// last_evaluated_at — the freeze IS the durable outage signal.
					monitorFailures++
					metrics.IncLensAlertEvaluation("fetch_error")
					e.logger.Warn("lens alert evaluator: guard fetch failed — skipping rule",
						"rule", r.id, "guard", r.monitorID.String, "error", ferr)
					continue
				}
				monitorCache[gk] = w
				monitorFailures = 0 // CONSECUTIVE, as the constant's name promises: a success clears
				// the streak. A cumulative per-tick total would let three unrelated bad tenants
				// starve every healthy guard rule in the fleet for the rest of the tick.
			}
			if !w.MonitorExists {
				// Definitive: the guard is gone (or was never ours). No number of retries brings it
				// back, so the rule stops pretending to be armed. This is the branch that used to
				// depend on a 404 theo-lens never emitted.
				metrics.IncLensAlertEvaluation("guard_missing")
				e.logger.Warn("lens alert evaluator: guard no longer exists — disabling rule",
					"rule", r.id, "guard", r.monitorID.String)
				if _, derr := e.db.ExecContext(ctx,
					`UPDATE lens_alert_rules SET enabled = FALSE WHERE id = $1`, r.id); derr != nil {
					e.logger.Warn("lens alert evaluator: disable failed", "rule", r.id, "error", derr)
				}
				continue
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
		// M21 (theo-promptly): a prompt-scoped rule reads the per-prompt aggregate, not the
		// workspace series — same reasoning as the guard branch above. The series is one float per
		// window and knows nothing about a prompt; letting the rule fall through to it would fire
		// (or not) on a number unrelated to the prompt the customer picked, with that prompt's name
		// displayed beside it.
		if isPromptScoped(r.metric) {
			// Unreachable once migration 000060's pairing CHECK is applied — belt-and-braces, so a
			// reader does not infer the database permits a prompt rule without a prompt.
			if e.fetchPrompt == nil || !r.promptName.Valid {
				metrics.IncLensAlertEvaluation("unwired")
				e.logger.Error("lens alert evaluator: prompt rule cannot be evaluated — no fetcher or no prompt name",
					"rule", r.id)
				continue
			}
			pk := promptKey{r.tenantID, r.promptName.String, r.windowSeconds}
			if promptFailed[pk] {
				continue
			}
			raw, cached := promptCache[pk]
			if !cached {
				fctx, cancel := context.WithTimeout(ctx, monitorFetchTimeout)
				var ferr error
				raw, ferr = e.fetchPrompt(fctx, r.tenantID, r.promptName.String, r.windowSeconds)
				cancel()
				if ferr != nil {
					// Fail-closed, and deliberately NOT stamping last_evaluated_at: the freeze IS
					// the durable outage signal, and refreshing it would erase the only evidence
					// that evaluation stopped.
					metrics.IncLensAlertEvaluation("fetch_error")
					e.logger.Warn("lens alert evaluator: prompt usage fetch failed — skipping rule",
						"rule", r.id, "prompt", r.promptName.String, "error", ferr)
					promptFailed[pk] = true
					continue
				}
				promptCache[pk] = raw
			}
			if perr := e.processPromptRule(ctx, r, raw); perr != nil {
				e.logger.Warn("lens alert evaluator: process prompt rule failed", "rule", r.id, "error", perr)
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
func (e *Evaluator) processGuardRule(ctx context.Context, r alertRule, w MonitorBreachWindow) error {
	if !w.HasData {
		// Absence, not zero. Not evaluating here is the whole reason the carrier reports HasData at
		// all; thresholding BreachCount==0 from an empty window is #247 with a different source.
		// The evaluation itself is still recorded — see recordEvaluation.
		return e.recordEvaluation(ctx, r)
	}
	return e.decide(ctx, r, float64(w.BreachCount))
}

// processPromptRule is the prompt-scoped twin of processRule (M21). It resolves the number from the
// per-prompt aggregate and hands it to the SAME decision path — the state machine, the atomic
// transition and the delivery enqueue are reused verbatim, exactly as the guard path does.
//
// Note the asymmetry with processRule, which is deliberate and documented at metricFromPromptUsage:
// here an EMPTY aggregate is a measurement of zero, not absence. Read failure never reaches this
// function disguised as empty — it surfaced as an error at the fetch above.
func (e *Evaluator) processPromptRule(ctx context.Context, r alertRule, raw json.RawMessage) error {
	value, ok := metricFromPromptUsage(raw, r.metric)
	if !ok {
		// Unparseable body or unknown metric — never a measurement. The evaluation is still
		// recorded: "we looked and could not read it" and "we stopped looking" are different facts.
		metrics.IncLensAlertEvaluation("no_data")
		return e.recordEvaluation(ctx, r)
	}
	metrics.IncLensAlertEvaluation("ok")
	return e.decide(ctx, r, value)
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
		res, err := e.db.ExecContext(ctx,
			`UPDATE lens_alert_rules SET status = $1, last_evaluated_at = $2
			 WHERE id = $3
			   AND status = $4
			   AND last_triggered_at IS NOT DISTINCT FROM $5
			   AND (last_evaluated_at IS NULL OR last_evaluated_at <= $2)`,
			d.nextStatus, now, r.id, r.status, r.lastTriggered)
		if err != nil {
			return err
		}
		// Zero rows is EXPECTED when another replica moved the rule first — but it is
		// indistinguishable from a wedge (a clock step leaving last_evaluated_at in the future makes
		// the monotone clause fail forever, freezing the rule as both alerting and stale). The fire
		// path already checks RowsAffected; the one write path that can silently stop must not be
		// the one nobody counts — that is #247 from the other direction, again.
		if n, rerr := res.RowsAffected(); rerr == nil && n == 0 {
			metrics.IncLensAlertEvaluation("write_lost")
			e.logger.Info("lens alert evaluator: non-fire write affected 0 rows",
				"rule", r.id, "read_status", r.status)
		}
		return nil
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
func deliveryIDFor() string { return "wwd-" + randomHex16() }
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
