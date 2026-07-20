// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M41 — DataClient is a per-tenant proxy to theo-lens's REST API for the theo-cloud
// dashboard BFF (read half). Mirrors internal/rag/data_client.go's Model B shape: it
// holds NO standing credential — a keyResolver resolves the PER-TENANT Bearer per
// request from context (the lens broker mints a observability:read key from the JWT-derived
// tenant). A resolver error FAILS CLOSED (no request, no master fallback).
//
// M41 ships the READS only (traces / sessions / observability / cost); the write
// surface is M44. The reads pass the upstream body through as json.RawMessage — a thin
// proxy that never re-models theo-lens's response shape (so it cannot drift; the
// frontend renders theo-lens's shape directly). The load-bearing correctness is the
// upstream PATH mapping (observability lives under /v1/metrics, cost under /v1/analytics)
// — pinned by the real-schema contract test (data_client_test.go).
package thelens

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// DataClient is the per-tenant read proxy to theo-lens for the dashboard BFF.
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constructs a lens DataClient. baseURL is theo-lens's REST root
// (e.g. http://host.docker.internal:18084). httpClient may be nil (http.DefaultClient).
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver wires the per-tenant Bearer resolver (Model B). The dashboard wires a
// resolver that mints a per-tenant observability:read key; without it the client cannot authenticate.
func (c *DataClient) WithKeyResolver(r func(ctx context.Context) (string, error)) *DataClient {
	c.keyResolver = r
	return c
}

// TraceListFilter is the whitelisted set of trace-list filters the BFF forwards to theo-lens's
// existing GET /v1/traces filter SQL (M49). theo-lens already implements status/model/from/to/q
// (full-text) — the BFF only forwards them; it never re-implements the filtering. Only these fields
// are ever forwarded (a request's unknown query params are dropped at the handler boundary).
type TraceListFilter struct {
	Limit, Offset int
	Status        string // "ok" | "error" (theo-lens validates the value)
	Model         string
	From, To      string // ISO-8601 datetime bounds
	Q             string // full-text search
	// M52: advanced filters (pass-through strings; theo-lens coerces + validates).
	MinCostUsd string
	MaxCostUsd string
	MinTokens  string
	MaxTokens  string
	SessionID  string
	SpanQuery  string // M92: the span-query DSL (e.g. `attr:key=value kind:llm`) — theo-lens parses + validates.
}

// ListTraces proxies GET /v1/traces with the per-tenant Bearer, forwarding the whitelisted filters.
func (c *DataClient) ListTraces(ctx context.Context, f TraceListFilter) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/traces", filterQuery(f))
}

// filterQuery builds the /v1/traces query: pagination + only the non-empty whitelisted filters.
func filterQuery(f TraceListFilter) url.Values {
	q := pageQuery(f.Limit, f.Offset)
	if f.Status != "" {
		q.Set("status", f.Status)
	}
	if f.Model != "" {
		q.Set("model", f.Model)
	}
	if f.From != "" {
		q.Set("from", f.From)
	}
	if f.To != "" {
		q.Set("to", f.To)
	}
	if f.Q != "" {
		q.Set("q", f.Q)
	}
	// M52: advanced filters → theo-lens snake_case params (only when set).
	if f.MinCostUsd != "" {
		q.Set("min_cost_usd", f.MinCostUsd)
	}
	if f.MaxCostUsd != "" {
		q.Set("max_cost_usd", f.MaxCostUsd)
	}
	if f.MinTokens != "" {
		q.Set("min_tokens", f.MinTokens)
	}
	if f.MaxTokens != "" {
		q.Set("max_tokens", f.MaxTokens)
	}
	if f.SessionID != "" {
		q.Set("session_id", f.SessionID)
	}
	if f.SpanQuery != "" {
		q.Set("span_query", f.SpanQuery)
	}
	return q
}

// SpanAttributes proxies GET /v1/metrics/span-attributes (M92 facet discovery). Forwards the
// selectable `key` (values-mode) when non-empty; an empty key returns the top attribute keys.
func (c *DataClient) SpanAttributes(ctx context.Context, key string) (json.RawMessage, error) {
	var q url.Values
	if key != "" {
		q = url.Values{}
		q.Set("key", key)
	}
	return c.getRaw(ctx, "/v1/metrics/span-attributes", q)
}

// ListSessions proxies GET /v1/sessions?limit&offset with the per-tenant Bearer.
func (c *DataClient) ListSessions(ctx context.Context, limit, offset int) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/sessions", pageQuery(limit, offset))
}

// Observability proxies GET /v1/metrics/observability (theo-lens's observability time-series
// lives under /v1/metrics, NOT /v1/observability — the schema-lesson). Forwards the selectable
// `range` (M51) when non-empty; an empty range lets theo-lens apply its 24h default.
func (c *DataClient) Observability(ctx context.Context, timeRange string) (json.RawMessage, error) {
	var q url.Values
	if timeRange != "" {
		q = url.Values{}
		q.Set("range", timeRange)
	}
	return c.getRaw(ctx, "/v1/metrics/observability", q)
}

// Scores proxies GET /v1/metrics/scores (theo-lens's per-evaluator score aggregation over
// time — M90). Forwards the selectable `range` when non-empty; an empty range lets theo-lens
// apply its 24h default.
func (c *DataClient) Scores(ctx context.Context, timeRange string) (json.RawMessage, error) {
	var q url.Values
	if timeRange != "" {
		q = url.Values{}
		q.Set("range", timeRange)
	}
	return c.getRaw(ctx, "/v1/metrics/scores", q)
}

// Cost proxies GET /v1/analytics/cost?since (theo-lens's cost summary lives under
// /v1/analytics, NOT /v1/cost — the schema-lesson).
func (c *DataClient) Cost(ctx context.Context, since string) (json.RawMessage, error) {
	q := url.Values{}
	if since != "" {
		q.Set("since", since)
	}
	return c.getRaw(ctx, "/v1/analytics/cost", q)
}

// pageQuery builds the limit/offset query shared by the list reads.
func pageQuery(limit, offset int) url.Values {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		q.Set("offset", strconv.Itoa(offset))
	}
	return q
}

// --- M44 write + new-read surface (read+write+delete dashboard) ---------------------------
//
// The write half mirrors internal/rag/data_client.go: a doRaw dispatch that resolves the
// per-tenant Bearer (fail-closed), forwards the browser's body verbatim (json.RawMessage —
// the BFF is a thin proxy and never re-models theo-lens's request/response shape, so it cannot
// drift), and passes the upstream body through. theo-lens enforces the per-verb lens:* scope on
// the minted key; the dashboard session key carries read+write+delete but each route only passes
// the verb it needs. Reads reuse getRaw; writes/deletes use doRaw.

// ListDatasets proxies GET /v1/datasets.
func (c *DataClient) ListDatasets(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/datasets", nil)
}

// GetDataset proxies GET /v1/datasets/{id} (dataset detail with items).
func (c *DataClient) GetDataset(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/datasets/"+url.PathEscape(id), nil)
}

// CreateDataset proxies POST /v1/datasets ({name}) — the browser body forwarded verbatim.
func (c *DataClient) CreateDataset(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/datasets", nil, body)
}

// RenameDataset proxies PUT /v1/datasets/{id} ({name}) — the browser body forwarded verbatim (M82).
func (c *DataClient) RenameDataset(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPut, "/v1/datasets/"+url.PathEscape(id), nil, body)
}

// DeleteDataset proxies DELETE /v1/datasets/{id} (204, cascades runs+items in theo-lens) (M82).
func (c *DataClient) DeleteDataset(ctx context.Context, id string) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodDelete, "/v1/datasets/"+url.PathEscape(id), nil, nil)
}

// AddDatasetItem proxies POST /v1/datasets/{id}/items ({traceId}).
func (c *DataClient) AddDatasetItem(ctx context.Context, datasetID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/datasets/"+url.PathEscape(datasetID)+"/items", nil, body)
}

// DeleteDatasetItem proxies DELETE /v1/datasets/{id}/items/{traceId}.
func (c *DataClient) DeleteDatasetItem(ctx context.Context, datasetID, traceID string) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodDelete, "/v1/datasets/"+url.PathEscape(datasetID)+"/items/"+url.PathEscape(traceID), nil, nil)
}

// ListEvaluators proxies GET /v1/evaluators.
func (c *DataClient) ListEvaluators(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/evaluators", nil)
}

// CreateEvaluator proxies POST /v1/evaluators ({name,kind,config,...}).
func (c *DataClient) CreateEvaluator(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/evaluators", nil, body)
}

// UpdateEvaluator proxies PUT /v1/evaluators/{id} (partial {name?,...}) — body forwarded verbatim (M82).
func (c *DataClient) UpdateEvaluator(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPut, "/v1/evaluators/"+url.PathEscape(id), nil, body)
}

// RunEvaluator proxies POST /v1/evaluators/{id}/run ({traceIds?,limit?}).
func (c *DataClient) RunEvaluator(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/evaluators/"+url.PathEscape(id)+"/run", nil, body)
}

// DeleteEvaluator proxies DELETE /v1/evaluators/{id} (204).
func (c *DataClient) DeleteEvaluator(ctx context.Context, id string) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodDelete, "/v1/evaluators/"+url.PathEscape(id), nil, nil)
}

// ListGuards proxies GET /v1/guards.
func (c *DataClient) ListGuards(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/guards", nil)
}

// GuardBreaches proxies GET /v1/guards/{id}/breaches ({traceIds}).
func (c *DataClient) GuardBreaches(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/guards/"+url.PathEscape(id)+"/breaches", nil)
}

// CreateGuard proxies POST /v1/guards ({evaluatorId,operator,...}).
func (c *DataClient) CreateGuard(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/guards", nil, body)
}

// DeleteGuard proxies DELETE /v1/guards/{id} (204).
func (c *DataClient) DeleteGuard(ctx context.Context, id string) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodDelete, "/v1/guards/"+url.PathEscape(id), nil, nil)
}

// ListAgents proxies GET /v1/agents (read-only derived catalog).
func (c *DataClient) ListAgents(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/agents", nil)
}

// GetTrace proxies GET /v1/traces/{id} (reconstructed trace tree for the waterfall drilldown).
func (c *DataClient) GetTrace(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/traces/"+url.PathEscape(id), nil)
}

// GetTraceCost proxies GET /v1/traces/{id}/cost (per-trace cost summary, M5) — feeds the M54 compare
// view's delta table. Same per-tenant path as GetTrace; no client-side cost math (D2 — Rule 9).
func (c *DataClient) GetTraceCost(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/traces/"+url.PathEscape(id)+"/cost", nil)
}

// GetSessionCoherence proxies GET /v1/sessions/{id}/coherence (M131 — the cached Session Coherence
// verdict; null when never judged). Same per-tenant Model-B path as the trace reads.
func (c *DataClient) GetSessionCoherence(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/sessions/"+url.PathEscape(id)+"/coherence", nil)
}

// RunSessionCoherence proxies POST /v1/sessions/{id}/coherence (M131 — run the billable coherence
// judge; rate-limited + write scope upstream). No request body.
func (c *DataClient) RunSessionCoherence(ctx context.Context, id string) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(id)+"/coherence", nil, nil)
}

// GetTraceTags proxies GET /v1/traces/{id}/tags ({tags}) — the current tag list for the trace.
func (c *DataClient) GetTraceTags(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/traces/"+url.PathEscape(id)+"/tags", nil)
}

// GetTraceAnnotations proxies GET /v1/traces/{id}/annotations ({annotations}).
func (c *DataClient) GetTraceAnnotations(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/traces/"+url.PathEscape(id)+"/annotations", nil)
}

// Ask proxies POST /v1/traces/{id}/ask — the M33 "Ask about this step" copilot (read-scope,
// grounded on the trace). The browser body ({question}) is forwarded verbatim.
func (c *DataClient) Ask(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/traces/"+url.PathEscape(traceID)+"/ask", nil, body)
}

// AskFeedback proxies POST /v1/traces/{id}/ask/feedback — the M83 thumbs up/down on an answer
// (write-scope; independent of the LLM). The browser body ({turnId,label,...}) is forwarded verbatim.
func (c *DataClient) AskFeedback(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/traces/"+url.PathEscape(traceID)+"/ask/feedback", nil, body)
}

// DeleteAskFeedback proxies DELETE /v1/traces/{id}/ask/feedback?turnId= — the M83 vote retract (clear),
// so the persisted store never diverges from the shown thumb. Write-scope; idempotent (204).
func (c *DataClient) DeleteAskFeedback(ctx context.Context, traceID, turnID string) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("turnId", turnID)
	return c.doRaw(ctx, http.MethodDelete, "/v1/traces/"+url.PathEscape(traceID)+"/ask/feedback", q, nil)
}

// Replay proxies POST /v1/traces/{id}/replay (M55 span replay — edited messages re-run against the
// real provider). Same per-tenant path as Ask; the browser never holds a provider key.
func (c *DataClient) Replay(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/traces/"+url.PathEscape(traceID)+"/replay", nil, body)
}

// AddTraceTag proxies POST /v1/traces/{id}/tags ({tag}).
func (c *DataClient) AddTraceTag(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/traces/"+url.PathEscape(traceID)+"/tags", nil, body)
}

// DeleteTraceTag proxies DELETE /v1/traces/{id}/tags?tag= (theo-lens takes the tag as a query param).
func (c *DataClient) DeleteTraceTag(ctx context.Context, traceID, tag string) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("tag", tag)
	return c.doRaw(ctx, http.MethodDelete, "/v1/traces/"+url.PathEscape(traceID)+"/tags", q, nil)
}

// AddTraceAnnotation proxies POST /v1/traces/{id}/annotations ({spanId?,label?,note?,...}).
func (c *DataClient) AddTraceAnnotation(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/traces/"+url.PathEscape(traceID)+"/annotations", nil, body)
}

// DeleteTraceAnnotation proxies DELETE /v1/traces/{id}/annotations?name=&spanId=&annotatorKind=.
func (c *DataClient) DeleteTraceAnnotation(ctx context.Context, traceID string, q url.Values) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodDelete, "/v1/traces/"+url.PathEscape(traceID)+"/annotations", q, nil)
}

// M63 — labeling queues. Reads via getRaw, writes via doRaw; the per-tenant key is resolved per call.
func (c *DataClient) ListLabelingQueue(ctx context.Context, q url.Values) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/labeling-queue", q)
}
func (c *DataClient) GetLabelingQueueItem(ctx context.Context, itemID string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/labeling-queue/"+url.PathEscape(itemID), nil)
}
func (c *DataClient) EnqueueSpanForLabeling(ctx context.Context, traceID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/traces/"+url.PathEscape(traceID)+"/enqueue-for-labeling", nil, body)
}
func (c *DataClient) ResolveLabelingItem(ctx context.Context, itemID string, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/labeling-queue/"+url.PathEscape(itemID)+"/resolve", nil, body)
}
func (c *DataClient) ExportLabelingQueueAsDataset(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/labeling-queue/export-as-dataset", nil, body)
}

// M64 — experiments. Reads via getRaw, the create-run write via doRaw; per-tenant key resolved per call.
func (c *DataClient) CreateExperimentRun(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.doRaw(ctx, http.MethodPost, "/v1/experiment-runs", nil, body)
}
func (c *DataClient) ListExperimentRuns(ctx context.Context, q url.Values) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/experiment-runs", q)
}
func (c *DataClient) GetExperimentRun(ctx context.Context, runID string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/experiment-runs/"+url.PathEscape(runID), nil)
}
func (c *DataClient) CompareExperimentRuns(ctx context.Context, q url.Values) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/experiment-runs/compare", q)
}

// UpstreamStatusError carries a non-2xx theo-lens response so the BFF proxy can forward the REAL
// status + body to the browser instead of flattening every failure to 502 (M82). A proxy that
// swallows the upstream 4xx (e.g. a rename's 409 name-conflict, an invalid-predicate 400) hides
// actionable information from the caller — the BFF is a thin proxy, so upstream client-errors are
// the caller's to see. Transport/resolver errors are NOT this type → they still surface as 502.
type UpstreamStatusError struct {
	Status int
	Body   []byte
}

func (e *UpstreamStatusError) Error() string {
	return fmt.Sprintf("thelens upstream %d: %s", e.Status, string(e.Body))
}

// doRaw resolves the per-tenant Bearer (fail-closed), sends method+path with an optional JSON
// body, and returns the 2xx body verbatim (empty for 204). A resolver error means NO request is
// sent (no master fallback); the bearer is NEVER included in a returned error.
func (c *DataClient) doRaw(ctx context.Context, method, path string, q url.Values, body json.RawMessage) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("thelens data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: resolve per-tenant key: %w", err)
	}
	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	var reqBody io.Reader
	if len(body) > 0 {
		reqBody = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: %s %s: %w", method, path, err) // never leak the bearer
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, &UpstreamStatusError{Status: resp.StatusCode, Body: raw}
	}
	if resp.StatusCode == http.StatusNoContent {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return json.RawMessage(`{}`), nil
	}
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("thelens data client: read %s: %w", path, err)
	}
	return json.RawMessage(out), nil
}

// getRaw resolves the per-tenant Bearer (fail-closed) and GETs path, returning the 2xx
// body verbatim. A resolver error means NO request is sent (no master fallback). The
// bearer is NEVER included in a returned error.
func (c *DataClient) getRaw(ctx context.Context, path string, q url.Values) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("thelens data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: resolve per-tenant key: %w", err)
	}
	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: GET %s: %w", path, err) // never leak the bearer
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, &UpstreamStatusError{Status: resp.StatusCode, Body: raw}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("thelens data client: read %s: %w", path, err)
	}
	return json.RawMessage(body), nil
}
