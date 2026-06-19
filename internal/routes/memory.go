// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/themory"
)

// Plan 1 of dashboard-memory-section-roadmap.md (T1.3-T1.5).
// Three memory routes (List / Metrics / Forget) all delegate to a
// TheMemoryClient. The proxy contract — derive subject from auth,
// inject X-Theo-User-Id, never trust the wire — is enforced here.
//
// ADRs honored:
//   D1 — TheMemory is HTTP-only; client is the only path
//   D2 — scope mapping per route is set at registration in cloud/cmd/main.go
//        (this file does NOT carry RequireScope — that's main's job per D8)
//   D3 — empty pgvector → 0 not NaN; empty memories → [] not null
//   D4 — OTel propagation handled by the *http.Client passed to NewClient

// TheMemoryClient is the interface this handler depends on. The concrete
// type lives in cloud/internal/themory; the interface here lets tests
// inject a fake without touching the HTTP layer.
type TheMemoryClient interface {
	List(ctx context.Context, userID string, opts themory.ListOptions) (*themory.ListResult, error)
	Metrics(ctx context.Context, userID string) (*themory.MetricsResult, error)
	Forget(ctx context.Context, userID, memoryID string, hard bool) error
	Entities(ctx context.Context, userID, scope string) (*themory.EntitiesResult, error)
	Remember(ctx context.Context, userID, text string, opts themory.RememberOptions) (*themory.RememberResult, error)
	Recall(ctx context.Context, userID, query string, opts themory.RecallOptions) (*themory.RecallResult, error)
	Reflect(ctx context.Context, userID string, opts themory.ReflectOptions) (*themory.ReflectResult, error)
	// ListSkills returns the read-only skill listing for a repo
	// (dashboard-phase2b-skills-browse T3.1). repoID is the ALREADY-namespaced
	// `{subject}:{repoId}` value (the handler composes it; D3 isolation).
	ListSkills(ctx context.Context, repoID string) (*themory.SkillsResult, error)
}

// validEntityScopes is the whitelist for the `scope` query param on
// GET /v1/memory/entities (Plan 2 T2.3). Anything outside this set is
// rejected with 400 BEFORE the client call (defense against injection +
// future drift between TheMemory's schema and the dashboard's tabs).
var validEntityScopes = map[string]bool{
	"user":    true,
	"session": true,
	"agent":   true,
	"repo":    true,
}

// WebhookEventPublisher is the interface MemoryHandler uses to fan out
// memory events as webhook delivery rows. Implementation lives in
// cloud/internal/routes/memory_webhook_deliveries.go. Optional — when nil,
// memory mutations don't trigger webhook deliveries.
type WebhookEventPublisher interface {
	Publish(ctx context.Context, subject, tenantID, eventType string, payload map[string]any)
}

// MemoryHandler is the receiver for /v1/memory/* routes.
type MemoryHandler struct {
	client         TheMemoryClient
	logger         *slog.Logger
	eventPublisher WebhookEventPublisher
}

// NewMemoryHandler creates the handler.
func NewMemoryHandler(client TheMemoryClient, logger *slog.Logger) *MemoryHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &MemoryHandler{client: client, logger: logger}
}

// WithEventPublisher returns a MemoryHandler that emits webhook delivery
// rows on memory mutations. Builder pattern keeps backward compatibility
// with main.go that doesn't always have a publisher (e.g., when webhooks
// table doesn't exist in a test bench).
func (h *MemoryHandler) WithEventPublisher(p WebhookEventPublisher) *MemoryHandler {
	h.eventPublisher = p
	return h
}

// memoryIDPattern accepts memory IDs the OSS TheMemory may emit. Liberal
// enough to accept UUIDs and prefixed ids (e.g., `mem-aaaa1111bbbb2222`),
// strict enough to reject path traversal probes + SQL meta-chars +
// over-long inputs.
//
// Why not lock to one shape: TheMemory's id format is owned by OSS and may
// evolve; over-tight validation here would block a future migration. The
// security invariant we care about is "no traversal / no meta / bounded
// length" — anything matching `^[A-Za-z0-9_-]{1,128}$` cannot reach the
// path filesystem or SQL injection vectors.
var memoryIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// =============================================================================
// GET /v1/memory/list — T1.3
// =============================================================================

// List proxies the inbound request to TheMemory with the authenticated
// subject as X-Theo-User-Id. Pagination + category filter propagate via
// query params.
func (h *MemoryHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	// D1 invariant: the userID we send upstream comes from the
	// authenticated session ONLY. Query params named "subject" /
	// "tenant_id" / etc. are silently ignored (tests verify this).
	q := r.URL.Query()
	opts := themory.ListOptions{
		Category: q.Get("category"),
		Cursor:   q.Get("cursor"),
		From:     q.Get("from"),
		To:       q.Get("to"),
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			opts.Limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			opts.Offset = n
		}
	}

	result, err := h.client.List(r.Context(), user.Subject, opts)
	if err != nil {
		h.logger.Warn("memory list: upstream failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}
	// D3: ensure memories is an array even if upstream returns nil.
	if result.Memories == nil {
		result.Memories = []themory.MemoryRow{}
	}

	writeJSON(w, http.StatusOK, result)
}

// =============================================================================
// GET /v1/memory/metrics — T1.4
// =============================================================================

// Metrics returns the customer's memory KPIs. Empty pgvector returns
// zero-initialised numbers per D3 (NEVER NaN, NEVER null, NEVER missing).
func (h *MemoryHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	result, err := h.client.Metrics(r.Context(), user.Subject)
	if err != nil {
		h.logger.Warn("memory metrics: upstream failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}

	// D3 — emit every field explicitly. The struct zero-values cover the
	// empty case; if upstream returns partial JSON, the missing keys stay
	// 0 (NOT null).
	writeJSON(w, http.StatusOK, result)
}

// =============================================================================
// DELETE /v1/memory/forget/{memoryID} — T1.5
// =============================================================================

// Forget soft-deletes the given memory from TheMemory. Cross-tenant
// attempts surface as 404 (D5 inheritance from Plan 0 — TheMemory
// returns 404 because the (memoryID, X-Theo-User-Id) tuple doesn't match).
//
// Memory Webhook Delivery plan T5.6: on successful forget, emit a
// `memory.forgotten` delivery row for each ACTIVE webhook of the
// authenticated subject that includes `memory.forgotten` in its events
// array. The dispatcher worker (cloud/internal/memory_webhook_worker)
// picks up due rows asynchronously — this handler does NOT block on
// HTTP delivery.
func (h *MemoryHandler) Forget(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	memoryID := chi.URLParam(r, "memoryID")
	// Validate-before-client guard (EC-2 style absorption from Plan 0):
	// malformed IDs reject with 400 immediately; the client is never
	// called, so upstream slow-logs / audit logs stay clean.
	if !memoryIDPattern.MatchString(memoryID) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Memory id must match [A-Za-z0-9_-]{1,128}.")
		return
	}

	// ADR D4 — hard-delete (GDPR escape hatch) is opt-in via `?hard=true`.
	// Default is the audit-preserving soft delete.
	hard := r.URL.Query().Get("hard") == "true"

	err := h.client.Forget(r.Context(), user.Subject, memoryID, hard)
	if err == nil {
		// T5.6 — emit webhook delivery rows for the memory.forgotten event.
		// Best-effort: if the webhook fanout fails, the forget itself
		// still succeeded for the customer — we MUST NOT regress the
		// handler's response to mask the upstream success.
		if h.eventPublisher != nil {
			h.eventPublisher.Publish(r.Context(), user.Subject, user.TenantID, "memory.forgotten",
				map[string]any{"memory_id": memoryID, "hard": hard})
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if errors.Is(err, themory.ErrNotFound) {
		// D5 inheritance: 404 covers "doesn't exist" AND "belongs to
		// another tenant". Never 403 — that would leak existence.
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Memory not found.")
		return
	}
	h.logger.Warn("memory forget: upstream failed", "error", err, "subject", user.Subject, "memory_id", memoryID)
	writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
}

// =============================================================================
// GET /v1/memory/entities — T2.3 (Plan 2)
// =============================================================================

// Entities returns aggregated entities for the authenticated subject under
// the requested scope (user / session / agent / repo). Per Plan 2 D2:
// gated by RequireScope("memory:read") — same scope as List + Metrics.
// Empty result → `{"entities": []}` (D3 inheritance from Plan 1).
func (h *MemoryHandler) Entities(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	scope := r.URL.Query().Get("scope")
	if !validEntityScopes[scope] {
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE",
			`Scope must be one of: user, session, agent, repo.`)
		return
	}

	result, err := h.client.Entities(r.Context(), user.Subject, scope)
	if err != nil {
		h.logger.Warn("memory entities: upstream failed", "error", err, "subject", user.Subject, "scope", scope)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}
	// D3: always emit array, never null.
	if result.Entities == nil {
		result.Entities = []themory.Entity{}
	}
	writeJSON(w, http.StatusOK, result)
}

// =============================================================================
// GET /v1/memory/skills?repoId= — dashboard-phase2b-skills-browse T3.2
// =============================================================================

// ListSkills returns the read-only skill listing for a repo owned by the
// authenticated subject. Per plan D3, the upstream repoId is namespaced as
// `{subject}:{repoId}` so two customers using the same bare repoId never share a
// skill scope (multi-tenant isolation — the same class of guard the entities /
// metrics subject-scoping enforces). The bare repoId is REQUIRED and must NOT
// contain the `:` separator (anti-spoof). Gated by RequireScope("memory:read").
func (h *MemoryHandler) ListSkills(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	repoID := r.URL.Query().Get("repoId")
	if repoID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REPO_ID", "repoId query param is required.")
		return
	}
	if strings.Contains(repoID, ":") {
		writeError(w, http.StatusBadRequest, "INVALID_REPO_ID", "repoId must not contain ':'.")
		return
	}

	// D3 — namespace by the authenticated subject for cross-customer isolation.
	namespaced := user.Subject + ":" + repoID
	result, err := h.client.ListSkills(r.Context(), namespaced)
	if err != nil {
		h.logger.Warn("memory skills: upstream failed", "error", err, "subject", user.Subject, "repoId", repoID)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}
	if result.Skills == nil {
		result.Skills = []themory.Skill{}
	}
	writeJSON(w, http.StatusOK, result)
}

// memoryMaxBodyBytes caps inbound write bodies (remember/recall/reflect) to
// guard against oversized payloads (mirrors the provider's 1 MB body-limit).
const memoryMaxBodyBytes = 1 << 20 // 1 MiB

// =============================================================================
// POST /v1/memory/remember — T1.2 (remember/recall/reflect verbs)
// =============================================================================

type rememberRequest struct {
	Text         string            `json:"text"`
	Category     string            `json:"category,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	AttributedTo string            `json:"attributedTo,omitempty"`
}

// Remember proxies a write to TheMemory under the authenticated subject's user
// scope. The subject is derived from auth ONLY (never from the body).
func (h *MemoryHandler) Remember(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, memoryMaxBodyBytes)
	var req rememberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "Request body must be valid JSON.")
		return
	}
	if req.Text == "" {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "Field 'text' is required.")
		return
	}

	opts := themory.RememberOptions{Category: req.Category, Metadata: req.Metadata, AttributedTo: req.AttributedTo}
	// v1.1 attribution-write contract: TheMemory applies the caller's
	// attributedTo ONLY on the verbatim path (infer:false). On the default
	// extraction path it uses the LLM's per-fact attribution. So when the
	// caller supplies a peer, request verbatim so the attribution persists
	// (owner decision 2026-06-19: infer:false when a peer is given).
	if req.AttributedTo != "" {
		verbatim := false
		opts.Infer = &verbatim
	}
	result, err := h.client.Remember(r.Context(), user.Subject, req.Text, opts)
	if err != nil {
		h.logger.Warn("memory remember: upstream failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}
	if result.Items == nil {
		result.Items = []themory.MemoryRow{}
	}
	// best-effort webhook fanout for memory.created
	if h.eventPublisher != nil {
		h.eventPublisher.Publish(r.Context(), user.Subject, user.TenantID, "memory.created",
			map[string]any{"count": len(result.Items)})
	}
	writeJSON(w, http.StatusCreated, result)
}

// =============================================================================
// POST /v1/memory/recall — T1.2
// =============================================================================

type recallRequest struct {
	Query     string  `json:"query"`
	TopK      int     `json:"topK,omitempty"`
	Threshold float64 `json:"threshold,omitempty"`
	AsOf      string  `json:"asOf,omitempty"`
}

// Recall proxies a semantic search to TheMemory under the subject's user scope.
func (h *MemoryHandler) Recall(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, memoryMaxBodyBytes)
	var req recallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "Request body must be valid JSON.")
		return
	}
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "Field 'query' is required.")
		return
	}
	// F-test-2: bound the search params before they reach the vector store.
	// An unvalidated topK lets a client drive an unbounded pgvector scan.
	if req.TopK < 0 || req.TopK > 200 {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "Field 'topK' must be between 0 and 200.")
		return
	}
	if req.Threshold < 0 || req.Threshold > 1 {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "Field 'threshold' must be between 0 and 1.")
		return
	}
	// ADR D2: validate asOf is RFC3339 at the boundary, so a bad datetime is a
	// clear 400 rather than a 502 laundered from the provider's 422.
	if req.AsOf != "" {
		if _, perr := time.Parse(time.RFC3339, req.AsOf); perr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Field 'asOf' must be an RFC3339 datetime.")
			return
		}
	}

	result, err := h.client.Recall(r.Context(), user.Subject, req.Query,
		themory.RecallOptions{TopK: req.TopK, Threshold: req.Threshold, AsOf: req.AsOf})
	if err != nil {
		h.logger.Warn("memory recall: upstream failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}
	if result.Results == nil {
		result.Results = []themory.RecallHit{}
	}
	writeJSON(w, http.StatusOK, result)
}

// =============================================================================
// POST /v1/memory/reflect — T1.2
// =============================================================================

type reflectRequest struct {
	MaxIterations int `json:"maxIterations,omitempty"`
}

// Reflect triggers consolidation in TheMemory under the subject's user scope.
// The provider's result object is passed through verbatim.
func (h *MemoryHandler) Reflect(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, memoryMaxBodyBytes)
	var req reflectRequest
	// Empty body is allowed (maxIterations is optional). Decode best-effort.
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Request body must be valid JSON.")
			return
		}
	}

	result, err := h.client.Reflect(r.Context(), user.Subject, themory.ReflectOptions{MaxIterations: req.MaxIterations})
	if err != nil {
		h.logger.Warn("memory reflect: upstream failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusBadGateway, "MEMORY_UPSTREAM_UNAVAILABLE", "Memory service is temporarily unavailable. Try again.")
		return
	}
	// Pass the provider's result object through verbatim (202 Accepted).
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	if len(result.Raw) > 0 {
		_, _ = w.Write(result.Raw)
	} else {
		_, _ = w.Write([]byte("{}"))
	}
}
