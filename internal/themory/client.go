// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package themory is the thin HTTP client TheoCloud (the gateway) uses to reach
// OSS TheMemory. The contract is HTTP + headers, NOT a fat SDK.
//
// CONFORMANCE NOTE (2026-06-18 — conform-to-provider):
// This client conforms to TheMemory's OWN published, code-generated OpenAPI
// spec (served at `GET /v1/openapi.json`). Earlier this client targeted a
// hand-authored consumer-expectation spec (`openapi/themory.yaml`) that
// diverged from the real server (`/memories`, `/metrics`, `/entities`,
// `DELETE /memories/{id}`, `X-Theo-User-Id` scoping — none of which exist on
// the real provider). The provider is the contract owner; the gateway conforms.
//
// Load-bearing invariants:
//
//  1. Model B: every DATA request carries a PER-TENANT `Authorization: Bearer
//     <theo_live_*>` resolved per-request from the authenticated tenant by the
//     credential broker (see broker.go + WithKeyResolver). The data client holds
//     NO master/platform key, so a path bug cannot cross tenants and a resolver
//     failure FAILS CLOSED (no master fallback). The control-plane platform
//     credential lives only on AdminClient (mint/rotate/revoke). The per-tenant
//     secret NEVER leaves the Go process — never logged, traced, or returned.
//
//  2. Tenant isolation is enforced by the PROVIDER from the credential
//     (workspace bound to the per-tenant key), PLUS scope-in-path within the
//     workspace. TheMemory scopes a listing by `/v1/scopes/user/{subject}/...`;
//     the gateway puts the authenticated subject there. (The real server IGNORES
//     `X-Theo-User-Id`, so relying on it — as the old client did — silently
//     broke isolation.)
//
//  3. `forget` is ownership-checked BY THE PROVIDER. TheMemory's
//     `DELETE /v1/scopes/user/{subject}/memories/{id}` (v0.12.0) deletes the id
//     ONLY if it belongs to the subject's scope (cross-scope/cross-workspace →
//     404, no existence leak), so the gateway delegates directly — no O(scope)
//     listAll() pre-check. (Earlier this was synthesized gateway-side against the
//     workspace-only `POST /v1/forget`, which alone could not prevent the IDOR.)
//
//  4. The provided *http.Client passes through verbatim. Production wires
//     otelhttp.NewTransport so traceparent headers propagate.
package themory

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// Client talks to TheMemory's REST API. Construct via NewClient.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	// keyResolver (Model B slice 2, ADR D1) resolves the PER-TENANT data-plane
	// Bearer from the request context (the broker reads the tenant and returns
	// its theo_live_* key). When set, it REPLACES apiKey on every call — the
	// production data client is constructed with an EMPTY apiKey + a resolver, so
	// it structurally cannot wield the master/platform credential. When nil
	// (tests / legacy single-tenant), apiKey is used. A resolver error fails the
	// request CLOSED (no master fallback).
	keyResolver func(ctx context.Context) (string, error)
}

// WithKeyResolver returns the Client wired to resolve a per-tenant Bearer per
// request (Model B). The data path uses the resolved key instead of apiKey.
func (c *Client) WithKeyResolver(r func(ctx context.Context) (string, error)) *Client {
	c.keyResolver = r
	return c
}

// NewClient constructs a TheMemory client. baseURL is the root of the
// TheMemory service (e.g., http://themory:8080). apiKey is the master
// THEMORY_API_KEY — held by the gateway, NEVER returned to the customer.
// httpClient may be nil — when nil, http.DefaultClient is used.
func NewClient(baseURL, apiKey string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		httpClient: httpClient,
	}
}

// ListOptions are the supported filters for a scope listing.
//
// TheMemory's `GET /v1/scopes/{type}/{id}/memories` supports `limit`,
// `category`, an opaque `cursor`, and (since ADR D3) `from`/`to` RFC3339
// date-range filters. `Offset` is NOT supported by the provider (cursor-only
// pagination) and is retained for API stability without being sent.
type ListOptions struct {
	Limit    int
	Category string // optional filter; empty means no filter
	Cursor   string // opaque pagination cursor (provider-issued)
	From     string // RFC3339 lower bound on created_at (inclusive); empty = unset
	To       string // RFC3339 upper bound on created_at (inclusive); empty = unset

	// SQL-level page offset — supported by the provider since 2026-07-22
	// (real OFFSET pagination on the scope listing); sent when > 0.
	Offset int

	// SessionID switches the listing to the SESSION tier (session-separation,
	// 2026-07-23): `/v1/scopes/session/{id}/memories` — the M8 working memory
	// `(workspace, user, session)`, which reads SESSION ∪ GLOBAL. Empty = the
	// user (global) tier, unchanged.
	SessionID string

	// Entity filters the listing to the memories LINKED to one entity
	// (theo-cloud#252 — provider `?entity=` via the memory_entities join).
	// Surface name as returned by the entities listing. Empty = no filter.
	Entity string
}

// MemoryRow is one entry in the List response, shaped for the dashboard.
type MemoryRow struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	Category  string `json:"category,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
	// SessionID marks a SESSION-tier row (session-separation, 2026-07-23) —
	// projected from the provider's metadata.session_id so the dashboard can
	// badge working-memory rows vs global rows. Empty = global tier.
	SessionID string `json:"session_id,omitempty"`
}

// SessionRow is one session sub-scope in the ListSessions response
// (session-separation, 2026-07-23 — the M8 session picker data source).
type SessionRow struct {
	SessionID      string `json:"session_id"`
	MemoryCount    int    `json:"memory_count"`
	LastActivityAt string `json:"last_activity_at,omitempty"`
}

// SessionsResult is the gateway's GET /v1/dashboard/memory/sessions response.
type SessionsResult struct {
	Sessions []SessionRow `json:"sessions"`
}

// ListResult is the gateway's GET /v1/memory/list response shape.
type ListResult struct {
	Memories []MemoryRow `json:"memories"`
	// NextCursor is the provider's opaque pagination token; nil when there is
	// no further page. (Replaces the never-functional NextOffset.)
	NextCursor *string `json:"next_cursor,omitempty"`
	Total      *int    `json:"total,omitempty"`
	// Entity echoes the provider-applied ?entity= filter (fail-closed contract,
	// incident 2026-07-23) — absent when the provider ignored the param.
	Entity *string `json:"entity,omitempty"`
}

// MetricsResult is the GET /metrics response shape, mapped from the provider's
// real subject-scoped `GET /v1/scopes/user/{subject}/metrics` (ADR D2 amendment).
// All four fields are real: `TotalMemories`, `EntityCount` (distinct
// attributed_to), `AddEvents`, and (as of TheMemory v0.12.0) `RetrievalAPIUsage`
// — the provider now persists a per-scope recall counter, so this is no longer 0.
type MetricsResult struct {
	TotalMemories     int `json:"total_memories"`
	RetrievalAPIUsage int `json:"retrieval_api_usage"`
	AddEvents         int `json:"add_events"`
	EntityCount       int `json:"entity_count"`
}

// RememberOptions are the optional fields for a remember (write) call.
type RememberOptions struct {
	Category     string            // optional category tag
	Metadata     map[string]string // optional metadata
	AttributedTo string            // optional multi-peer attribution (v1.1); empty = omitted
	// Infer controls TheMemory's extraction mode. nil = provider default (true,
	// LLM extraction). Set to &false for the verbatim path — REQUIRED for the
	// caller's AttributedTo to persist (v1.1 applies options.attributedTo only on
	// infer:false; on infer:true attribution comes from the LLM per-fact).
	Infer *bool
}

// RememberResult is the gateway's POST /v1/memory/remember response shape.
// Mirrors the provider's `{ items: MemoryItem[] }` (201), projected to the
// dashboard MemoryRow shape.
type RememberResult struct {
	Items []MemoryRow `json:"items"`
}

// GraphExpand is the optional entity-graph expansion for a recall (theo-memory
// v0.20.0). Forwarded to TheMemory's POST /v1/recall `graphExpand` field, which
// pool-expands results with memories connected by a shared entity (1 hop) or a
// relation edge (2nd hop). Both fields are optional (0 = omitted via omitempty,
// so TheMemory applies its default) — mirrors the provider's `z.union([1,2]).optional()`.
// MUST stay `int` + `omitempty` (NOT *int): 0 is the OMIT signal here. TheMemory's
// zod is `hops: union([1,2]).optional()` + `limit: int.min(1).max(100).optional()`,
// so it 422s `limit:0`. omitempty drops a 0 from the wire → TheMemory applies its
// default. Converting either field to *int (to distinguish 0 from absent, as
// `recallRequest.Threshold` does) WITHOUT changing the 0=omit semantics would
// forward `limit:0` → provider 422 → laundered 502, defeating ADR D2. The
// contract test `Recall drops limit:0 (omitempty invariant)` fails RED if broken.
type GraphExpand struct {
	Hops  int `json:"hops,omitempty"`
	Limit int `json:"limit,omitempty"`
}

// RecallOptions are the optional fields for a recall (semantic search) call.
type RecallOptions struct {
	TopK        int
	Threshold   float64      // 0 means "unset" (omitted from the request)
	AsOf        string       // optional RFC3339 bi-temporal point-in-time (v1.1); empty = omitted
	GraphExpand *GraphExpand // optional entity-graph expansion (v0.20.0); nil = omitted
}

// RecallHit is one scored result from a recall call.
type RecallHit struct {
	ID        string  `json:"id"`
	Content   string  `json:"content"`
	Score     float64 `json:"score"`
	Category  string  `json:"category,omitempty"`
	CreatedAt string  `json:"created_at,omitempty"`
}

// RecallResult is the gateway's POST /v1/memory/recall response shape.
// Mirrors the provider's `{ results: MemoryItemWithScore[] }` (200).
type RecallResult struct {
	Results []RecallHit `json:"results"`
}

// ReflectOptions are the optional fields for a reflect (consolidation) call.
type ReflectOptions struct {
	MaxIterations int
}

// ReflectResult is the gateway's POST /v1/memory/reflect response shape.
// The provider returns the reflection result object directly (202); the
// gateway passes it through verbatim so the dashboard can render whatever
// the provider reports without coupling to its internal shape.
type ReflectResult struct {
	Raw json.RawMessage
}

// Entity is one row in the Entities response.
type Entity struct {
	ID          string `json:"id"`
	ScopeType   string `json:"scope_type"`
	MemoryCount int    `json:"memory_count"`
	LastSeenAt  string `json:"last_seen_at,omitempty"`
	// Summary (M2) — on-demand digest of the entity's currently-active outgoing
	// relations, passed through verbatim from the upstream memory REST.
	Summary string `json:"summary,omitempty"`
}

// EntitiesResult is the GET /entities response shape.
type EntitiesResult struct {
	Entities []Entity `json:"entities"`
}

// GraphNode is one node (entity) in the Graph response. Same shape as Entity.
type GraphNode struct {
	ID          string `json:"id"`
	ScopeType   string `json:"scope_type"`
	MemoryCount int    `json:"memory_count"`
	LastSeenAt  string `json:"last_seen_at,omitempty"`
}

// GraphEdge is one relation edge in the Graph response. source/target are node
// IDs (entity names); relation is the human label; memory_count = distinct
// memories that asserted the triple.
type GraphEdge struct {
	Source      string `json:"source"`
	Relation    string `json:"relation"`
	Target      string `json:"target"`
	MemoryCount int    `json:"memory_count"`
	// Active (M1) — false when the edge is superseded/invalidated. Passed through
	// verbatim so the audit view can dim retired edges. Pointer so the field is
	// omitted (not forced to false) when the upstream doesn't send it.
	Active *bool `json:"active,omitempty"`
}

// GraphResult is the GET /graph response shape (themory-graph-gateway-dashboard).
type GraphResult struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// EpisodeItem is one row of the episodic / message-log read surface
// (TheMemory v0.14.0 GET /v1/scopes/{type}/{id}/episodes). A temporal projection
// of a memory: id + text + the scope tier + created_at + flat metadata.
type EpisodeItem struct {
	ID        string         `json:"id"`
	Text      string         `json:"text"`
	ScopeType string         `json:"scope_type"`
	CreatedAt string         `json:"created_at"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

// EpisodesResult is the GET /episodes response shape: one cursor-paginated page.
// NextCursor is non-nil only when more rows follow in the active order.
type EpisodesResult struct {
	Items      []EpisodeItem `json:"items"`
	NextCursor *string       `json:"nextCursor,omitempty"`
}

// EpisodeOptions are the cursor/order/asOf/text-filter knobs forwarded to the
// provider's episodes endpoint. All optional; an empty value is omitted from the
// query (mirrors ListOptions). At most one of After/Before is honored upstream.
type EpisodeOptions struct {
	After  string
	Before string
	Limit  int
	Order  string // "asc" | "desc"
	AsOf   string // ISO-8601 instant for bi-temporal replay
	Query  string // literal partial-text filter (NOT semantic)
}

// Skill is one row of a repo's read-only skill listing
// (dashboard-phase2b-skills-browse). Mirrors the TheMemory
// GET /v1/scopes/skill/{repoId}/skills DTO.
type Skill struct {
	ID           string   `json:"id"`
	Hash         string   `json:"hash"`
	Description  string   `json:"description"`
	Code         *string  `json:"code"`
	CodeLanguage *string  `json:"codeLanguage"`
	CreatedAt    string   `json:"createdAt"`
	DerivedFrom  []string `json:"derivedFrom"`
	SupersededBy *string  `json:"supersededBy"`
}

// SkillsResult is the gateway's skills-listing response. `Truncated` echoes the
// provider's honest topK-cap disclosure (EC-4).
type SkillsResult struct {
	Skills    []Skill `json:"skills"`
	Truncated bool    `json:"truncated"`
}

// SkillWithRepo is one row of the cross-repo flat skills listing
// (skills-cross-repo-flat-list-gateway). Mirrors the TheMemory
// GET /v1/scopes/skill/{subject}/all DTO: a Skill plus the bare repo it belongs
// to (the provider strips the `{subject}:` namespace prefix from agent_id).
type SkillWithRepo struct {
	Skill
	RepoID string `json:"repoId"`
}

// SkillsAllResult is the gateway's cross-repo flat skills-listing response.
// `Total` is the full match count across every repo for the subject; `Truncated`
// is true when more rows exist beyond the returned page.
type SkillsAllResult struct {
	Skills    []SkillWithRepo `json:"skills"`
	Total     int             `json:"total"`
	Truncated bool            `json:"truncated"`
}

// SkillsAllOptions are the cross-repo flat-listing query params (offset
// pagination + optional case-insensitive description substring filter).
type SkillsAllOptions struct {
	Limit             int
	Offset            int
	Query             string // literal description substring filter
	IncludeSuperseded bool
}

// --- provider wire shapes (GET /v1/scopes/{type}/{id}/memories) --------------

type scopeMemoryItem struct {
	ID        string         `json:"id"`
	Text      string         `json:"text"`
	CreatedAt string         `json:"createdAt"`
	Metadata  map[string]any `json:"metadata"`
}

type scopeListResponse struct {
	Items      []scopeMemoryItem `json:"items"`
	NextCursor *string           `json:"nextCursor"`
	// Real scope total (provider fast path, 2026-07-22) — forwarded so the
	// dashboard pager can render "N–M of total".
	Total *int `json:"total"`
	// Entity is the provider's fail-closed ECHO of an applied ?entity= filter
	// (incident 2026-07-23): an old provider silently ignores the param and
	// returns no echo — cascade-delete clients MUST abort in that case.
	Entity *string `json:"entity"`
}

// userScopePath builds the provider listing path for a user subject.
func userScopePath(userID string) string {
	return "/v1/scopes/user/" + url.PathEscape(userID) + "/memories"
}

// sessionScopePath builds the provider listing path for a SESSION sub-scope
// (session-separation, 2026-07-23 — M8 working memory tier).
func sessionScopePath(sessionID string) string {
	return "/v1/scopes/session/" + url.PathEscape(sessionID) + "/memories"
}

func toRow(item scopeMemoryItem) MemoryRow {
	row := MemoryRow{ID: item.ID, Content: item.Text, CreatedAt: item.CreatedAt}
	if c, ok := item.Metadata["category"].(string); ok {
		row.Category = c
	}
	// Session-separation (2026-07-23): surface the tier so the dashboard can
	// badge working-memory rows; previously discarded (the SESSION ∪ GLOBAL
	// listing was indistinguishable).
	if s, ok := item.Metadata["session_id"].(string); ok {
		row.SessionID = s
	}
	return row
}

// List proxies one page of the user's scope listing through the real provider
// endpoint, scoping by subject-in-path (NOT a header).
func (c *Client) List(ctx context.Context, userID string, opts ListOptions) (*ListResult, error) {
	q := url.Values{}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Category != "" {
		q.Set("category", opts.Category)
	}
	if opts.Cursor != "" {
		q.Set("cursor", opts.Cursor)
	}
	// ADR D3 — date-range filter, server-side on the provider's scope list
	// (created_at BETWEEN). Sent only when supplied; an empty value is omitted.
	if opts.From != "" {
		q.Set("from", opts.From)
	}
	if opts.To != "" {
		q.Set("to", opts.To)
	}
	// Dashboard pager (2026-07-22): the provider now implements REAL SQL offset
	// pagination on the scope listing — forward it (previously "not supported"
	// and silently dropped, so every dashboard page repeated the first items).
	if opts.Offset > 0 {
		q.Set("offset", strconv.Itoa(opts.Offset))
	}
	// theo-cloud#252 — per-entity filter (provider-side memory_entities join).
	if opts.Entity != "" {
		q.Set("entity", opts.Entity)
	}

	// Session-separation (2026-07-23): a non-empty SessionID targets the SESSION
	// tier path; the provider binds the workspace (+ acting user when the key's
	// Principal carries one), so cross-tenant isolation is unchanged.
	path := userScopePath(userID)
	if opts.SessionID != "" {
		path = sessionScopePath(opts.SessionID)
	}

	var raw scopeListResponse
	if err := c.do(ctx, http.MethodGet, path, q, nil, &raw); err != nil {
		return nil, err
	}

	out := &ListResult{Memories: make([]MemoryRow, 0, len(raw.Items))}
	for _, it := range raw.Items {
		out.Memories = append(out.Memories, toRow(it))
	}
	if raw.NextCursor != nil && *raw.NextCursor != "" {
		out.NextCursor = raw.NextCursor
	}
	out.Total = raw.Total
	out.Entity = raw.Entity
	return out, nil
}

// sessionsWireRow mirrors the provider's SessionSummary wire shape.
type sessionsWireRow struct {
	SessionID      string `json:"sessionId"`
	MemoryCount    int    `json:"memoryCount"`
	LastActivityAt string `json:"lastActivityAt"`
}

// ListSessions enumerates the subject's SESSION sub-scopes via the provider's
// `GET /v1/scopes/user/{subject}/sessions` (session-separation, 2026-07-23).
func (c *Client) ListSessions(ctx context.Context, userID string) (*SessionsResult, error) {
	var raw struct {
		Sessions []sessionsWireRow `json:"sessions"`
	}
	path := "/v1/scopes/user/" + url.PathEscape(userID) + "/sessions"
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &raw); err != nil {
		return nil, err
	}
	out := &SessionsResult{Sessions: make([]SessionRow, 0, len(raw.Sessions))}
	for _, s := range raw.Sessions {
		out.Sessions = append(out.Sessions, SessionRow{
			SessionID:      s.SessionID,
			MemoryCount:    s.MemoryCount,
			LastActivityAt: s.LastActivityAt,
		})
	}
	return out, nil
}

// --- remember / recall / reflect wire shapes --------------------------------

type rememberRequest struct {
	UserID       string            `json:"userId"`
	Text         string            `json:"text"`
	Category     string            `json:"category,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	AttributedTo string            `json:"attributedTo,omitempty"`
	Infer        *bool             `json:"infer,omitempty"`
}

type rememberResponse struct {
	Items []scopeMemoryItem `json:"items"`
}

type recallRequest struct {
	UserID      string       `json:"userId"`
	Query       string       `json:"query"`
	TopK        int          `json:"topK,omitempty"`
	Threshold   *float64     `json:"threshold,omitempty"`
	AsOf        string       `json:"asOf,omitempty"`
	GraphExpand *GraphExpand `json:"graphExpand,omitempty"`
}

type recallItem struct {
	ID        string         `json:"id"`
	Text      string         `json:"text"`
	Score     float64        `json:"score"`
	CreatedAt string         `json:"createdAt"`
	Metadata  map[string]any `json:"metadata"`
}

type recallResponse struct {
	Results []recallItem `json:"results"`
}

type reflectRequest struct {
	UserID        string `json:"userId"`
	MaxIterations int    `json:"maxIterations,omitempty"`
}

// Remember writes a memory under the subject's user scope. Conforms to the
// provider's `POST /v1/remember` (`{userId, text, ...}` → `{items}` 201).
func (c *Client) Remember(ctx context.Context, userID, text string, opts RememberOptions) (*RememberResult, error) {
	if text == "" {
		return nil, errors.New("themory: remember text required")
	}
	reqBody := rememberRequest{UserID: userID, Text: text, Category: opts.Category, Metadata: opts.Metadata, AttributedTo: opts.AttributedTo, Infer: opts.Infer}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("themory: marshal remember body: %w", err)
	}
	var raw rememberResponse
	if err := c.do(ctx, http.MethodPost, "/v1/remember", nil, bytes.NewReader(body), &raw); err != nil {
		return nil, err
	}
	out := &RememberResult{Items: make([]MemoryRow, 0, len(raw.Items))}
	for _, it := range raw.Items {
		out.Items = append(out.Items, toRow(it))
	}
	return out, nil
}

// Recall runs a semantic search under the subject's user scope. Conforms to
// the provider's `POST /v1/recall` (`{userId, query, ...}` → `{results}` 200).
func (c *Client) Recall(ctx context.Context, userID, query string, opts RecallOptions) (*RecallResult, error) {
	if query == "" {
		return nil, errors.New("themory: recall query required")
	}
	reqBody := recallRequest{UserID: userID, Query: query, TopK: opts.TopK, AsOf: opts.AsOf, GraphExpand: opts.GraphExpand}
	if opts.Threshold > 0 {
		reqBody.Threshold = &opts.Threshold
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("themory: marshal recall body: %w", err)
	}
	var raw recallResponse
	if err := c.do(ctx, http.MethodPost, "/v1/recall", nil, bytes.NewReader(body), &raw); err != nil {
		return nil, err
	}
	out := &RecallResult{Results: make([]RecallHit, 0, len(raw.Results))}
	for _, it := range raw.Results {
		hit := RecallHit{ID: it.ID, Content: it.Text, Score: it.Score, CreatedAt: it.CreatedAt}
		if cat, ok := it.Metadata["category"].(string); ok {
			hit.Category = cat
		}
		out.Results = append(out.Results, hit)
	}
	return out, nil
}

// Reflect triggers consolidation under the subject's user scope. Conforms to
// the provider's `POST /v1/reflect` (`{userId, ...}` → result 202). The
// provider's result object is passed through verbatim.
func (c *Client) Reflect(ctx context.Context, userID string, opts ReflectOptions) (*ReflectResult, error) {
	reqBody := reflectRequest{UserID: userID, MaxIterations: opts.MaxIterations}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("themory: marshal reflect body: %w", err)
	}
	var raw json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/v1/reflect", nil, bytes.NewReader(body), &raw); err != nil {
		return nil, err
	}
	return &ReflectResult{Raw: raw}, nil
}

// Metrics returns the customer's memory KPIs from the provider's real
// subject-scoped `GET /v1/scopes/user/{subject}/metrics` (ADR D2 amendment).
// All four fields are real, including `retrieval_api_usage` (TheMemory v0.12.0
// persists a per-scope recall counter; previously hardcoded 0).
func (c *Client) Metrics(ctx context.Context, userID string) (*MetricsResult, error) {
	var out MetricsResult
	path := "/v1/scopes/user/" + url.PathEscape(userID) + "/metrics"
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Entities returns aggregated entities for the subject from the provider's real
// subject-scoped `GET /v1/scopes/user/{subject}/entities` (ADR D2 amendment).
// Entities are the distinct `attributed_to` peers across the subject's memories.
//
// In the gateway's shared-key model each customer is a single USER subject, so
// only the `user` scope tab carries entities; session/agent/repo tabs return
// empty (no such sub-subject exists for the customer) — honest, not an error.
// scopePathFor resolves the provider scope path segment for a gateway scope
// value (session-separation, 2026-07-23): "" / "user" → the user tier;
// "session:<id>" → that session's sub-scope; anything else (bare "session" /
// "agent" / "repo" — a tier without an instance) → "" (caller returns empty,
// the pre-existing honest behavior for unenumerable tiers).
func scopePathFor(userID, scope, resource string) string {
	if scope == "" || scope == "user" {
		return "/v1/scopes/user/" + url.PathEscape(userID) + "/" + resource
	}
	if id, ok := strings.CutPrefix(scope, "session:"); ok && id != "" {
		return "/v1/scopes/session/" + url.PathEscape(id) + "/" + resource
	}
	return ""
}

func (c *Client) Entities(ctx context.Context, userID, scope string) (*EntitiesResult, error) {
	path := scopePathFor(userID, scope, "entities")
	if path == "" {
		return &EntitiesResult{Entities: []Entity{}}, nil
	}
	var out EntitiesResult
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out); err != nil {
		return nil, err
	}
	if out.Entities == nil {
		out.Entities = []Entity{}
	}
	return &out, nil
}

// Episodes returns one cursor-paginated page of the subject's episodic /
// message-log read surface from the provider's real
// `GET /v1/scopes/user/{subject}/episodes` (TheMemory v0.14.0). A temporal,
// bi-temporal-aware (asOf) projection of the subject's memories — distinct from
// the flat List (semantic-free, cursor-paged, order + text filter).
//
// Same shared-key rule as Entities/Graph (D3): scope!="user" → empty page (no
// sub-subject exists for the customer) — honest, not an error. Items is always a
// non-nil slice (the dashboard never sees null).
func (c *Client) Episodes(ctx context.Context, userID, scope string, opts EpisodeOptions) (*EpisodesResult, error) {
	path := scopePathFor(userID, scope, "episodes")
	if path == "" {
		return &EpisodesResult{Items: []EpisodeItem{}}, nil
	}
	q := url.Values{}
	if opts.After != "" {
		q.Set("after", opts.After)
	}
	if opts.Before != "" {
		q.Set("before", opts.Before)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Order != "" {
		q.Set("order", opts.Order)
	}
	if opts.AsOf != "" {
		q.Set("asOf", opts.AsOf)
	}
	if opts.Query != "" {
		q.Set("q", opts.Query)
	}
	var out EpisodesResult
	if err := c.do(ctx, http.MethodGet, path, q, nil, &out); err != nil {
		return nil, err
	}
	if out.Items == nil {
		out.Items = []EpisodeItem{}
	}
	return &out, nil
}

// Graph returns the subject's entity relation graph from the provider's real
// `GET /v1/scopes/user/{subject}/graph` (themory-graph-gateway-dashboard). Same
// shared-key rule as Entities (D3): scope!="user" → empty graph (no sub-subject
// exists for the customer) — honest, not an error. Nodes AND edges are always
// non-nil slices (D5 — the dashboard never sees null).
func (c *Client) Graph(ctx context.Context, userID, scope string, includeSuperseded bool) (*GraphResult, error) {
	path := scopePathFor(userID, scope, "graph")
	if path == "" {
		return &GraphResult{Nodes: []GraphNode{}, Edges: []GraphEdge{}}, nil
	}
	var out GraphResult
	// M1 — audit view: forward the include-superseded flag so the dashboard can
	// show retired (invalidated) edges alongside the active ones.
	if includeSuperseded {
		path += "?includeSuperseded=true"
	}
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out); err != nil {
		return nil, err
	}
	if out.Nodes == nil {
		out.Nodes = []GraphNode{}
	}
	if out.Edges == nil {
		out.Edges = []GraphEdge{}
	}
	return &out, nil
}

// ListSkills returns the read-only skill listing for a repo
// (dashboard-phase2b-skills-browse T3.1). The caller passes the ALREADY
// namespaced repoId (the handler composes `{subject}:{repoId}` per plan D3 for
// multi-tenant isolation); this method is transport-only and does NOT namespace
// (SRP). The repoId is url.PathEscaped so a `/`- or `:`-bearing segment yields a
// well-formed path (EC-2).
func (c *Client) ListSkills(ctx context.Context, repoID string) (*SkillsResult, error) {
	var out SkillsResult
	path := "/v1/scopes/skill/" + url.PathEscape(repoID) + "/skills"
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out); err != nil {
		return nil, err
	}
	if out.Skills == nil {
		out.Skills = []Skill{}
	}
	return &out, nil
}

// ListSkillsAll returns the cross-repo flat skills listing for a subject
// (skills-cross-repo-flat-list-gateway T1.1, ADR D1). The subject is passed BARE
// (NOT `{subject}:{repoId}` — the provider prefix-scans `agent_id LIKE
// '{subject}:%'` and returns each row's bare repoId); transport-only +
// url.PathEscaped (EC-2). Offset pagination + optional literal `q` filter.
func (c *Client) ListSkillsAll(ctx context.Context, subject string, opts SkillsAllOptions) (*SkillsAllResult, error) {
	q := url.Values{}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Offset > 0 {
		q.Set("offset", strconv.Itoa(opts.Offset))
	}
	if opts.Query != "" {
		q.Set("q", opts.Query)
	}
	if opts.IncludeSuperseded {
		q.Set("includeSuperseded", "true")
	}
	var out SkillsAllResult
	path := "/v1/scopes/skill/" + url.PathEscape(subject) + "/all"
	if err := c.do(ctx, http.MethodGet, path, q, nil, &out); err != nil {
		return nil, err
	}
	if out.Skills == nil {
		out.Skills = []SkillWithRepo{}
	}
	return &out, nil
}

// SkillDraft is the create-skill request body (skills-write-surface T3.1).
type SkillDraft struct {
	Code         string `json:"code"`
	Description  string `json:"description"`
	CodeLanguage string `json:"codeLanguage"`
}

// CreatedSkill is the POST /skills response (id + hash).
type CreatedSkill struct {
	ID   string `json:"id"`
	Hash string `json:"hash"`
}

// ErrSkillConflict is returned by AddSkill when the skill's description collides
// with an existing one (provider 409, dedup-collision per D1). The SDK handler
// maps it back to a 409 for the caller.
var ErrSkillConflict = errors.New("themory: skill already exists")

// AddSkill creates a skill under a repo (skills-write-surface T3.1). repoID is
// the ALREADY-namespaced `{subject}:{repoId}` value (the handler composes it, D3);
// this method is transport-only and url.PathEscapes it (EC-2). A provider 409 →
// ErrSkillConflict.
func (c *Client) AddSkill(ctx context.Context, repoID string, draft SkillDraft) (*CreatedSkill, error) {
	body, err := json.Marshal(draft)
	if err != nil {
		return nil, fmt.Errorf("themory: marshal add-skill body: %w", err)
	}
	var out CreatedSkill
	path := "/v1/scopes/skill/" + url.PathEscape(repoID) + "/skills"
	if err := c.do(ctx, http.MethodPost, path, nil, bytes.NewReader(body), &out); err != nil {
		var e *Error
		if errors.As(err, &e) && e.StatusCode == http.StatusConflict {
			return nil, ErrSkillConflict
		}
		return nil, err
	}
	return &out, nil
}

// ForgetSkill deletes a skill from a repo (skills-write-surface T3.1). A provider
// 404 surfaces as ErrNotFound (mapped by do()).
func (c *Client) ForgetSkill(ctx context.Context, repoID, skillID string) error {
	path := "/v1/scopes/skill/" + url.PathEscape(repoID) + "/skills/" + url.PathEscape(skillID)
	return c.do(ctx, http.MethodDelete, path, nil, nil, nil)
}

// Forget deletes one memory for the subject via the provider's scope-checked
// DELETE endpoint (themory-gateway-forget-cutover). Ownership is enforced
// SERVER-SIDE: the provider deletes the id ONLY if it belongs to the subject's
// scope, returning 404 for a cross-scope / cross-workspace / missing id — the
// same existence-leak-safe response the gateway used to synthesize. This drops
// the old O(scope) listAll() pre-check (invariant #3, now provider-enforced).
// `hard=true` requests GDPR hard erasure (default soft). `do()` maps the
// provider 204→nil, 404→ErrNotFound, 422 (non-UUID)→*Error.
func (c *Client) Forget(ctx context.Context, userID, memoryID string, hard bool) error {
	if memoryID == "" {
		return errors.New("memoryID required")
	}
	path := "/v1/scopes/user/" + url.PathEscape(userID) + "/memories/" + url.PathEscape(memoryID)
	var query url.Values
	if hard {
		query = url.Values{"hard": []string{"true"}}
	}
	return c.do(ctx, http.MethodDelete, path, query, nil, nil)
}

// ErrProviderCapabilityMissing means the provider is REACHABLE and served a
// parseable OpenAPI doc that does NOT advertise the scoped-forget DELETE route —
// an unambiguous deploy-ordering bug (gateway ahead of TheMemory v0.12.0). The
// boot guard treats ONLY this as fatal; transport/parse failures are transient.
var ErrProviderCapabilityMissing = errors.New("themory: provider does not advertise the scoped-forget DELETE route (needs v0.12.0+)")

// IsProviderCapabilityMissing reports whether err is or wraps ErrProviderCapabilityMissing.
func IsProviderCapabilityMissing(err error) bool { return errors.Is(err, ErrProviderCapabilityMissing) }

// BootCapabilityDecision is the boot policy for an AssertScopedForgetSupported result.
type BootCapabilityDecision int

const (
	// BootProceed: route advertised — start normally.
	BootProceed BootCapabilityDecision = iota
	// BootWarn: transient failure (unreachable / non-2xx / unparseable openapi) —
	// log a warning and proceed; the per-request error path covers a down provider.
	BootWarn
	// BootFatal: provider reachable + parseable but route ABSENT — deploy-ordering
	// bug; the gateway MUST NOT start (else forget 404-collapses into not-deleted).
	BootFatal
)

// ClassifyBootCapability maps an AssertScopedForgetSupported error to the boot
// policy: fatal ONLY when the capability is provably missing (D2). Keeping this a
// pure function makes the os.Exit policy unit-testable without running main.
func ClassifyBootCapability(err error) BootCapabilityDecision {
	switch {
	case err == nil:
		return BootProceed
	case IsProviderCapabilityMissing(err):
		return BootFatal
	default:
		return BootWarn
	}
}

// AssertScopedForgetSupported probes the provider's GET /v1/openapi.json once and
// confirms it advertises the scoped-forget DELETE (matched by operationId
// "scopedForget" on a `delete` op — robust to path-template formatting). Returns:
//   - nil                            → route advertised (safe to enable forget-by-id)
//   - ErrProviderCapabilityMissing   → reachable + parseable, route ABSENT (fatal: deploy-order bug)
//   - any other error                → unreachable / non-2xx / unparseable openapi (transient, NON-fatal)
//
// themory-gateway-provider-capability-guard (F1).
func (c *Client) AssertScopedForgetSupported(ctx context.Context) error {
	var doc struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
		} `json:"paths"`
	}
	if err := c.do(ctx, http.MethodGet, "/v1/openapi.json", nil, nil, &doc); err != nil {
		// A 404 on the openapi probe is NOT transient: the provider is reachable
		// but does not even serve the contract doc — it predates the scoped-forget
		// route entirely. Treat as provably missing (fatal), like a 200 that lacks
		// the op. Genuine transient failures (5xx, connection error, unparseable
		// body) fall through to a non-capability error → BootWarn (D2).
		if errors.Is(err, ErrNotFound) {
			return ErrProviderCapabilityMissing
		}
		return fmt.Errorf("themory: capability probe failed: %w", err)
	}
	for _, ops := range doc.Paths {
		if op, ok := ops["delete"]; ok && op.OperationID == "scopedForget" {
			return nil
		}
	}
	return ErrProviderCapabilityMissing
}

// do is the shared request lifecycle. Sets Authorization + Accept, executes via
// the configured http.Client, inspects status, decodes JSON into out when
// out is non-nil.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body io.Reader, out any) error {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return fmt.Errorf("themory: build request: %w", err)
	}
	// Model B (ADR D1): resolve the per-tenant Bearer from context when a resolver
	// is wired; else fall back to apiKey (tests / boot-probe / legacy single-tenant).
	// A resolver error FAILS CLOSED — the request is never sent with a master
	// credential. INVARIANT: the production DATA client is constructed with an
	// EMPTY apiKey + a resolver (cmd/main.go), so this fallback is unreachable for
	// it; a data client with a non-empty apiKey + nil resolver would bypass
	// per-tenant isolation and MUST NOT be constructed (only the control-plane
	// probe/admin clients carry a standing key).
	bearer := c.apiKey
	if c.keyResolver != nil {
		bearer, err = c.keyResolver(ctx)
		if err != nil {
			return fmt.Errorf("themory: resolve per-tenant key: %w", err)
		}
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	// theo-memory#119: the provider isolates the session/agent tiers by the
	// (workspace, user, tier) pair (theo-memory ADR-0021), so the scope path alone
	// does not identify the reader — a session read without the acting user matches
	// only ownerless rows and comes back empty over a populated session. Send the
	// auth-trusted subject the same way Traefik ForwardAuth already injects it on
	// the SDK path. Isolation still does NOT depend on this header: it is only ever
	// the authenticated ctx subject (never client input), and the scope-in-path
	// contract stands on its own for the user tier. Absent on the boot probe and
	// the control-plane clients, whose ctx carries no user.
	if u := auth.GetUser(ctx); u != nil && u.Subject != "" {
		req.Header.Set("X-Theo-User-Id", u.Subject)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("themory: %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &Error{StatusCode: resp.StatusCode, Body: string(raw)}
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("themory: decode response: %w", err)
	}
	return nil
}

// ErrNotFound is returned for 404 responses (and for gateway-side ownership
// rejection in Forget). Handlers map it to HTTP 404 for the customer.
var ErrNotFound = errors.New("themory: not found")

// IsNotFound reports whether err is or wraps ErrNotFound.
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

// Error is a typed wrapper for non-2xx responses other than 404.
type Error struct {
	StatusCode int
	Body       string
}

func (e *Error) Error() string {
	return fmt.Sprintf("themory: upstream status %d: %s", e.StatusCode, e.Body)
}
