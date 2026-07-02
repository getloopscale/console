package routes

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/rag"
)

// RagDataClient is the read-only theo-rag proxy the dashboard BFF depends on (DIP —
// a stub satisfies it in tests). Satisfied by *rag.DataClient.
type RagDataClient interface {
	ListCollections(ctx context.Context, limit, offset int) (*rag.CollectionsResult, error)
	Analytics(ctx context.Context, since string) (*rag.AnalyticsResult, error)
}

// RagDashboardHandler serves the read-only /v1/dashboard/rag BFF (M17). Browser JWT
// sessions (requireJWT) reach it; the injected data client proxies to theo-rag with a
// per-tenant rag:read-only key resolved from the JWT tenant. Read-only by construction:
// only GET handlers exist here (no mutating verb — the roadmap risk-1 guard).
type RagDashboardHandler struct {
	client RagDataClient
	logger *slog.Logger
}

// NewRagDashboardHandler builds the handler over the injected read-only data client.
func NewRagDashboardHandler(client RagDataClient, logger *slog.Logger) *RagDashboardHandler {
	return &RagDashboardHandler{client: client, logger: logger}
}

// ListCollections serves GET /v1/dashboard/rag/collections — the caller workspace's
// collections, via the per-tenant key resolved from the JWT session (fail-closed 401
// when no tenant). Query params tenant/workspace are IGNORED (the tenant comes from JWT).
func (h *RagDashboardHandler) ListCollections(w http.ResponseWriter, r *http.Request) {
	if user := auth.GetUser(r.Context()); user == nil || user.TenantID == "" {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	q := r.URL.Query()
	limit, offset := 0, 0
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
	res, err := h.client.ListCollections(r.Context(), limit, offset)
	if err != nil {
		h.logger.Warn("rag dashboard: list collections failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list collections.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// Analytics serves GET /v1/dashboard/rag/analytics — the caller workspace's M5 summary,
// via the per-tenant key (theo-rag gates /v1/analytics by rag:read since M17).
func (h *RagDashboardHandler) Analytics(w http.ResponseWriter, r *http.Request) {
	if user := auth.GetUser(r.Context()); user == nil || user.TenantID == "" {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	res, err := h.client.Analytics(r.Context(), r.URL.Query().Get("since"))
	if err != nil {
		h.logger.Warn("rag dashboard: analytics failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load analytics.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}
