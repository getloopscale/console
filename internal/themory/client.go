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
//  1. Every outbound request carries `Authorization: Bearer <master-key>`.
//     The customer's theo_live_* key NEVER leaves the Go process — the gateway
//     mints + holds it (internal/auth/bff_key_vault.go).
//
//  2. Tenant isolation is enforced by SCOPE-IN-PATH, not a header. TheMemory
//     scopes a listing by the URL path `/v1/scopes/user/{subject}/memories`;
//     the gateway puts the authenticated subject there. (The real server
//     IGNORES `X-Theo-User-Id`, so relying on it — as the old client did —
//     silently broke isolation.)
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
)

// Client talks to TheMemory's REST API. Construct via NewClient.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
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

	// Not supported by the provider (cursor-only pagination); retained for
	// API stability but never sent upstream.
	Offset int
}

// MemoryRow is one entry in the List response, shaped for the dashboard.
type MemoryRow struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	Category  string `json:"category,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
}

// ListResult is the gateway's GET /v1/memory/list response shape.
type ListResult struct {
	Memories []MemoryRow `json:"memories"`
	// NextCursor is the provider's opaque pagination token; nil when there is
	// no further page. (Replaces the never-functional NextOffset.)
	NextCursor *string `json:"next_cursor,omitempty"`
	Total      *int    `json:"total,omitempty"`
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

// RecallOptions are the optional fields for a recall (semantic search) call.
type RecallOptions struct {
	TopK      int
	Threshold float64 // 0 means "unset" (omitted from the request)
	AsOf      string  // optional RFC3339 bi-temporal point-in-time (v1.1); empty = omitted
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
}

// GraphResult is the GET /graph response shape (themory-graph-gateway-dashboard).
type GraphResult struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
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
}

// userScopePath builds the provider listing path for a user subject.
func userScopePath(userID string) string {
	return "/v1/scopes/user/" + url.PathEscape(userID) + "/memories"
}

func toRow(item scopeMemoryItem) MemoryRow {
	row := MemoryRow{ID: item.ID, Content: item.Text, CreatedAt: item.CreatedAt}
	if c, ok := item.Metadata["category"].(string); ok {
		row.Category = c
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

	var raw scopeListResponse
	if err := c.do(ctx, http.MethodGet, userScopePath(userID), q, nil, &raw); err != nil {
		return nil, err
	}

	out := &ListResult{Memories: make([]MemoryRow, 0, len(raw.Items))}
	for _, it := range raw.Items {
		out.Memories = append(out.Memories, toRow(it))
	}
	if raw.NextCursor != nil && *raw.NextCursor != "" {
		out.NextCursor = raw.NextCursor
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
	UserID    string   `json:"userId"`
	Query     string   `json:"query"`
	TopK      int      `json:"topK,omitempty"`
	Threshold *float64 `json:"threshold,omitempty"`
	AsOf      string   `json:"asOf,omitempty"`
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
	reqBody := recallRequest{UserID: userID, Query: query, TopK: opts.TopK, AsOf: opts.AsOf}
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
func (c *Client) Entities(ctx context.Context, userID, scope string) (*EntitiesResult, error) {
	if scope != "" && scope != "user" {
		return &EntitiesResult{Entities: []Entity{}}, nil
	}
	var out EntitiesResult
	path := "/v1/scopes/user/" + url.PathEscape(userID) + "/entities"
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out); err != nil {
		return nil, err
	}
	if out.Entities == nil {
		out.Entities = []Entity{}
	}
	return &out, nil
}

// Graph returns the subject's entity relation graph from the provider's real
// `GET /v1/scopes/user/{subject}/graph` (themory-graph-gateway-dashboard). Same
// shared-key rule as Entities (D3): scope!="user" → empty graph (no sub-subject
// exists for the customer) — honest, not an error. Nodes AND edges are always
// non-nil slices (D5 — the dashboard never sees null).
func (c *Client) Graph(ctx context.Context, userID, scope string) (*GraphResult, error) {
	if scope != "" && scope != "user" {
		return &GraphResult{Nodes: []GraphNode{}, Edges: []GraphEdge{}}, nil
	}
	var out GraphResult
	path := "/v1/scopes/user/" + url.PathEscape(userID) + "/graph"
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
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
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
