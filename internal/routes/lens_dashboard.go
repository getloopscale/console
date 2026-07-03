// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// LensDataClient is the theo-lens read proxy the dashboard BFF depends on (DIP — a stub
// satisfies it in tests). Satisfied by *thelens.DataClient. M41 is READ-ONLY: the
// interface exposes NO mutating method (create/delete/write is M44). Each read returns
// the upstream body verbatim (json.RawMessage) — the BFF is a thin proxy.
type LensDataClient interface {
	ListTraces(ctx context.Context, limit, offset int) (json.RawMessage, error)
	ListSessions(ctx context.Context, limit, offset int) (json.RawMessage, error)
	Observability(ctx context.Context) (json.RawMessage, error)
	Cost(ctx context.Context, since string) (json.RawMessage, error)
}

// LensDashboardHandler serves the read-only /v1/dashboard/lens BFF. Browser JWT sessions
// (requireJWT) reach it; the injected data client proxies to theo-lens with a per-tenant
// lens:read key resolved from the JWT tenant (never the request body/params). Read-only:
// the write/delete management surface is M44.
type LensDashboardHandler struct {
	client LensDataClient
	logger *slog.Logger
}

// NewLensDashboardHandler builds the read-only handler over the injected per-tenant data client.
func NewLensDashboardHandler(client LensDataClient, logger *slog.Logger) *LensDashboardHandler {
	return &LensDashboardHandler{client: client, logger: logger}
}

// authTenant enforces the JWT session (fail-closed 401 when no tenant). Returns false
// (and writes the 401) when the caller is not an authenticated tenant.
func (h *LensDashboardHandler) authTenant(w http.ResponseWriter, r *http.Request) bool {
	if user := auth.GetUser(r.Context()); user != nil && user.TenantID != "" {
		return true
	}
	writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
	return false
}

// pageParams parses limit (1..100) + offset (>=0) from the query; 0 means "unset".
func pageParams(r *http.Request) (limit, offset int) {
	q := r.URL.Query()
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
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

// ListTraces serves GET /v1/dashboard/lens/traces — the caller workspace's traces, via the
// per-tenant lens:read key resolved from the JWT session (fail-closed 401 when no tenant).
func (h *LensDashboardHandler) ListTraces(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	limit, offset := pageParams(r)
	raw, err := h.client.ListTraces(r.Context(), limit, offset)
	if err != nil {
		h.logger.Warn("lens dashboard: list traces failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list traces.")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// ListSessions serves GET /v1/dashboard/lens/sessions — the caller workspace's sessions.
func (h *LensDashboardHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	limit, offset := pageParams(r)
	raw, err := h.client.ListSessions(r.Context(), limit, offset)
	if err != nil {
		h.logger.Warn("lens dashboard: list sessions failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list sessions.")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// Observability serves GET /v1/dashboard/lens/observability — the caller workspace's
// observability summary (theo-lens GET /v1/metrics/observability).
func (h *LensDashboardHandler) Observability(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := h.client.Observability(r.Context())
	if err != nil {
		h.logger.Warn("lens dashboard: observability failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load observability.")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// Cost serves GET /v1/dashboard/lens/cost?since — the caller workspace's cost summary
// (theo-lens GET /v1/analytics/cost).
func (h *LensDashboardHandler) Cost(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := h.client.Cost(r.Context(), r.URL.Query().Get("since"))
	if err != nil {
		h.logger.Warn("lens dashboard: cost failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load cost.")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}
