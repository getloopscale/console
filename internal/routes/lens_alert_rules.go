// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// LensAlertRulesHandler — theo-lens M53. A per-tenant CRUD for threshold alert rules on observability
// metrics. The background lens_alert_evaluator reads these rows, evaluates them per tenant, and on a
// breach enqueues a webhook delivery (dispatched by the J-16 workspace_webhook_worker). Mirrors the M52
// lens_saved_views isolation: every row scoped by (subject, tenant_id) from the Principal — never the
// body — with a cross-tenant delete collapsing to 404 (existence-leak prevention).
type LensAlertRulesHandler struct {
	db          *sql.DB
	logger      *slog.Logger
	verifyGuard GuardOwnershipVerifier
}

// GuardOwnershipVerifier answers "does this guard exist AND belong to this tenant?" for the create
// path. There is no FK on guard_id — guards live in theo-lens — so this single check is the ONLY
// create-time guarantee, and it is doing both jobs: catching a typo, and stopping tenant A from
// pointing a rule at tenant B's guard.
//
// Returned error semantics are deliberately split (M135, SRE condition 6): ErrGuardNotOwned is a
// DEFINITIVE answer and rejects the create; any other error is transport and the create proceeds,
// because importing theo-lens's availability into theo-cloud's write path trades a rare typo for a
// common outage.
type GuardOwnershipVerifier func(ctx context.Context, tenantID, guardID string) error

// ErrGuardNotOwned means the guard does not exist, or exists under another tenant. Both collapse to
// one answer on purpose: distinguishing them would confirm the existence of another tenant's id.
var ErrGuardNotOwned = errors.New("guard not found for this tenant")

// staleAfterTicks — a rule that has not been evaluated for this many tick intervals is reported
// stale. The customer cannot do this arithmetic themselves: the 60s cadence is not published.
const staleAfterTicks = 3
const evaluatorTickSeconds = 60

const lensAlertRuleIDPrefix = "lar-"
const alertRuleNameMax = 64

var lensAlertRuleIDPattern = regexp.MustCompile(`^lar-[0-9a-f]{16}$`)

// Closed enums (mirrored by the DB CHECK constraints).
var validAlertMetrics = map[string]bool{"error_rate": true, "cost": true, "p95_latency": true,
	"guard_breach": true}
var validAlertComparators = map[string]bool{"gt": true, "gte": true, "lt": true, "lte": true}

// The 4 windows that map to theo-lens's observability range presets (1h/24h/7d/30d). The evaluator
// coarsens to the nearest range, so accepting only these keeps the rule's stated window honest.
var validAlertWindows = map[int]bool{3600: true, 86400: true, 604800: true, 2592000: true}

// NewLensAlertRulesHandler constructs the handler over the shared engine DB.
// The verifier is a REQUIRED argument, not an option. M135 shipped an optional guard fetcher nil
// once already and every guard rule went silently dead; the lesson generalises to this seam.
func NewLensAlertRulesHandler(db *sql.DB, verifyGuard GuardOwnershipVerifier, logger *slog.Logger) *LensAlertRulesHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &LensAlertRulesHandler{db: db, verifyGuard: verifyGuard, logger: logger}
}

// LensAlertRuleView is the JSON shape returned to the dashboard.
type LensAlertRuleView struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Metric        string  `json:"metric"`
	Comparator    string  `json:"comparator"`
	Threshold     float64 `json:"threshold"`
	WindowSeconds int     `json:"window_seconds"`
	WebhookID     string  `json:"webhook_id"`
	GuardID       *string `json:"guard_id,omitempty"`
	// Stale is derived at read time: the rule is enabled but has not been evaluated for
	// staleAfterTicks intervals. It distinguishes "healthy, never breached" from "nobody is looking".
	Stale           bool    `json:"stale"`
	Enabled         bool    `json:"enabled"`
	Status          string  `json:"status"`
	LastEvaluatedAt *string `json:"last_evaluated_at"`
	LastTriggeredAt *string `json:"last_triggered_at"`
	RenotifySeconds *int    `json:"renotify_interval_seconds"`
	CreatedAt       string  `json:"created_at"`
}

// MountLensAlertRules wires the CRUD under /v1/dashboard/lens/alert-rules behind requireJWT.
func MountLensAlertRules(r chi.Router, h *LensAlertRulesHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/lens/alert-rules", func(r chi.Router) {
		r.Use(requireJWT)
		r.Post("/", h.Create)
		r.Get("/", h.List)
		r.Delete("/{id}", h.Delete)
		r.Patch("/{id}", h.Toggle)
		r.Get("/{id}/history", h.History) // M84 — paginated per-rule firing history
	})
}

// LensFiredAlertView is one firing row returned to the dashboard history view.
type LensFiredAlertView struct {
	ID         string  `json:"id"`
	Metric     string  `json:"metric"`
	Comparator string  `json:"comparator"`
	Threshold  float64 `json:"threshold"`
	Value      float64 `json:"value"`
	FiredAt    string  `json:"fired_at"`
}

const firedAlertsPageMax = 100
const firedAlertsPageDefault = 20

// History serves GET /v1/dashboard/lens/alert-rules/{id}/history?limit&offset — the paginated firing
// history for one rule (M84). Owner-scoped by (subject via the rule's ownership, tenant_id); a rule
// that is not the caller's (cross-tenant / non-existent) yields 404 (never a leak of another tenant's
// firings). Newest firing first.
func (h *LensAlertRulesHandler) History(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensAlertRuleIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Rule id must match lar-{16hex}.")
		return
	}
	limit, offset := firedAlertsPage(r)
	// Isolation keystone: gate on the RULE's ownership (subject+tenant) so a foreign rule's firings are
	// never returned — the fired-alerts read is bounded to rules the caller owns.
	var owns int
	err := h.db.QueryRowContext(r.Context(),
		`SELECT 1 FROM lens_alert_rules WHERE id = $1 AND subject = $2 AND tenant_id = $3`,
		id, user.Subject, user.TenantID).Scan(&owns)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Rule not found.")
		return
	}
	if err != nil {
		h.logger.Warn("lens alert history: ownership check failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load history. Try again.")
		return
	}
	// Total for the pager (tenant-scoped over the same rule).
	var total int
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT count(*) FROM lens_fired_alerts WHERE rule_id = $1 AND tenant_id = $2`,
		id, user.TenantID).Scan(&total); err != nil {
		h.logger.Warn("lens alert history: count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load history. Try again.")
		return
	}
	const q = `SELECT id, metric, comparator, threshold, value, fired_at
		FROM lens_fired_alerts
		WHERE rule_id = $1 AND tenant_id = $2
		ORDER BY fired_at DESC
		LIMIT $3 OFFSET $4`
	rows, err := h.db.QueryContext(r.Context(), q, id, user.TenantID, limit, offset)
	if err != nil {
		h.logger.Warn("lens alert history: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load history. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()
	out := make([]LensFiredAlertView, 0, limit)
	for rows.Next() {
		var v LensFiredAlertView
		if err := rows.Scan(&v.ID, &v.Metric, &v.Comparator, &v.Threshold, &v.Value, &v.FiredAt); err != nil {
			h.logger.Warn("lens alert history: scan failed", "error", err)
			continue
		}
		out = append(out, v)
	}
	// A mid-stream driver error must FAIL, not silently return a truncated page as 200 while `total`
	// reports the full count (a data-honesty gap — review LOW).
	if err := rows.Err(); err != nil {
		h.logger.Warn("lens alert history: rows iteration failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load history. Try again.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"firings": out, "total": total, "limit": limit, "offset": offset})
}

// firedAlertsPage parses limit (1..100, default 20) + offset (>=0) from the query.
func firedAlertsPage(r *http.Request) (limit, offset int) {
	limit, offset = firedAlertsPageDefault, 0
	q := r.URL.Query()
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= firedAlertsPageMax {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

// Create serves POST /v1/dashboard/lens/alert-rules.
func (h *LensAlertRulesHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Could not read request body.")
		return
	}
	var req struct {
		Name          string  `json:"name"`
		Metric        string  `json:"metric"`
		Comparator    string  `json:"comparator"`
		Threshold     float64 `json:"threshold"`
		WindowSeconds int     `json:"window_seconds"`
		WebhookID     string  `json:"webhook_id"`
		Renotify      *int    `json:"renotify_interval_seconds"`
		GuardID       string  `json:"guard_id"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > alertRuleNameMax {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "A view name of 1-64 characters is required.")
		return
	}
	if !validAlertMetrics[req.Metric] {
		writeError(w, http.StatusBadRequest, "INVALID_METRIC",
			"metric must be error_rate | cost | p95_latency | guard_breach.")
		return
	}
	// M135 — the guard pairing. The DB CHECK enforces it too (migration 000058); this is the
	// friendly half, so the user gets a typed message instead of a constraint violation.
	guardID := strings.TrimSpace(req.GuardID)
	if req.Metric == "guard_breach" && guardID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_GUARD",
			"A guard_id is required for a guard_breach rule.")
		return
	}
	if req.Metric != "guard_breach" && guardID != "" {
		writeError(w, http.StatusBadRequest, "INVALID_GUARD",
			"guard_id is only valid on a guard_breach rule.")
		return
	}
	if !validAlertComparators[req.Comparator] {
		writeError(w, http.StatusBadRequest, "INVALID_COMPARATOR", "comparator must be gt | gte | lt | lte.")
		return
	}
	if !validAlertWindows[req.WindowSeconds] {
		writeError(w, http.StatusBadRequest, "INVALID_WINDOW", "window_seconds must be 3600 | 86400 | 604800 | 2592000.")
		return
	}
	if strings.TrimSpace(req.WebhookID) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_WEBHOOK", "A webhook_id (a registered webhook to notify) is required.")
		return
	}
	if req.Renotify != nil && *req.Renotify <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_RENOTIFY", "renotify_interval_seconds must be positive when set.")
		return
	}
	// Ownership check (isolation keystone): the target webhook MUST belong to THIS tenant + be active.
	// The FK enforces existence only — without this a rule could POST this tenant's alerts to another
	// tenant's endpoint (theo-data invariant #3: scope by the resolved Principal, never the body).
	var one int
	err = h.db.QueryRowContext(r.Context(),
		`SELECT 1 FROM workspace_webhooks WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
		req.WebhookID, user.TenantID).Scan(&one)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusBadRequest, "INVALID_WEBHOOK", "webhook_id must be one of your active webhooks.")
		return
	}
	if err != nil {
		h.logger.Warn("lens alert rules create: webhook ownership check failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create rule. Try again.")
		return
	}

	// Ownership check for the guard, mirroring the webhook check above. Validate at the one moment
	// a human is present to fix a typo: accepting a bad reference silently produces a rule the user
	// believes protects them and which can never fire.
	if guardID != "" {
		if h.verifyGuard == nil {
			h.logger.Error("lens alert rules create: no guard verifier wired — refusing guard rule")
			writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create rule. Try again.")
			return
		}
		if verr := h.verifyGuard(r.Context(), user.TenantID, guardID); verr != nil {
			if errors.Is(verr, ErrGuardNotOwned) {
				writeError(w, http.StatusBadRequest, "INVALID_GUARD", "guard_id must be one of your guards.")
				return
			}
			// Transport failure: accept and let the evaluator carry it. Do NOT import theo-lens's
			// availability into this write path.
			h.logger.Warn("lens alert rules create: guard verify unavailable — accepting", "error", verr)
		}
	}

	id := lensAlertRuleIDPrefix + randomHex16()
	const q = `INSERT INTO lens_alert_rules
		(id, subject, tenant_id, name, metric, comparator, threshold, window_seconds, webhook_id, renotify_interval_seconds, guard_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''))`
	if _, err := h.db.ExecContext(r.Context(), q,
		id, user.Subject, user.TenantID, name, req.Metric, req.Comparator, req.Threshold, req.WindowSeconds, req.WebhookID, req.Renotify, guardID); err != nil {
		h.logger.Warn("lens alert rules create: insert failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create rule. Try again.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "metric": req.Metric, "status": "OK"})
}

// List serves GET /v1/dashboard/lens/alert-rules — the caller's rules (scoped to subject+tenant).
func (h *LensAlertRulesHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	// `stale` is DERIVED, not stored. last_evaluated_at freezing is the only durable signal that
	// evaluation stopped (the evaluator deliberately does not stamp on a fetch error), but the 60s
	// cadence is not published, so the customer cannot do this arithmetic. We do it for them.
	//
	// created_at is the fallback baseline: a rule with a NULL last_evaluated_at is only stale once
	// it has existed long enough to have been evaluated — otherwise every rule reads stale for its
	// first minute, and a signal that cries wolf is worse than none.
	const q = `SELECT id, name, metric, comparator, threshold, window_seconds, webhook_id, enabled, status,
		last_evaluated_at, last_triggered_at, renotify_interval_seconds, created_at, guard_id,
		(enabled AND COALESCE(last_evaluated_at, created_at) < now() - make_interval(secs => $3)) AS stale
		FROM lens_alert_rules
		WHERE subject = $1 AND tenant_id = $2
		ORDER BY created_at DESC
		LIMIT 200`
	rows, err := h.db.QueryContext(r.Context(), q, user.Subject, user.TenantID,
		float64(staleAfterTicks*evaluatorTickSeconds))
	if err != nil {
		h.logger.Warn("lens alert rules list: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list rules. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()
	out := make([]LensAlertRuleView, 0, 16)
	for rows.Next() {
		var v LensAlertRuleView
		var lastEval, lastTrig, guardID sql.NullString
		var renotify sql.NullInt64
		if err := rows.Scan(&v.ID, &v.Name, &v.Metric, &v.Comparator, &v.Threshold, &v.WindowSeconds,
			&v.WebhookID, &v.Enabled, &v.Status, &lastEval, &lastTrig, &renotify, &v.CreatedAt,
			&guardID, &v.Stale); err != nil {
			h.logger.Warn("lens alert rules list: scan failed", "error", err)
			continue
		}
		if guardID.Valid {
			v.GuardID = &guardID.String
		}
		if lastEval.Valid {
			v.LastEvaluatedAt = &lastEval.String
		}
		if lastTrig.Valid {
			v.LastTriggeredAt = &lastTrig.String
		}
		if renotify.Valid {
			n := int(renotify.Int64)
			v.RenotifySeconds = &n
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"alert_rules": out})
}

// Delete serves DELETE /v1/dashboard/lens/alert-rules/{id}. Cross-tenant / non-existent → 404 (never 403).
func (h *LensAlertRulesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensAlertRuleIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Rule id must match lar-{16hex}.")
		return
	}
	const q = `DELETE FROM lens_alert_rules WHERE id = $1 AND subject = $2 AND tenant_id = $3`
	res, err := h.db.ExecContext(r.Context(), q, id, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("lens alert rules delete: exec failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not delete rule. Try again.")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Rule not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Toggle serves PATCH /v1/dashboard/lens/alert-rules/{id} — flip `enabled`. Owner-scoped; 404 cross-tenant.
func (h *LensAlertRulesHandler) Toggle(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensAlertRuleIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Rule id must match lar-{16hex}.")
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4*1024))
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body.")
		return
	}
	const q = `UPDATE lens_alert_rules SET enabled = $1 WHERE id = $2 AND subject = $3 AND tenant_id = $4`
	res, err := h.db.ExecContext(r.Context(), q, req.Enabled, id, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("lens alert rules toggle: exec failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not update rule. Try again.")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Rule not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "enabled": req.Enabled})
}
