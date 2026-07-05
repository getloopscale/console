// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"regexp"
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
	db     *sql.DB
	logger *slog.Logger
}

const lensAlertRuleIDPrefix = "lar-"
const alertRuleNameMax = 64

var lensAlertRuleIDPattern = regexp.MustCompile(`^lar-[0-9a-f]{16}$`)

// Closed enums (mirrored by the DB CHECK constraints).
var validAlertMetrics = map[string]bool{"error_rate": true, "cost": true, "p95_latency": true}
var validAlertComparators = map[string]bool{"gt": true, "gte": true, "lt": true, "lte": true}

// The 4 windows that map to theo-lens's observability range presets (1h/24h/7d/30d). The evaluator
// coarsens to the nearest range, so accepting only these keeps the rule's stated window honest.
var validAlertWindows = map[int]bool{3600: true, 86400: true, 604800: true, 2592000: true}

// NewLensAlertRulesHandler constructs the handler over the shared engine DB.
func NewLensAlertRulesHandler(db *sql.DB, logger *slog.Logger) *LensAlertRulesHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &LensAlertRulesHandler{db: db, logger: logger}
}

// LensAlertRuleView is the JSON shape returned to the dashboard.
type LensAlertRuleView struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Metric          string  `json:"metric"`
	Comparator      string  `json:"comparator"`
	Threshold       float64 `json:"threshold"`
	WindowSeconds   int     `json:"window_seconds"`
	WebhookID       string  `json:"webhook_id"`
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
	})
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
		writeError(w, http.StatusBadRequest, "INVALID_METRIC", "metric must be error_rate | cost | p95_latency.")
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

	id := lensAlertRuleIDPrefix + randomHex16()
	const q = `INSERT INTO lens_alert_rules
		(id, subject, tenant_id, name, metric, comparator, threshold, window_seconds, webhook_id, renotify_interval_seconds)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	if _, err := h.db.ExecContext(r.Context(), q,
		id, user.Subject, user.TenantID, name, req.Metric, req.Comparator, req.Threshold, req.WindowSeconds, req.WebhookID, req.Renotify); err != nil {
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
	const q = `SELECT id, name, metric, comparator, threshold, window_seconds, webhook_id, enabled, status,
		last_evaluated_at, last_triggered_at, renotify_interval_seconds, created_at
		FROM lens_alert_rules
		WHERE subject = $1 AND tenant_id = $2
		ORDER BY created_at DESC
		LIMIT 200`
	rows, err := h.db.QueryContext(r.Context(), q, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("lens alert rules list: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list rules. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()
	out := make([]LensAlertRuleView, 0, 16)
	for rows.Next() {
		var v LensAlertRuleView
		var lastEval, lastTrig sql.NullString
		var renotify sql.NullInt64
		if err := rows.Scan(&v.ID, &v.Name, &v.Metric, &v.Comparator, &v.Threshold, &v.WindowSeconds,
			&v.WebhookID, &v.Enabled, &v.Status, &lastEval, &lastTrig, &renotify, &v.CreatedAt); err != nil {
			h.logger.Warn("lens alert rules list: scan failed", "error", err)
			continue
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
