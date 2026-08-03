// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/thelens"
)

// LensDataClient is the theo-lens proxy the dashboard BFF depends on (DIP — a stub satisfies it
// in tests). Satisfied by *thelens.DataClient. M44 extends the M41 read-only surface to
// read+write+delete: the interface adds the mutating methods for datasets / evaluators / guards /
// trace tags+annotations (the writable surfaces) plus the reads the new pages need. Each method
// returns the upstream body verbatim (json.RawMessage) — the BFF is a thin proxy that never
// re-models theo-lens's shape. theo-lens enforces the per-verb lens:* scope on the minted key.
type LensDataClient interface {
	// Reads (M41 + M44; M49 adds the whitelisted trace-list filter)
	ListTraces(ctx context.Context, f thelens.TraceListFilter) (json.RawMessage, error)
	ListSessions(ctx context.Context, limit, offset int) (json.RawMessage, error)
	Observability(ctx context.Context, timeRange string) (json.RawMessage, error)
	Scores(ctx context.Context, timeRange string) (json.RawMessage, error)
	SpanAttributes(ctx context.Context, key string) (json.RawMessage, error)
	Cost(ctx context.Context, since string) (json.RawMessage, error)
	// M141 — consumption grouped by end user. Takes the whole url.Values (never field-by-field):
	// the BFF forwards the caller's query verbatim instead of deciding which params exist.
	UsageByUser(ctx context.Context, q url.Values) (json.RawMessage, error)
	ListDatasets(ctx context.Context) (json.RawMessage, error)
	GetDataset(ctx context.Context, id string) (json.RawMessage, error)
	ListEvaluators(ctx context.Context) (json.RawMessage, error)
	ListMonitors(ctx context.Context) (json.RawMessage, error)
	MonitorBreaches(ctx context.Context, id string) (json.RawMessage, error)
	ListAgents(ctx context.Context) (json.RawMessage, error)
	GetTrace(ctx context.Context, id string) (json.RawMessage, error)
	GetTraceCost(ctx context.Context, id string) (json.RawMessage, error)
	GetTraceTags(ctx context.Context, id string) (json.RawMessage, error)
	GetTraceAnnotations(ctx context.Context, id string) (json.RawMessage, error)
	Ask(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	AskFeedback(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	DeleteAskFeedback(ctx context.Context, traceID, turnID string) (json.RawMessage, error)
	Replay(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	// M131 — Session Coherence: cached verdict read + billable run (proxied to theo-lens).
	GetSessionCoherence(ctx context.Context, id string) (json.RawMessage, error)
	RunSessionCoherence(ctx context.Context, id string) (json.RawMessage, error)
	// Writes (M44) — datasets / evaluators / guards / trace metadata
	CreateDataset(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	RenameDataset(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error)
	DeleteDataset(ctx context.Context, id string) (json.RawMessage, error)
	AddDatasetItem(ctx context.Context, datasetID string, body json.RawMessage) (json.RawMessage, error)
	DeleteDatasetItem(ctx context.Context, datasetID, traceID string) (json.RawMessage, error)
	CreateEvaluator(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	UpdateEvaluator(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error)
	RunEvaluator(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error)
	// M133 — poll an async evaluator-run job's status/progress.
	GetEvaluatorRunJob(ctx context.Context, id string) (json.RawMessage, error)
	DeleteEvaluator(ctx context.Context, id string) (json.RawMessage, error)
	CreateMonitor(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	DeleteMonitor(ctx context.Context, id string) (json.RawMessage, error)
	AddTraceTag(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	DeleteTraceTag(ctx context.Context, traceID, tag string) (json.RawMessage, error)
	AddTraceAnnotation(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	DeleteTraceAnnotation(ctx context.Context, traceID string, q url.Values) (json.RawMessage, error)
	// Reads + writes (M63) — labeling queues (Annotate → review → golden dataset)
	ListLabelingQueue(ctx context.Context, q url.Values) (json.RawMessage, error)
	GetLabelingQueueItem(ctx context.Context, itemID string) (json.RawMessage, error)
	EnqueueSpanForLabeling(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error)
	ResolveLabelingItem(ctx context.Context, itemID string, body json.RawMessage) (json.RawMessage, error)
	ExportLabelingQueueAsDataset(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	// Reads + writes (M64) — experiments (regression-dataset-run + compare)
	CreateExperimentRun(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	ListExperimentRuns(ctx context.Context, q url.Values) (json.RawMessage, error)
	GetExperimentRun(ctx context.Context, runID string) (json.RawMessage, error)
	CompareExperimentRuns(ctx context.Context, q url.Values) (json.RawMessage, error)
}

// LensDashboardHandler serves the read-only /v1/dashboard/lens BFF. Browser JWT sessions
// (requireJWT) reach it; the injected data client proxies to theo-lens with a per-tenant
// observability:read key resolved from the JWT tenant (never the request body/params). Read-only:
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

// pageParams parses limit (1..500) + offset (>=0) from the query; 0 means "unset".
func pageParams(r *http.Request) (limit, offset int) {
	q := r.URL.Query()
	if v := q.Get("limit"); v != "" {
		// M56: the export pages at limit=500 (theo-lens LIST_TRACES_LIMIT_CAP). A value above the cap is
		// dropped (theo-lens would 400 on it), never silently clamped to a smaller page.
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
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

// observabilityRange reads the WHITELISTED time-range for the observability series (M51). Only the
// theo-lens-supported presets are honored; anything else (empty/invalid) returns "" so theo-lens
// applies its own 24h default — an arbitrary range string is structurally unforwardable.
func observabilityRange(r *http.Request) string {
	switch r.URL.Query().Get("range") {
	case "1h", "24h", "7d", "30d":
		return r.URL.Query().Get("range")
	default:
		return ""
	}
}

// traceFilter reads the WHITELISTED trace-list filter params from the request query (M49). Only the
// known keys (status/model/from/to/q + limit/offset) are read; a request's unknown params are never
// forwarded to theo-lens. Values pass through — theo-lens validates them (e.g. a bad status → 400).
func traceFilter(r *http.Request) thelens.TraceListFilter {
	limit, offset := pageParams(r)
	q := r.URL.Query()
	return thelens.TraceListFilter{
		Limit:  limit,
		Offset: offset,
		Status: q.Get("status"),
		Model:  q.Get("model"),
		From:   q.Get("from"),
		To:     q.Get("to"),
		Q:      q.Get("q"),
		// M52: advanced filters (whitelist by construction — an unknown param has no field).
		MinCostUsd: q.Get("min_cost_usd"),
		MaxCostUsd: q.Get("max_cost_usd"),
		MinTokens:  q.Get("min_tokens"),
		MaxTokens:  q.Get("max_tokens"),
		SessionID:  q.Get("session_id"),
		SpanQuery:  q.Get("span_query"), // M92: the span-query DSL; theo-lens parses + validates (injection-safe).
	}
}

// ListTraces serves GET /v1/dashboard/lens/traces — the caller workspace's traces (M49: filtered by
// the whitelisted query params), via the per-tenant observability:read key resolved from the JWT
// session (fail-closed 401 when no tenant).
func (h *LensDashboardHandler) ListTraces(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := h.client.ListTraces(r.Context(), traceFilter(r))
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
	raw, err := h.client.Observability(r.Context(), observabilityRange(r))
	if err != nil {
		h.logger.Warn("lens dashboard: observability failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load observability.")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// Scores serves GET /v1/dashboard/lens/metrics/scores — the caller workspace's per-evaluator
// score aggregation over time (theo-lens GET /v1/metrics/scores, M90). Same whitelisted range.
func (h *LensDashboardHandler) Scores(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := h.client.Scores(r.Context(), observabilityRange(r))
	if err != nil {
		h.logger.Warn("lens dashboard: scores failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load scores.")
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// SpanAttributes serves GET /v1/dashboard/lens/metrics/span-attributes — facet discovery (M92):
// the caller workspace's top attribute keys, or (with ?key=) the top values for one key. The key
// passes through to theo-lens, which binds it as a jsonb path (injection-safe).
func (h *LensDashboardHandler) SpanAttributes(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := h.client.SpanAttributes(r.Context(), r.URL.Query().Get("key"))
	if err != nil {
		h.logger.Warn("lens dashboard: span-attributes failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load span attributes.")
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

// UsageByUser serves GET /v1/dashboard/lens/usage-by-user — the caller workspace's consumption
// grouped by end user (theo-lens GET /v1/analytics/usage-by-user, M140).
//
// It goes through h.proxy, NOT through the older shape of Cost above, and the difference is
// load-bearing: M140 REJECTS an out-of-range `days`/`limit` with a typed 400 instead of clamping in
// silence, precisely because a silent clamp made callers page through the wrong rows. Cost's shape
// collapses every upstream failure into a generic 502, which would throw that 400 away and leave
// the browser with "could not load" and no reason. h.proxy forwards a browser-actionable 4xx
// verbatim, so the typed error survives end to end.
//
// The query is passed WHOLE (r.URL.Query()), never rebuilt param by param — see the interface note.
func (h *LensDashboardHandler) UsageByUser(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "load usage by user", func() (json.RawMessage, error) {
		return h.client.UsageByUser(r.Context(), r.URL.Query())
	})
}

// --- M44 read+write+delete management surface --------------------------------------------

// browserActionableUpstream reports whether a theo-lens status is one the BROWSER can act on and so
// should be forwarded verbatim (M82). Forwarded: a 4xx the caller can fix or react to — 400 invalid
// input, 404 absent, 409 name-conflict, 422 unprocessable, 429 rate-limited. NOT forwarded: 401/403,
// because those reflect the BFF↔theo-lens minted-key trust boundary, NOT the browser's JWT session —
// forwarding a 401 would trip the dashboard's session-expiry redirect (a spurious logout on a broker
// misconfig), and a 403 would falsely tell an authorized user they lack access. Everything else
// (401/403 + 5xx + non-status transport errors) collapses to a generic 502 (fail-closed).
func browserActionableUpstream(status int) bool {
	switch status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict,
		http.StatusUnprocessableEntity, http.StatusTooManyRequests:
		return true
	default:
		return false
	}
}

// writeUpstreamErr maps an upstream failure to the client. A browser-actionable theo-lens 4xx
// (*thelens.UpstreamStatusError, per browserActionableUpstream) is FORWARDED verbatim — the real
// status + theo-lens's own {code,message} body — so the browser can act on it (e.g. show "name
// already taken" on a 409). Every other upstream status (401/403 minted-key boundary, 5xx) and any
// transport/resolver error collapses to a generic 502 (fail-closed — never a spurious session
// redirect).
func (h *LensDashboardHandler) writeUpstreamErr(w http.ResponseWriter, what string, err error) {
	var ue *thelens.UpstreamStatusError
	if errors.As(err, &ue) && browserActionableUpstream(ue.Status) {
		h.logger.Warn("lens dashboard: "+what+" upstream status", "status", ue.Status)
		writeJSON(w, ue.Status, json.RawMessage(ue.Body))
		return
	}
	h.logger.Warn("lens dashboard: "+what+" failed", "error", err)
	writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not "+what+".")
}

// proxy runs fn (an upstream call) behind the fail-closed tenant guard and writes the result:
// 401 when no tenant, the forwarded upstream status on a theo-lens non-2xx (502 only on a
// transport error), otherwise 200 + the pass-through body.
func (h *LensDashboardHandler) proxy(w http.ResponseWriter, r *http.Request, what string, fn func() (json.RawMessage, error)) {
	if !h.authTenant(w, r) {
		return
	}
	raw, err := fn()
	if err != nil {
		h.writeUpstreamErr(w, what, err)
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// proxyBody is proxy for write routes that forward the browser's JSON body verbatim. It runs
// behind the fail-closed tenant guard (401 no tenant), reads the bounded request body and FAILS
// LOUD with 400 on a read error (never silently forwards a truncated body — error-handling.md),
// then hands the body to fn and passes the upstream result through.
func (h *LensDashboardHandler) proxyBody(w http.ResponseWriter, r *http.Request, what string, fn func(body json.RawMessage) (json.RawMessage, error)) {
	if !h.authTenant(w, r) {
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		h.logger.Warn("lens dashboard: "+what+" read body failed", "error", err)
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Could not read the request body.")
		return
	}
	raw, err := fn(json.RawMessage(b))
	if err != nil {
		h.writeUpstreamErr(w, what, err)
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
func (h *LensDashboardHandler) ListMonitors(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list guards", func() (json.RawMessage, error) { return h.client.ListMonitors(r.Context()) })
}
func (h *LensDashboardHandler) MonitorBreaches(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "monitorID")
	h.proxy(w, r, "load guard breaches", func() (json.RawMessage, error) { return h.client.MonitorBreaches(r.Context(), id) })
}
func (h *LensDashboardHandler) ListAgents(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list agents", func() (json.RawMessage, error) { return h.client.ListAgents(r.Context()) })
}
func (h *LensDashboardHandler) GetTrace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "get trace", func() (json.RawMessage, error) { return h.client.GetTrace(r.Context(), id) })
}

// GetTraceCost serves GET /v1/dashboard/lens/traces/{traceID}/cost — the per-trace cost summary
// (theo-lens GET /v1/traces/:id/cost, M5). Feeds the M54 compare view's delta table. Same per-tenant
// Model-B path + upstream-error mapping as GetTrace (h.proxy), so a foreign/missing trace is refused
// upstream exactly like the single-trace detail — no fabricated cost, no cross-tenant leak.
func (h *LensDashboardHandler) GetTraceCost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "get trace cost", func() (json.RawMessage, error) { return h.client.GetTraceCost(r.Context(), id) })
}
func (h *LensDashboardHandler) GetTraceTags(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "get tags", func() (json.RawMessage, error) { return h.client.GetTraceTags(r.Context(), id) })
}

// GetSessionCoherence serves GET /v1/dashboard/lens/sessions/{sessionID}/coherence — the cached
// Session Coherence verdict (theo-lens GET /v1/sessions/:id/coherence, M131). null verdict → badge
// "pending". Same per-tenant Model-B path + fail-closed guard as the trace reads (h.proxy).
func (h *LensDashboardHandler) GetSessionCoherence(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "sessionID")
	h.proxy(w, r, "get session coherence", func() (json.RawMessage, error) { return h.client.GetSessionCoherence(r.Context(), id) })
}

// RunSessionCoherence serves POST /v1/dashboard/lens/sessions/{sessionID}/coherence — runs the
// billable session-coherence judge (theo-lens POST, rate-limited + write scope). No request body.
func (h *LensDashboardHandler) RunSessionCoherence(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "sessionID")
	h.proxy(w, r, "run session coherence", func() (json.RawMessage, error) { return h.client.RunSessionCoherence(r.Context(), id) })
}
func (h *LensDashboardHandler) GetTraceAnnotations(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "get annotations", func() (json.RawMessage, error) { return h.client.GetTraceAnnotations(r.Context(), id) })
}
func (h *LensDashboardHandler) Ask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxyBody(w, r, "ask", func(body json.RawMessage) (json.RawMessage, error) { return h.client.Ask(r.Context(), id, body) })
}

// AskFeedback serves POST /v1/dashboard/lens/traces/{traceID}/ask/feedback — the M83 thumbs up/down
// (theo-lens POST /v1/traces/:id/ask/feedback, write-scope). Independent of the LLM; the browser body
// ({turnId,label}) is forwarded verbatim behind the fail-closed tenant guard.
func (h *LensDashboardHandler) AskFeedback(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxyBody(w, r, "ask feedback", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.AskFeedback(r.Context(), id, body)
	})
}

// DeleteAskFeedback serves DELETE /v1/dashboard/lens/traces/{traceID}/ask/feedback?turnId= — the M83
// vote retract (theo-lens DELETE, write-scope). turnId comes from the query (whitelisted).
func (h *LensDashboardHandler) DeleteAskFeedback(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	turnID := r.URL.Query().Get("turnId")
	h.proxy(w, r, "delete ask feedback", func() (json.RawMessage, error) {
		return h.client.DeleteAskFeedback(r.Context(), id, turnID)
	})
}

// Replay serves POST /v1/dashboard/lens/traces/{traceID}/replay — the M55 span replay (theo-lens
// POST /v1/traces/:id/replay): re-run an edited message list against the real provider server-side.
// Same per-tenant Model-B path + fail-closed body-proxy as Ask; a read-scope EPHEMERAL provider call
// that never mutates the trace body (the persist path is save-as-dataset). The browser never holds a
// provider key — the credential stays in theo-lens.
func (h *LensDashboardHandler) Replay(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxyBody(w, r, "replay", func(body json.RawMessage) (json.RawMessage, error) { return h.client.Replay(r.Context(), id, body) })
}

// Writes — datasets.

func (h *LensDashboardHandler) CreateDataset(w http.ResponseWriter, r *http.Request) {
	h.proxyBody(w, r, "create dataset", func(body json.RawMessage) (json.RawMessage, error) { return h.client.CreateDataset(r.Context(), body) })
}
func (h *LensDashboardHandler) RenameDataset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	h.proxyBody(w, r, "rename dataset", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.RenameDataset(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) DeleteDataset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	h.proxy(w, r, "delete dataset", func() (json.RawMessage, error) { return h.client.DeleteDataset(r.Context(), id) })
}
func (h *LensDashboardHandler) AddDatasetItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	h.proxyBody(w, r, "add dataset item", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.AddDatasetItem(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) DeleteDatasetItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "datasetID")
	traceID := chi.URLParam(r, "traceID")
	h.proxy(w, r, "delete dataset item", func() (json.RawMessage, error) { return h.client.DeleteDatasetItem(r.Context(), id, traceID) })
}

// Writes — evaluators.

func (h *LensDashboardHandler) CreateEvaluator(w http.ResponseWriter, r *http.Request) {
	h.proxyBody(w, r, "create evaluator", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.CreateEvaluator(r.Context(), body)
	})
}
func (h *LensDashboardHandler) UpdateEvaluator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "evaluatorID")
	h.proxyBody(w, r, "update evaluator", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.UpdateEvaluator(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) RunEvaluator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "evaluatorID")
	h.proxyBody(w, r, "run evaluator", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.RunEvaluator(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) DeleteEvaluator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "evaluatorID")
	h.proxy(w, r, "delete evaluator", func() (json.RawMessage, error) { return h.client.DeleteEvaluator(r.Context(), id) })
}

// GetEvaluatorRunJob polls an async evaluator-run job (M133): status + scored/total progress.
func (h *LensDashboardHandler) GetEvaluatorRunJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "jobID")
	h.proxy(w, r, "get evaluator run job", func() (json.RawMessage, error) { return h.client.GetEvaluatorRunJob(r.Context(), id) })
}

// Writes — guards.

func (h *LensDashboardHandler) CreateMonitor(w http.ResponseWriter, r *http.Request) {
	h.proxyBody(w, r, "create guard", func(body json.RawMessage) (json.RawMessage, error) { return h.client.CreateMonitor(r.Context(), body) })
}
func (h *LensDashboardHandler) DeleteMonitor(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "monitorID")
	h.proxy(w, r, "delete guard", func() (json.RawMessage, error) { return h.client.DeleteMonitor(r.Context(), id) })
}

// Writes — trace metadata (tags + annotations). The trace/session BODY is never mutated (ADR-3).

func (h *LensDashboardHandler) AddTraceTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxyBody(w, r, "add tag", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.AddTraceTag(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) DeleteTraceTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	tag := r.URL.Query().Get("tag")
	h.proxy(w, r, "delete tag", func() (json.RawMessage, error) { return h.client.DeleteTraceTag(r.Context(), id, tag) })
}
func (h *LensDashboardHandler) AddTraceAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxyBody(w, r, "add annotation", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.AddTraceAnnotation(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) DeleteTraceAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxy(w, r, "delete annotation", func() (json.RawMessage, error) {
		return h.client.DeleteTraceAnnotation(r.Context(), id, r.URL.Query())
	})
}

// M63 — labeling queues. All behind the fail-closed tenant guard; the per-tenant observability
// read/write scope is enforced upstream (theo-lens), the BFF is a thin verbatim proxy.
func (h *LensDashboardHandler) ListLabelingQueue(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list labeling queue", func() (json.RawMessage, error) {
		return h.client.ListLabelingQueue(r.Context(), r.URL.Query())
	})
}
func (h *LensDashboardHandler) GetLabelingQueueItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "itemID")
	h.proxy(w, r, "get labeling queue item", func() (json.RawMessage, error) {
		return h.client.GetLabelingQueueItem(r.Context(), id)
	})
}
func (h *LensDashboardHandler) EnqueueSpanForLabeling(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "traceID")
	h.proxyBody(w, r, "enqueue span for labeling", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.EnqueueSpanForLabeling(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) ResolveLabelingItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "itemID")
	h.proxyBody(w, r, "resolve labeling item", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.ResolveLabelingItem(r.Context(), id, body)
	})
}
func (h *LensDashboardHandler) ExportLabelingQueueAsDataset(w http.ResponseWriter, r *http.Request) {
	h.proxyBody(w, r, "export labeling queue as dataset", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.ExportLabelingQueueAsDataset(r.Context(), body)
	})
}

// M64 — experiments. All behind the fail-closed tenant guard; the per-tenant observability read/write
// scope is enforced upstream (theo-lens), the BFF is a thin verbatim proxy.
func (h *LensDashboardHandler) CreateExperimentRun(w http.ResponseWriter, r *http.Request) {
	h.proxyBody(w, r, "create experiment run", func(body json.RawMessage) (json.RawMessage, error) {
		return h.client.CreateExperimentRun(r.Context(), body)
	})
}
func (h *LensDashboardHandler) ListExperimentRuns(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "list experiment runs", func() (json.RawMessage, error) {
		return h.client.ListExperimentRuns(r.Context(), r.URL.Query())
	})
}
func (h *LensDashboardHandler) GetExperimentRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "runID")
	h.proxy(w, r, "get experiment run", func() (json.RawMessage, error) {
		return h.client.GetExperimentRun(r.Context(), id)
	})
}
func (h *LensDashboardHandler) CompareExperimentRuns(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "compare experiment runs", func() (json.RawMessage, error) {
		return h.client.CompareExperimentRuns(r.Context(), r.URL.Query())
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
		r.Get("/traces/{traceID}/cost", h.GetTraceCost) // M54 — per-trace cost for the compare delta table
		r.Get("/traces/{traceID}/tags", h.GetTraceTags)
		r.Get("/traces/{traceID}/annotations", h.GetTraceAnnotations)
		r.Get("/sessions", h.ListSessions)
		r.Get("/sessions/{sessionID}/coherence", h.GetSessionCoherence) // M131 — cached coherence verdict
		r.Get("/observability", h.Observability)
		r.Get("/metrics/scores", h.Scores)                  // M90 — score aggregation over time
		r.Get("/metrics/span-attributes", h.SpanAttributes) // M92 — attribute facet discovery
		r.Get("/cost", h.Cost)
		r.Get("/usage-by-user", h.UsageByUser) // M141 — consumption grouped by end user
		r.Get("/datasets", h.ListDatasets)
		r.Get("/datasets/{datasetID}", h.GetDataset)
		r.Get("/evaluators", h.ListEvaluators)
		// M136 — /monitors is canonical; /guards is the deprecated alias for one release, pointing
		// at the SAME handler so the two can never drift apart.
		r.Get("/monitors", h.ListMonitors)
		r.Get("/monitors/{monitorID}/breaches", h.MonitorBreaches)
		r.Get("/guards", h.ListMonitors)
		r.Get("/guards/{monitorID}/breaches", h.MonitorBreaches)
		r.Get("/agents", h.ListAgents)
		r.Get("/labeling-queue", h.ListLabelingQueue) // M63 — read-scope queue list
		r.Get("/labeling-queue/{itemID}", h.GetLabelingQueueItem)
		r.Get("/experiment-runs", h.ListExperimentRuns)            // M64 — read-scope run list
		r.Get("/experiment-runs/compare", h.CompareExperimentRuns) // before :runID so "compare" is not a run id
		r.Get("/experiment-runs/{runID}", h.GetExperimentRun)
		r.Post("/traces/{traceID}/ask", h.Ask)                           // read-scope copilot query
		r.Post("/traces/{traceID}/ask/feedback", h.AskFeedback)          // M83 write-scope thumbs feedback
		r.Delete("/traces/{traceID}/ask/feedback", h.DeleteAskFeedback)  // M83 retract (clear)
		r.Post("/traces/{traceID}/replay", h.Replay)                     // M55 — read-scope ephemeral provider replay
		r.Post("/sessions/{sessionID}/coherence", h.RunSessionCoherence) // M131 — run the coherence judge (write scope)
		// Writes — datasets
		r.Post("/datasets", h.CreateDataset)
		r.Put("/datasets/{datasetID}", h.RenameDataset)    // M82 — rename (409 on duplicate)
		r.Delete("/datasets/{datasetID}", h.DeleteDataset) // M82 — delete (cascades runs+items)
		r.Post("/datasets/{datasetID}/items", h.AddDatasetItem)
		r.Delete("/datasets/{datasetID}/items/{traceID}", h.DeleteDatasetItem)
		// Writes — evaluators
		r.Post("/evaluators", h.CreateEvaluator)
		r.Put("/evaluators/{evaluatorID}", h.UpdateEvaluator) // M82 — rename/partial-edit (409 on duplicate)
		r.Post("/evaluators/{evaluatorID}/run", h.RunEvaluator)
		r.Get("/evaluator-run-jobs/{jobID}", h.GetEvaluatorRunJob) // M133 — poll async run progress
		r.Delete("/evaluators/{evaluatorID}", h.DeleteEvaluator)
		// Writes — guards
		r.Post("/monitors", h.CreateMonitor)
		r.Delete("/monitors/{monitorID}", h.DeleteMonitor)
		r.Post("/guards", h.CreateMonitor)
		r.Delete("/guards/{monitorID}", h.DeleteMonitor)
		// Writes — trace metadata (tags + annotations); NEVER the trace/session body
		r.Post("/traces/{traceID}/tags", h.AddTraceTag)
		r.Delete("/traces/{traceID}/tags", h.DeleteTraceTag)
		r.Post("/traces/{traceID}/annotations", h.AddTraceAnnotation)
		r.Delete("/traces/{traceID}/annotations", h.DeleteTraceAnnotation)
		// Writes — labeling queues (M63): enqueue a span, resolve an item, export resolved as a golden dataset
		r.Post("/traces/{traceID}/enqueue-for-labeling", h.EnqueueSpanForLabeling)
		r.Post("/labeling-queue/{itemID}/resolve", h.ResolveLabelingItem)
		r.Post("/labeling-queue/export-as-dataset", h.ExportLabelingQueueAsDataset)
		// Writes — experiments (M64): run a dataset × a variant through the provider path
		r.Post("/experiment-runs", h.CreateExperimentRun)
	})
}
