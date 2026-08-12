// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// LensDashboardsHandler — theo-lens M66. A per-WORKSPACE store of custom dashboards for the
// /v1/dashboard/lens BFF. A dashboard is an ordered list of widgets (KPI tile / trend chart /
// top-N table) each bound to an existing M51/M60 observability series; the whole board is stored
// as ONE JSONB `config` blob (opik's single-config-blob precedent). Cloud-owned Postgres (raw
// database/sql; engine migration 000055). Unlike lens_saved_views (personal, subject+tenant), a
// dashboard is a SHARED team artifact scoped by tenant_id ALONE (the peer-standard model —
// opik/langfuse scope dashboards to the workspace); `created_by` is audit-only, never a scope
// filter. A cross-tenant read/write collapses to 404 (existence-leak prevention), never 403.
type LensDashboardsHandler struct {
	db     *sql.DB
	logger *slog.Logger
}

const lensDashboardIDPrefix = "ldb-"
const dashboardNameMax = 64
const dashboardWidgetTitleMax = 64
const dashboardMaxWidgets = 24

var lensDashboardIDPattern = regexp.MustCompile(`^ldb-[0-9a-f]{16}$`)

// The fixed widget palette (D2) — the widget-type IS the query; each binds to a known lens series.
var dashboardWidgetTypes = map[string]bool{"kpi": true, "trend": true, "topn": true}
var dashboardWidgetMetrics = map[string]bool{
	"traces": true, "error_rate": true, "p95_latency": true, "cost": true, "tokens_by_model": true,
}

// NewLensDashboardsHandler constructs the handler over the shared engine DB.
// capLensDashboards é o teto defensivo desta lista (B-114). O `LIMIT` da query é `capLensDashboards + 1`,
// para que o handler saiba distinguir "exatamente 100" de "mais de 100".
const capLensDashboards = 100

func NewLensDashboardsHandler(db *sql.DB, logger *slog.Logger) *LensDashboardsHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &LensDashboardsHandler{db: db, logger: logger}
}

// LensDashboardView is the JSON shape returned to the dashboard.
type LensDashboardView struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	CreatedBy string          `json:"created_by"`
	CreatedAt string          `json:"created_at"`
	UpdatedAt string          `json:"updated_at"`
}

// dashboardWidget mirrors the config blob's element for boundary validation (D6). Extra fields on
// the wire are ignored (forward-compat); the type + metric + title are the validated contract.
type dashboardWidget struct {
	Type   string `json:"type"`
	Metric string `json:"metric"`
	Title  string `json:"title"`
}

// validateDashboardConfig enforces the palette + caps at the write boundary (Rule 8 — a JSONB
// column invites unvalidated input). Returns a client-facing message on the first violation.
func validateDashboardConfig(raw json.RawMessage) (json.RawMessage, string) {
	var widgets []dashboardWidget
	if err := json.Unmarshal(raw, &widgets); err != nil {
		return nil, "config must be a JSON array of widgets."
	}
	if len(widgets) == 0 {
		return nil, "config must contain at least one widget."
	}
	if len(widgets) > dashboardMaxWidgets {
		return nil, fmt.Sprintf("config may contain at most %d widgets.", dashboardMaxWidgets)
	}
	for i, wdg := range widgets {
		if !dashboardWidgetTypes[wdg.Type] {
			return nil, fmt.Sprintf("widget %d: unknown type %q.", i, wdg.Type)
		}
		if !dashboardWidgetMetrics[wdg.Metric] {
			return nil, fmt.Sprintf("widget %d: unknown metric %q.", i, wdg.Metric)
		}
		if len(wdg.Title) > dashboardWidgetTitleMax {
			return nil, fmt.Sprintf("widget %d: title must be %d characters or fewer.", i, dashboardWidgetTitleMax)
		}
	}
	// Re-marshal the validated widgets so only the contract fields are persisted (defense-in-depth).
	clean, err := json.Marshal(widgets)
	if err != nil {
		return nil, "config could not be normalized."
	}
	return clean, ""
}

// MountLensDashboards wires CRUD under /v1/dashboard/lens/dashboards behind requireJWT.
func MountLensDashboards(r chi.Router, h *LensDashboardsHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/lens/dashboards", func(r chi.Router) {
		r.Use(requireJWT)
		r.Post("/", h.Create)
		r.Get("/", h.List)
		r.Get("/{id}", h.Get)
		r.Put("/{id}", h.Update)
		r.Delete("/{id}", h.Delete)
	})
}

type dashboardWriteRequest struct {
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

// parseDashboardWrite reads + validates the create/update body → (name, clean config, errMsg).
func parseDashboardWrite(r *http.Request) (string, json.RawMessage, string) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		return "", nil, "Could not read request body."
	}
	var req dashboardWriteRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return "", nil, "Invalid JSON body."
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "", nil, "A dashboard name is required."
	}
	if len(name) > dashboardNameMax {
		return "", nil, fmt.Sprintf("Name must be %d characters or fewer.", dashboardNameMax)
	}
	if len(req.Config) == 0 {
		return "", nil, "A dashboard config is required."
	}
	clean, msg := validateDashboardConfig(req.Config)
	if msg != "" {
		return "", nil, msg
	}
	return name, clean, ""
}

// Create serves POST /v1/dashboard/lens/dashboards — save a new board for the workspace.
func (h *LensDashboardsHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	name, config, msg := parseDashboardWrite(r)
	if msg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", msg)
		return
	}
	id := lensDashboardIDPrefix + randomHex16()
	const q = `INSERT INTO lens_dashboards (id, tenant_id, created_by, name, config)
		VALUES ($1, $2, $3, $4, $5)`
	if _, err := h.db.ExecContext(r.Context(), q, id, user.TenantID, user.Subject, name, []byte(config)); err != nil {
		h.logger.Warn("lens dashboards create: insert failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not save dashboard. Try again.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "config": config, "created_by": user.Subject})
}

// List serves GET /v1/dashboard/lens/dashboards — the workspace's boards (scoped to tenant_id).
func (h *LensDashboardsHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	const q = `SELECT id, name, config, created_by, created_at, updated_at
		FROM lens_dashboards
		WHERE tenant_id = $1
		ORDER BY created_at DESC
		LIMIT 101`
	rows, err := h.db.QueryContext(r.Context(), q, user.TenantID)
	if err != nil {
		h.logger.Warn("lens dashboards list: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list dashboards. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()
	out := make([]LensDashboardView, 0, 16)
	for rows.Next() {
		var v LensDashboardView
		var config []byte
		if err := rows.Scan(&v.ID, &v.Name, &config, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt); err != nil {
			h.logger.Warn("lens dashboards list: scan failed", "error", err)
			continue
		}
		v.Config = json.RawMessage(config)
		out = append(out, v)
	}
	out, temMais := truncar(out, capLensDashboards)
	writeJSON(w, http.StatusOK, map[string]any{"dashboards": out, "has_more": temMais})
}

// Get serves GET /v1/dashboard/lens/dashboards/{id}. A cross-tenant / non-existent id → 404 (never 403).
func (h *LensDashboardsHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensDashboardIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Dashboard id must match ldb-{16hex}.")
		return
	}
	const q = `SELECT id, name, config, created_by, created_at, updated_at
		FROM lens_dashboards WHERE id = $1 AND tenant_id = $2`
	var v LensDashboardView
	var config []byte
	err := h.db.QueryRowContext(r.Context(), q, id, user.TenantID).
		Scan(&v.ID, &v.Name, &config, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Dashboard not found.")
		return
	}
	if err != nil {
		h.logger.Warn("lens dashboards get: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load dashboard. Try again.")
		return
	}
	v.Config = json.RawMessage(config)
	writeJSON(w, http.StatusOK, v)
}

// Update serves PUT /v1/dashboard/lens/dashboards/{id} — replace name + config. A cross-tenant /
// non-existent id collapses to 404 (0 rows affected), never 403.
func (h *LensDashboardsHandler) Update(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensDashboardIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Dashboard id must match ldb-{16hex}.")
		return
	}
	name, config, msg := parseDashboardWrite(r)
	if msg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", msg)
		return
	}
	const q = `UPDATE lens_dashboards SET name = $1, config = $2, updated_at = NOW()
		WHERE id = $3 AND tenant_id = $4`
	res, err := h.db.ExecContext(r.Context(), q, name, []byte(config), id, user.TenantID)
	if err != nil {
		h.logger.Warn("lens dashboards update: exec failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not update dashboard. Try again.")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Dashboard not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "config": config})
}

// Delete serves DELETE /v1/dashboard/lens/dashboards/{id}. Cross-tenant / non-existent → 404, never 403.
func (h *LensDashboardsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensDashboardIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Dashboard id must match ldb-{16hex}.")
		return
	}
	const q = `DELETE FROM lens_dashboards WHERE id = $1 AND tenant_id = $2`
	res, err := h.db.ExecContext(r.Context(), q, id, user.TenantID)
	if err != nil {
		h.logger.Warn("lens dashboards delete: exec failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not delete dashboard. Try again.")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Dashboard not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
