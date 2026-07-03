// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/auth"
)

// LensDataClient is the theo-lens proxy the dashboard BFF depends on (DIP — a stub satisfies it
// in tests). Satisfied by *thelens.DataClient. M44 extends the M41 read-only surface to
// read+write+delete: the interface adds the mutating methods for datasets / evaluators / guards /
// trace tags+annotations (the writable surfaces) plus the reads the new pages need. Each method
// returns the upstream body verbatim (json.RawMessage) — the BFF is a thin proxy that never
// re-models theo-lens's shape. theo-lens enforces the per-verb lens:* scope on the minted key.
type LensDataClient interface {
	// Reads (M41 + M44)
	ListTraces(ctx context.Context, limit, offset int) (json.RawMessage, error)
	ListSessions(ctx context.Context, limit, offset int) (json.RawMessage, error)
	Observability(ctx context.Context) (json.RawMessage, error)
	Cost(ctx context.Context, since string) (json.RawMessage, error)
	ListDatasets(ctx context.Context) (json.RawMessage, error)
	GetDataset(ctx context.Context, id string) (json.RawMessage, error)
	ListEvaluators(ctx context.Context) (json.RawMessage, error)
	ListGuards(ctx context.Context) (json.RawMessage, error)
	GuardBreaches(ctx context.Context, id string) (json.RawMessage, error)
	ListAgents(ctx context.Context) (json.RawMessage, error)
	GetTrace(ctx context.Context, id string) (json.RawMessage, error)
	Ask(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	// Writes (M44) — datasets / evaluators / guards / trace metadata
	CreateDataset(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	AddDatasetItem(ctx context.Context, datasetID string, body json.RawMessage) (json.RawMessage, error)
	DeleteDatasetItem(ctx context.Context, datasetID, traceID string) (json.RawMessage, error)
	CreateEvaluator(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	RunEvaluator(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error)
	DeleteEvaluator(ctx context.Context, id string) (json.RawMessage, error)
	CreateGuard(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	DeleteGuard(ctx context.Context, id string) (json.RawMessage, error)
	AddTraceTag(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	DeleteTraceTag(ctx context.Context, traceID, tag string) (json.RawMessage, error)
	AddTraceAnnotation(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	DeleteTraceAnnotation(ctx context.Context, traceID string, q url.Values) (json.RawMessage, error)
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

// --- M44 read+write+delete management surface --------------------------------------------

// readBody reads the browser request body (bounded) so a write handler can forward it verbatim.
func readBody(r *http.Request) json.RawMessage {
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	return json.RawMessage(b)
}

// proxy runs fn (an upstream call) behind the fail-closed tenant guard and writes the result:
// 401 when no tenant, 502 on upstream error, otherwise 200 + the pass-through body.
func (h *LensDashboardHandler) proxy(w http.ResponseWriter, r *http.Request, what string, fn func() (json.RawMessage, error)) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := fn()
	if err != nil {
		h.logger.Warn("lens dashboard: "+what+" failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not "+what+".")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// Reads the new pages need.

func (h *LensDashboardHandler) ListDatasets(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list datasets", func() (json.RawMessage, error) { return h.client.ListDatasets(r.Context()) })
}
func (h *LensDashboardHandler) GetDataset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	h.proxy(w, r, "get dataset", func() (json.RawMessage, error) { return h.client.GetDataset(r.Context(), id) })
}
func (h *LensDashboardHandler) ListEvaluators(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list evaluators", func() (json.RawMessage, error) { return h.client.ListEvaluators(r.Context()) })
}
func (h *LensDashboardHandler) ListGuards(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list guards", func() (json.RawMessage, error) { return h.client.ListGuards(r.Context()) })
}
func (h *LensDashboardHandler) GuardBreaches(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "guardID")
	h.proxy(w, r, "load guard breaches", func() (json.RawMessage, error) { return h.client.GuardBreaches(r.Context(), id) })
}
func (h *LensDashboardHandler) ListAgents(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list agents", func() (json.RawMessage, error) { return h.client.ListAgents(r.Context()) })
}
func (h *LensDashboardHandler) GetTrace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "get trace", func() (json.RawMessage, error) { return h.client.GetTrace(r.Context(), id) })
}
func (h *LensDashboardHandler) Ask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	body := readBody(r)
	h.proxy(w, r, "ask", func() (json.RawMessage, error) { return h.client.Ask(r.Context(), id, body) })
}

// Writes — datasets.

func (h *LensDashboardHandler) CreateDataset(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	h.proxy(w, r, "create dataset", func() (json.RawMessage, error) { return h.client.CreateDataset(r.Context(), body) })
}
func (h *LensDashboardHandler) AddDatasetItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	body := readBody(r)
	h.proxy(w, r, "add dataset item", func() (json.RawMessage, error) { return h.client.AddDatasetItem(r.Context(), id, body) })
}
func (h *LensDashboardHandler) DeleteDatasetItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	traceID := chi.URLParam(r, "traceID")
	h.proxy(w, r, "delete dataset item", func() (json.RawMessage, error) { return h.client.DeleteDatasetItem(r.Context(), id, traceID) })
}

// Writes — evaluators.

func (h *LensDashboardHandler) CreateEvaluator(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	h.proxy(w, r, "create evaluator", func() (json.RawMessage, error) { return h.client.CreateEvaluator(r.Context(), body) })
}
func (h *LensDashboardHandler) RunEvaluator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "evaluatorID")
	body := readBody(r)
	h.proxy(w, r, "run evaluator", func() (json.RawMessage, error) { return h.client.RunEvaluator(r.Context(), id, body) })
}
func (h *LensDashboardHandler) DeleteEvaluator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "evaluatorID")
	h.proxy(w, r, "delete evaluator", func() (json.RawMessage, error) { return h.client.DeleteEvaluator(r.Context(), id) })
}

// Writes — guards.

func (h *LensDashboardHandler) CreateGuard(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	h.proxy(w, r, "create guard", func() (json.RawMessage, error) { return h.client.CreateGuard(r.Context(), body) })
}
func (h *LensDashboardHandler) DeleteGuard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "guardID")
	h.proxy(w, r, "delete guard", func() (json.RawMessage, error) { return h.client.DeleteGuard(r.Context(), id) })
}

// Writes — trace metadata (tags + annotations). The trace/session BODY is never mutated (ADR-3).

func (h *LensDashboardHandler) AddTraceTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	body := readBody(r)
	h.proxy(w, r, "add tag", func() (json.RawMessage, error) { return h.client.AddTraceTag(r.Context(), id, body) })
}
func (h *LensDashboardHandler) DeleteTraceTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	tag := r.URL.Query().Get("tag")
	h.proxy(w, r, "delete tag", func() (json.RawMessage, error) { return h.client.DeleteTraceTag(r.Context(), id, tag) })
}
func (h *LensDashboardHandler) AddTraceAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	body := readBody(r)
	h.proxy(w, r, "add annotation", func() (json.RawMessage, error) { return h.client.AddTraceAnnotation(r.Context(), id, body) })
}
func (h *LensDashboardHandler) DeleteTraceAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "delete annotation", func() (json.RawMessage, error) {
		return h.client.DeleteTraceAnnotation(r.Context(), id, r.URL.Query())
	})
}

// MountLensDashboard registers the /v1/dashboard/lens BFF (reads + writes) under requireJWT.
// The route SET is the ADR-3 contract: NO mutating verb on the trace/session body or on /agents;
// trace tags/annotations ARE writable metadata. cmd/main.go calls this to wire the handler.
func MountLensDashboard(r chi.Router, h *LensDashboardHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/lens", func(r chi.Router) {
		r.Use(requireJWT)
		// Reads (M41 + M44)
		r.Get("/traces", h.ListTraces)
		r.Get("/traces/{traceID}", h.GetTrace)
		r.Get("/sessions", h.ListSessions)
		r.Get("/observability", h.Observability)
		r.Get("/cost", h.Cost)
		r.Get("/datasets", h.ListDatasets)
		r.Get("/datasets/{datasetID}", h.GetDataset)
		r.Get("/evaluators", h.ListEvaluators)
		r.Get("/guards", h.ListGuards)
		r.Get("/guards/{guardID}/breaches", h.GuardBreaches)
		r.Get("/agents", h.ListAgents)
		r.Post("/traces/{traceID}/ask", h.Ask) // read-scope copilot query
		// Writes — datasets
		r.Post("/datasets", h.CreateDataset)
		r.Post("/datasets/{datasetID}/items", h.AddDatasetItem)
		r.Delete("/datasets/{datasetID}/items/{traceID}", h.DeleteDatasetItem)
		// Writes — evaluators
		r.Post("/evaluators", h.CreateEvaluator)
		r.Post("/evaluators/{evaluatorID}/run", h.RunEvaluator)
		r.Delete("/evaluators/{evaluatorID}", h.DeleteEvaluator)
		// Writes — guards
		r.Post("/guards", h.CreateGuard)
		r.Delete("/guards/{guardID}", h.DeleteGuard)
		// Writes — trace metadata (tags + annotations); NEVER the trace/session body
		r.Post("/traces/{traceID}/tags", h.AddTraceTag)
		r.Delete("/traces/{traceID}/tags", h.DeleteTraceTag)
		r.Post("/traces/{traceID}/annotations", h.AddTraceAnnotation)
		r.Delete("/traces/{traceID}/annotations", h.DeleteTraceAnnotation)
	})
}
