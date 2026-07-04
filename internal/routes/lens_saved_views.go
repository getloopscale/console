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

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// LensSavedViewsHandler — theo-lens M52. A per-tenant store of saved trace-list filter combinations
// for the /v1/dashboard/lens dashboard. A saved view holds the nuqs-serialized filter query string
// verbatim; "apply" pushes it back onto the URL (the dashboard's nuqs parsers hydrate it). Cloud-owned
// Postgres (raw database/sql; engine migration 000053). Mirrors the J-16 workspace_webhooks isolation:
// every row is scoped by (subject, tenant_id) resolved from the Principal — never the request body —
// and a cross-tenant delete collapses to 404 (existence-leak prevention), never 403.
type LensSavedViewsHandler struct {
	db     *sql.DB
	logger *slog.Logger
}

const lensSavedViewIDPrefix = "lsv-"
const savedViewNameMax = 64
const savedViewQueryMax = 4096

var lensSavedViewIDPattern = regexp.MustCompile(`^lsv-[0-9a-f]{16}$`)

// NewLensSavedViewsHandler constructs the handler over the shared engine DB.
func NewLensSavedViewsHandler(db *sql.DB, logger *slog.Logger) *LensSavedViewsHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &LensSavedViewsHandler{db: db, logger: logger}
}

// LensSavedViewView is the JSON shape returned to the dashboard.
type LensSavedViewView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	QueryString string `json:"query_string"`
	CreatedAt   string `json:"created_at"`
}

// MountLensSavedViews wires POST/GET/DELETE under /v1/dashboard/lens/saved-views behind requireJWT.
func MountLensSavedViews(r chi.Router, h *LensSavedViewsHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/lens/saved-views", func(r chi.Router) {
		r.Use(requireJWT)
		r.Post("/", h.Create)
		r.Get("/", h.List)
		r.Delete("/{id}", h.Delete)
	})
}

// Create serves POST /v1/dashboard/lens/saved-views — save the current filter combination.
func (h *LensSavedViewsHandler) Create(w http.ResponseWriter, r *http.Request) {
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
		Name        string `json:"name"`
		QueryString string `json:"query_string"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "EMPTY_NAME", "A view name is required.")
		return
	}
	if len(name) > savedViewNameMax {
		writeError(w, http.StatusBadRequest, "NAME_TOO_LONG",
			fmt.Sprintf("Name must be %d characters or fewer.", savedViewNameMax))
		return
	}
	qs := strings.TrimSpace(req.QueryString)
	if qs == "" || len(qs) > savedViewQueryMax {
		writeError(w, http.StatusBadRequest, "INVALID_QUERY", "query_string must be non-empty and within limits.")
		return
	}

	id := lensSavedViewIDPrefix + randomHex16()
	const q = `INSERT INTO lens_saved_views (id, subject, tenant_id, name, query_string)
		VALUES ($1, $2, $3, $4, $5)`
	if _, err := h.db.ExecContext(r.Context(), q, id, user.Subject, user.TenantID, name, qs); err != nil {
		h.logger.Warn("lens saved views create: insert failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not save view. Try again.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "query_string": qs})
}

// List serves GET /v1/dashboard/lens/saved-views — the caller's saved views (scoped to subject+tenant).
func (h *LensSavedViewsHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	const q = `SELECT id, name, query_string, created_at
		FROM lens_saved_views
		WHERE subject = $1 AND tenant_id = $2
		ORDER BY created_at DESC
		LIMIT 100`
	rows, err := h.db.QueryContext(r.Context(), q, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("lens saved views list: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list views. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()
	out := make([]LensSavedViewView, 0, 16)
	for rows.Next() {
		var v LensSavedViewView
		if err := rows.Scan(&v.ID, &v.Name, &v.QueryString, &v.CreatedAt); err != nil {
			h.logger.Warn("lens saved views list: scan failed", "error", err)
			continue
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"saved_views": out})
}

// Delete serves DELETE /v1/dashboard/lens/saved-views/{id}. A cross-tenant / non-existent row collapses
// to 404 (0 rows affected) — never 403 (existence-leak prevention).
func (h *LensSavedViewsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	id := chi.URLParam(r, "id")
	if !lensSavedViewIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "View id must match lsv-{16hex}.")
		return
	}
	const q = `DELETE FROM lens_saved_views WHERE id = $1 AND subject = $2 AND tenant_id = $3`
	res, err := h.db.ExecContext(r.Context(), q, id, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("lens saved views delete: exec failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not delete view. Try again.")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "View not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
