package routes

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/rag"
)

// RagDataClient is the theo-rag proxy the dashboard BFF depends on (DIP — a stub
// satisfies it in tests). Satisfied by *rag.DataClient. M21 adds the write surface
// (create/delete collections + documents, ask) alongside the M17 reads.
type RagDataClient interface {
	ListCollections(ctx context.Context, limit, offset int) (*rag.CollectionsResult, error)
	ListDocuments(ctx context.Context, collectionID string, limit, offset int) (*rag.DocumentsResult, error)
	Analytics(ctx context.Context, collectionID, since string) (*rag.AnalyticsResult, error)
	CreateCollection(ctx context.Context, in rag.CreateCollectionInput) (*rag.Collection, error)
	DeleteCollection(ctx context.Context, id string) error
	IngestDocument(ctx context.Context, in rag.IngestInput) (json.RawMessage, error)
	DeleteDocument(ctx context.Context, id string) error
	Ask(ctx context.Context, in rag.AskInput) (json.RawMessage, error)
	// #191 — connectors surface (list + sync + delete).
	ListConnectors(ctx context.Context) (*rag.ConnectionsResult, error)
	SyncConnector(ctx context.Context, id string) (json.RawMessage, error)
	DeleteConnector(ctx context.Context, id string) error
}

// RagDashboardHandler serves the /v1/dashboard/rag BFF. Browser JWT sessions (requireJWT)
// reach it; the injected data client proxies to theo-rag with a per-tenant key resolved
// from the JWT tenant. M21 lifts the M17 read-only surface to read+write — the dashboard
// session mints a rag:read+write+delete key; theo-rag's per-verb scope still gates every
// write (the 6 data-plane invariants hold at the service).
type RagDashboardHandler struct {
	client RagDataClient
	logger *slog.Logger
}

// NewRagDashboardHandler builds the handler over the injected per-tenant data client (M21: read+write).
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
//
// ROADMAP-v8 M7 — when ?collection_id= is present the response carries an extra
// `scale` block (extraction tokens, communities, corpus size) for the selected
// collection. Absent collection_id keeps the M5 shape (scale nil, backward-compat).
// tenant/workspace query params are IGNORED (the tenant comes from the JWT).
func (h *RagDashboardHandler) Analytics(w http.ResponseWriter, r *http.Request) {
	if user := auth.GetUser(r.Context()); user == nil || user.TenantID == "" {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	q := r.URL.Query()
	res, err := h.client.Analytics(r.Context(), q.Get("collection_id"), q.Get("since"))
	if err != nil {
		h.logger.Warn("rag dashboard: analytics failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load analytics.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ListDocuments serves GET /v1/dashboard/rag/documents?collection_id — the caller
// workspace's documents + ingest status, via the per-tenant key.
func (h *RagDashboardHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
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
	res, err := h.client.ListDocuments(r.Context(), q.Get("collection_id"), limit, offset)
	if err != nil {
		h.logger.Warn("rag dashboard: list documents failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list documents.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// authTenant enforces the JWT session (fail-closed 401 when no tenant). Returns false
// (and writes the 401) when the caller is not an authenticated tenant.
func (h *RagDashboardHandler) authTenant(w http.ResponseWriter, r *http.Request) bool {
	if user := auth.GetUser(r.Context()); user != nil && user.TenantID != "" {
		return true
	}
	writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
	return false
}

// CreateCollection serves POST /v1/dashboard/rag/collections (M21). The per-tenant
// rag:write key gates the write at theo-rag; the tenant comes from the JWT, never the body.
func (h *RagDashboardHandler) CreateCollection(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	var in rag.CreateCollectionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Name == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A non-empty collection name is required.")
		return
	}
	out, err := h.client.CreateCollection(r.Context(), in)
	if err != nil {
		h.logger.Warn("rag dashboard: create collection failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not create the collection.")
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// DeleteCollection serves DELETE /v1/dashboard/rag/collections/{id} (M21, rag:delete).
func (h *RagDashboardHandler) DeleteCollection(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A collection id is required.")
		return
	}
	if err := h.client.DeleteCollection(r.Context(), id); err != nil {
		h.logger.Warn("rag dashboard: delete collection failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the collection.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListConnectors serves GET /v1/dashboard/rag/connectors (#191) — the workspace's
// connector connections (non-secret view), via the per-tenant key (rag:read).
func (h *RagDashboardHandler) ListConnectors(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	res, err := h.client.ListConnectors(r.Context())
	if err != nil {
		h.logger.Warn("rag dashboard: list connectors failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list connectors.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// SyncConnector serves POST /v1/dashboard/rag/connectors/{id}/sync (#191, rag:write) —
// enqueues a sync; passes through theo-rag's 202 body.
func (h *RagDashboardHandler) SyncConnector(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A connector id is required.")
		return
	}
	out, err := h.client.SyncConnector(r.Context(), id)
	if err != nil {
		h.logger.Warn("rag dashboard: sync connector failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not start the sync.")
		return
	}
	writeJSON(w, http.StatusAccepted, out)
}

// DeleteConnector serves DELETE /v1/dashboard/rag/connectors/{id} (#191, rag:delete).
func (h *RagDashboardHandler) DeleteConnector(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A connector id is required.")
		return
	}
	if err := h.client.DeleteConnector(r.Context(), id); err != nil {
		h.logger.Warn("rag dashboard: delete connector failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the connector.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// IngestDocument serves POST /v1/dashboard/rag/documents (M21, rag:write). Text ingest
// is async at theo-rag (202); the raw upstream body (with the doc id + status) passes through.
func (h *RagDashboardHandler) IngestDocument(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	var in rag.IngestInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.CollectionID == "" || in.Text == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "collection_id and text are required.")
		return
	}
	out, err := h.client.IngestDocument(r.Context(), in)
	if err != nil {
		h.logger.Warn("rag dashboard: ingest document failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not ingest the document.")
		return
	}
	writeJSON(w, http.StatusAccepted, json.RawMessage(out))
}

// DeleteDocument serves DELETE /v1/dashboard/rag/documents/{id} (M21, rag:delete).
func (h *RagDashboardHandler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A document id is required.")
		return
	}
	if err := h.client.DeleteDocument(r.Context(), id); err != nil {
		h.logger.Warn("rag dashboard: delete document failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the document.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Ask serves POST /v1/dashboard/rag/answers (M21, rag:read). A query returns a cited answer;
// the raw upstream answer body (answer + sources) passes through.

// validAskStrategy reports whether s is one of theo-rag's retrieval strategies (M9 —
// vector|keyword|hybrid|graph|global). Kept in lockstep with theo-rag's enum.
func validAskStrategy(s string) bool {
	switch s {
	case "vector", "keyword", "hybrid", "graph", "global":
		return true
	default:
		return false
	}
}

func (h *RagDashboardHandler) Ask(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	var in rag.AskInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.CollectionID == "" || in.Question == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "collection_id and question are required.")
		return
	}
	// M9 — fail-fast on an unknown strategy at the boundary (error-handling.md): reject it
	// here with a clear typed 422 rather than forwarding a bad value upstream. An empty
	// strategy is valid (theo-rag defaults to vector).
	if in.Strategy != "" && !validAskStrategy(in.Strategy) {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "strategy must be one of vector, keyword, hybrid, graph, global.")
		return
	}
	out, err := h.client.Ask(r.Context(), in)
	if err != nil {
		h.logger.Warn("rag dashboard: ask failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not answer the question.")
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(out))
}
