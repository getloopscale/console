// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Plan 1 of dashboard-memory-section-roadmap.md, T1.3-T1.5.
// Tests for the 3 memory handlers (List / Metrics / Forget) — covering
// the auth boundary (RequireScope is plugged in main.go; here we test
// the handlers themselves get the user from ctx + delegate to the client),
// the D3 empty-state semantics, the D5-inherited cross-tenant 404, and
// the EC-2-style malformed-id-rejected-before-client invariant.

package unit

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/routes"
	"github.com/usetheodev/theo-cloud/internal/themory"
)

// fakeTheMemory captures inbound arguments + lets each test program a
// canned response. Implements the routes.TheMemoryClient interface so
// the handler can be wired without a real HTTP server.
type fakeTheMemory struct {
	lastUserID        string
	lastOpts          themory.ListOptions
	lastForget        string
	lastForgetHard    bool
	lastEntitiesScope string
	lastRememberText  string
	lastRememberAttr  string
	lastRememberInfer *bool
	lastRecallQuery   string
	lastRecallAsOf    string
	lastReflectIter   int

	listResp          *themory.ListResult
	listErr           error
	metricsResp       *themory.MetricsResult
	metricsErr        error
	forgetErr         error
	entitiesResp      *themory.EntitiesResult
	entitiesErr       error
	graphResp         *themory.GraphResult
	graphErr          error
	lastGraphScope    string
	episodesResp      *themory.EpisodesResult
	episodesErr       error
	lastEpisodesScope string
	lastEpisodeOpts   themory.EpisodeOptions
	rememberResp      *themory.RememberResult
	rememberErr       error
	recallResp        *themory.RecallResult
	recallErr         error
	reflectResp       *themory.ReflectResult
	reflectErr        error
	skillsResp        *themory.SkillsResult
	skillsErr         error
	lastSkillsRepoID  string
	addSkillResp      *themory.CreatedSkill
	addSkillErr       error
	lastAddSkillDraft themory.SkillDraft
	forgetSkillErr       error
	lastForgetSkillID    string
	skillsAllResp        *themory.SkillsAllResult
	skillsAllErr         error
	lastSkillsAllSubject string
	lastSkillsAllOpts    themory.SkillsAllOptions
}

func (f *fakeTheMemory) ListSkills(_ context.Context, repoID string) (*themory.SkillsResult, error) {
	f.lastSkillsRepoID = repoID
	return f.skillsResp, f.skillsErr
}

func (f *fakeTheMemory) ListSkillsAll(_ context.Context, subject string, opts themory.SkillsAllOptions) (*themory.SkillsAllResult, error) {
	f.lastSkillsAllSubject = subject
	f.lastSkillsAllOpts = opts
	return f.skillsAllResp, f.skillsAllErr
}

func (f *fakeTheMemory) AddSkill(_ context.Context, repoID string, draft themory.SkillDraft) (*themory.CreatedSkill, error) {
	f.lastSkillsRepoID = repoID
	f.lastAddSkillDraft = draft
	return f.addSkillResp, f.addSkillErr
}

func (f *fakeTheMemory) ForgetSkill(_ context.Context, repoID, skillID string) error {
	f.lastSkillsRepoID = repoID
	f.lastForgetSkillID = skillID
	return f.forgetSkillErr
}

func (f *fakeTheMemory) Remember(_ context.Context, userID, text string, opts themory.RememberOptions) (*themory.RememberResult, error) {
	f.lastUserID = userID
	f.lastRememberText = text
	f.lastRememberAttr = opts.AttributedTo
	f.lastRememberInfer = opts.Infer
	return f.rememberResp, f.rememberErr
}

func (f *fakeTheMemory) Recall(_ context.Context, userID, query string, opts themory.RecallOptions) (*themory.RecallResult, error) {
	f.lastUserID = userID
	f.lastRecallQuery = query
	f.lastRecallAsOf = opts.AsOf
	return f.recallResp, f.recallErr
}

func (f *fakeTheMemory) Reflect(_ context.Context, userID string, opts themory.ReflectOptions) (*themory.ReflectResult, error) {
	f.lastUserID = userID
	f.lastReflectIter = opts.MaxIterations
	return f.reflectResp, f.reflectErr
}

func (f *fakeTheMemory) List(_ context.Context, userID string, opts themory.ListOptions) (*themory.ListResult, error) {
	f.lastUserID = userID
	f.lastOpts = opts
	return f.listResp, f.listErr
}

func (f *fakeTheMemory) Metrics(_ context.Context, userID string) (*themory.MetricsResult, error) {
	f.lastUserID = userID
	return f.metricsResp, f.metricsErr
}

func (f *fakeTheMemory) Forget(_ context.Context, userID, memoryID string, hard bool) error {
	f.lastUserID = userID
	f.lastForget = memoryID
	f.lastForgetHard = hard
	return f.forgetErr
}

func newMemoryHandler(t *testing.T) (*routes.MemoryHandler, *fakeTheMemory) {
	t.Helper()
	fake := &fakeTheMemory{}
	return routes.NewMemoryHandler(fake, nil), fake
}

// =============================================================================
// GET /v1/memory/list — T1.3
// =============================================================================

func TestMemoryList_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest("GET", "/v1/memory/list", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated, got %d", rec.Code)
	}
}

// Plan 1 D1 + CLAUDE.md Invariant 3: the handler MUST derive the userID
// from auth.GetUser(ctx).Subject — NEVER from a query param or body.
// Verify by setting a UserContext + an attacker-supplied query param;
// the client should receive the authenticated subject.
func TestMemoryList_DerivesUserIDFromAuthNotQuery(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.listResp = &themory.ListResult{Memories: []themory.MemoryRow{}}

	req := authedRequest("GET", "/v1/memory/list?subject=attacker-supplied",
		&auth.UserContext{Subject: "user-A", TenantID: "tenant-A"})
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastUserID != "user-A" {
		t.Fatalf("client received userID=%q, want %q (D1 isolation violation if drift)", fake.lastUserID, "user-A")
	}
}

func TestMemoryList_PropagatesPaginationParams(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.listResp = &themory.ListResult{Memories: []themory.MemoryRow{}}

	req := authedRequest("GET", "/v1/memory/list?limit=50&offset=100&category=facts",
		&auth.UserContext{Subject: "u", TenantID: "t"})
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if fake.lastOpts.Limit != 50 || fake.lastOpts.Offset != 100 || fake.lastOpts.Category != "facts" {
		t.Errorf("query params not propagated: got %+v", fake.lastOpts)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

// D3: empty memories must serialise as `[]`, never `null`.
func TestMemoryList_EmptyResultSerialisesAsArrayNotNull(t *testing.T) {
	h, fake := newMemoryHandler(t)
	// Simulate TheMemory returning literally nil — the client wraps to
	// empty slice, but defense-in-depth here too.
	fake.listResp = &themory.ListResult{Memories: nil}

	rec := httptest.NewRecorder()
	h.List(rec, authedRequest("GET", "/v1/memory/list", &auth.UserContext{Subject: "u", TenantID: "t"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, `"memories":null`) {
		t.Errorf("memories MUST serialise as [], got null — D3 invariant violated. body=%s", body)
	}
	if !strings.Contains(body, `"memories":[`) {
		t.Errorf("expected memories as array, got: %s", body)
	}
}

// Client error from TheMemory → 502 Bad Gateway. Differentiated from
// 500 because the failure is in an upstream dependency, not a Go bug.
func TestMemoryList_UpstreamErrorReturns502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.listErr = errors.New("connection refused")

	rec := httptest.NewRecorder()
	h.List(rec, authedRequest("GET", "/v1/memory/list", &auth.UserContext{Subject: "u", TenantID: "t"}))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream error, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// GET /v1/memory/metrics — T1.4
// =============================================================================

func TestMemoryMetrics_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Metrics(rec, httptest.NewRequest("GET", "/v1/memory/metrics", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// D3: empty pgvector → zero everywhere. We simulate TheMemory returning
// the zero-initialised struct (which the client does for us); handler
// must serialise it as JSON numbers, not omit fields or send strings.
func TestMemoryMetrics_EmptyPgVectorRendersAsZeroNotNaN(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.metricsResp = &themory.MetricsResult{} // all zeros

	rec := httptest.NewRecorder()
	h.Metrics(rec, authedRequest("GET", "/v1/memory/metrics", &auth.UserContext{Subject: "u", TenantID: "t"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v body=%s", err, rec.Body.String())
	}
	// All four metric keys MUST be present and MUST be numbers (not null,
	// not absent, not strings). This is the D3 invariant.
	for _, key := range []string{"total_memories", "retrieval_api_usage", "add_events", "entity_count"} {
		v, ok := got[key]
		if !ok {
			t.Errorf("metric %q missing from empty response (D3 violation)", key)
			continue
		}
		// JSON numbers decode to float64 in Go's untyped map.
		if _, ok := v.(float64); !ok {
			t.Errorf("metric %q has non-numeric type %T (D3 violation: %v)", key, v, v)
		}
	}
}

func TestMemoryMetrics_PopulatedEchosCorrectly(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.metricsResp = &themory.MetricsResult{
		TotalMemories: 42, RetrievalAPIUsage: 1000, AddEvents: 5, EntityCount: 7,
	}

	rec := httptest.NewRecorder()
	h.Metrics(rec, authedRequest("GET", "/v1/memory/metrics", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"total_memories":42`) {
		t.Errorf("expected total_memories=42, got %s", rec.Body.String())
	}
}

// =============================================================================
// DELETE /v1/memory/forget/{memoryID} — T1.5
// =============================================================================

func memoryForgetReq(t *testing.T, memoryID string, u *auth.UserContext) *http.Request {
	t.Helper()
	req := httptest.NewRequest("DELETE", "/v1/memory/forget/x", nil)
	if u != nil {
		req = req.WithContext(auth.WithUser(req.Context(), u))
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("memoryID", memoryID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestMemoryForget_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/v1/memory/forget/mem-1234", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("memoryID", "mem-1234")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	h.Forget(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// T1.5: own memory deleted OK → 204.
func TestMemoryForget_OwnMemoryReturns204(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.forgetErr = nil

	rec := httptest.NewRecorder()
	h.Forget(rec, memoryForgetReq(t, "mem-aaaa1111bbbb2222", &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastForget != "mem-aaaa1111bbbb2222" {
		t.Errorf("client received memoryID=%q", fake.lastForget)
	}
	if fake.lastUserID != "user-A" {
		t.Errorf("client received userID=%q, want user-A (D1 isolation violation if drift)", fake.lastUserID)
	}
}

// D5 inheritance: cross-tenant → 404 (NOT 403). TheMemory returns 404
// because the memoryID + X-Theo-User-Id combination doesn't match.
func TestMemoryForget_CrossTenantReturns404NotForbidden(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.forgetErr = themory.ErrNotFound

	rec := httptest.NewRecorder()
	h.Forget(rec, memoryForgetReq(t, "mem-someoneeleses", &auth.UserContext{Subject: "user-B", TenantID: "tenant-B"}))

	if rec.Code == http.StatusForbidden {
		t.Fatal("CRITICAL: cross-tenant DELETE returned 403 — leaks memory existence (D5 violation). Must return 404.")
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for cross-tenant, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// EC-2-style guard: malformed memoryID rejected with 400 BEFORE the
// client is even called. Prevents path-traversal probes from polluting
// upstream logs.
func TestMemoryForget_MalformedIDRejectedBeforeClient(t *testing.T) {
	cases := []string{
		"../../etc/passwd",
		"'; DROP TABLE--",
		"",                       // empty
		strings.Repeat("a", 200), // too long
	}
	for _, malformed := range cases {
		t.Run(malformed, func(t *testing.T) {
			h, fake := newMemoryHandler(t)

			rec := httptest.NewRecorder()
			h.Forget(rec, memoryForgetReq(t, malformed, &auth.UserContext{Subject: "u", TenantID: "t"}))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 INVALID_ID for %q, got %d", malformed, rec.Code)
			}
			// Client must NOT have been called.
			if fake.lastForget != "" {
				t.Errorf("client called with %q before validation — malformed-id-before-client invariant violated", fake.lastForget)
			}
		})
	}
}

// =============================================================================
// Memory Webhook Delivery plan T5.6 — Forget emits delivery rows
// =============================================================================

// fakePublisher captures inbound Publish calls. Implements
// routes.WebhookEventPublisher.
type fakePublisher struct {
	calls []publishCall
}

type publishCall struct {
	subject, tenantID, eventType string
	payload                      map[string]any
}

func (p *fakePublisher) Publish(_ context.Context, subject, tenantID, eventType string, payload map[string]any) {
	p.calls = append(p.calls, publishCall{subject, tenantID, eventType, payload})
}

// T5.6 — successful forget emits a memory.forgotten event with the
// authenticated subject + tenant_id + memory_id in the payload.
func TestMemoryForget_PublishesEventOnSuccess(t *testing.T) {
	h, fake := newMemoryHandler(t)
	pub := &fakePublisher{}
	h.WithEventPublisher(pub)
	fake.forgetErr = nil

	rec := httptest.NewRecorder()
	h.Forget(rec, memoryForgetReq(t, "mem-aaaa1111bbbb2222", &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	if len(pub.calls) != 1 {
		t.Fatalf("expected 1 Publish call, got %d", len(pub.calls))
	}
	c := pub.calls[0]
	if c.subject != "user-A" || c.tenantID != "tenant-A" {
		t.Errorf("Publish subject/tenant mismatch: %+v", c)
	}
	if c.eventType != "memory.forgotten" {
		t.Errorf("event type = %q, want memory.forgotten", c.eventType)
	}
	if c.payload["memory_id"] != "mem-aaaa1111bbbb2222" {
		t.Errorf("payload.memory_id = %v, want mem-aaaa1111bbbb2222", c.payload["memory_id"])
	}
}

// T5.6 — Forget failure (NotFound) → NO event published. The fanout
// reflects the actual mutation outcome, not the request intent.
func TestMemoryForget_NoEventOnNotFound(t *testing.T) {
	h, fake := newMemoryHandler(t)
	pub := &fakePublisher{}
	h.WithEventPublisher(pub)
	fake.forgetErr = themory.ErrNotFound

	rec := httptest.NewRecorder()
	h.Forget(rec, memoryForgetReq(t, "mem-aaaa1111bbbb2222", &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	if len(pub.calls) != 0 {
		t.Errorf("expected zero Publish on NotFound, got %d", len(pub.calls))
	}
}

// T5.6 — when handler has no publisher wired (e.g. dev mode), Forget
// still succeeds; no nil dereference panic.
func TestMemoryForget_NoPanicWithoutPublisher(t *testing.T) {
	h, fake := newMemoryHandler(t)
	// h.eventPublisher stays nil
	fake.forgetErr = nil

	rec := httptest.NewRecorder()
	h.Forget(rec, memoryForgetReq(t, "mem-aaaa1111bbbb2222", &auth.UserContext{Subject: "u", TenantID: "t"}))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
}

func TestMemoryForget_UpstreamErrorReturns502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.forgetErr = errors.New("connection refused")

	rec := httptest.NewRecorder()
	h.Forget(rec, memoryForgetReq(t, "mem-aaaa1111bbbb2222", &auth.UserContext{Subject: "u", TenantID: "t"}))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream error, got %d", rec.Code)
	}
}

// =============================================================================
// Plan 2 — GET /v1/memory/entities — T2.3
// =============================================================================

// Extend fakeTheMemory with the Entities method. (Anonymous embedding
// would risk forgetting an interface method — explicit add.)
func (f *fakeTheMemory) Entities(_ context.Context, userID, scope string) (*themory.EntitiesResult, error) {
	f.lastUserID = userID
	f.lastEntitiesScope = scope
	return f.entitiesResp, f.entitiesErr
}

// Graph — themory-graph-gateway-dashboard. Mirrors Entities.
func (f *fakeTheMemory) Graph(_ context.Context, userID, scope string) (*themory.GraphResult, error) {
	f.lastUserID = userID
	f.lastGraphScope = scope
	return f.graphResp, f.graphErr
}

// Episodes — episodes-gateway-dashboard. Mirrors Entities.
func (f *fakeTheMemory) Episodes(_ context.Context, userID, scope string, opts themory.EpisodeOptions) (*themory.EpisodesResult, error) {
	f.lastUserID = userID
	f.lastEpisodesScope = scope
	f.lastEpisodeOpts = opts
	return f.episodesResp, f.episodesErr
}

func TestMemoryEntities_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Entities(rec, httptest.NewRequest("GET", "/v1/memory/entities?scope=user", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// episodes-gateway-dashboard — MemoryHandler.Episodes mirrors Entities.
func TestMemoryEpisodes_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Episodes(rec, httptest.NewRequest("GET", "/v1/memory/episodes?scope=user", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMemoryEpisodes_InvalidScopeReturns400(t *testing.T) {
	h, fake := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	req := authedRequest("GET", "/v1/memory/episodes", &auth.UserContext{Subject: "u", TenantID: "t"})
	req.URL.RawQuery = "scope=" + url.QueryEscape("User")
	h.Episodes(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if fake.lastEpisodesScope != "" {
		t.Errorf("client called before whitelist check — gate violated")
	}
}

func TestMemoryEpisodes_InvalidLimitReturns400(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	req := authedRequest("GET", "/v1/memory/episodes", &auth.UserContext{Subject: "u", TenantID: "t"})
	req.URL.RawQuery = "scope=user&limit=notanint"
	h.Episodes(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad limit, got %d", rec.Code)
	}
}

func TestMemoryEpisodes_HappyPathForwardsOptsAndReturnsItems(t *testing.T) {
	h, fake := newMemoryHandler(t)
	cur := "CUR1"
	fake.episodesResp = &themory.EpisodesResult{
		Items:      []themory.EpisodeItem{{ID: "ep-1", Text: "moved to Lisbon", ScopeType: "user", CreatedAt: "2026-06-22T10:00:00.000Z"}},
		NextCursor: &cur,
	}
	rec := httptest.NewRecorder()
	req := authedRequest("GET", "/v1/memory/episodes", &auth.UserContext{Subject: "u", TenantID: "t"})
	req.URL.RawQuery = "scope=user&limit=2&order=desc&after=PREV&asOf=2026-06-22T11:00:00Z&q=Lisbon"
	h.Episodes(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastEpisodeOpts.Limit != 2 || fake.lastEpisodeOpts.Order != "desc" ||
		fake.lastEpisodeOpts.After != "PREV" || fake.lastEpisodeOpts.AsOf == "" || fake.lastEpisodeOpts.Query != "Lisbon" {
		t.Fatalf("opts not forwarded: %+v", fake.lastEpisodeOpts)
	}
	if !strings.Contains(rec.Body.String(), "moved to Lisbon") || !strings.Contains(rec.Body.String(), "CUR1") {
		t.Fatalf("body missing item/cursor: %s", rec.Body.String())
	}
}

// T2.3 — scope param whitelist. Anything outside {user, session, agent, repo}
// is rejected 400 BEFORE the client is called.
func TestMemoryEntities_InvalidScopeReturns400(t *testing.T) {
	cases := []string{"users", "User", "USER", "../etc", "'; DROP", "", "agent;ls"}
	for _, sc := range cases {
		t.Run("scope="+sc, func(t *testing.T) {
			h, fake := newMemoryHandler(t)
			rec := httptest.NewRecorder()
			// Construct the request with a safe path; inject the
			// (possibly hostile) scope via RawQuery so httptest doesn't
			// try to parse meta-chars as part of the request line.
			req := authedRequest("GET", "/v1/memory/entities",
				&auth.UserContext{Subject: "u", TenantID: "t"})
			req.URL.RawQuery = "scope=" + url.QueryEscape(sc)
			h.Entities(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for invalid scope %q, got %d body=%s",
					sc, rec.Code, rec.Body.String())
			}
			if fake.lastEntitiesScope != "" {
				t.Errorf("client called with %q before whitelist check — gate violated", fake.lastEntitiesScope)
			}
		})
	}
}

// T2.3 — D1 + D5 inheritance: subject derived from auth, NEVER query.
func TestMemoryEntities_SubjectFromAuthNotQuery(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.entitiesResp = &themory.EntitiesResult{Entities: []themory.Entity{}}

	rec := httptest.NewRecorder()
	req := authedRequest("GET", "/v1/memory/entities?scope=user&subject=attacker",
		&auth.UserContext{Subject: "user-A", TenantID: "tenant-A"})
	h.Entities(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastUserID != "user-A" {
		t.Fatalf("client received userID=%q, want user-A (D1 isolation)", fake.lastUserID)
	}
}

// T2.3 — each scope value in the whitelist resolves to a successful call.
func TestMemoryEntities_AllValidScopesAccepted(t *testing.T) {
	for _, sc := range []string{"user", "session", "agent", "repo"} {
		t.Run(sc, func(t *testing.T) {
			h, fake := newMemoryHandler(t)
			fake.entitiesResp = &themory.EntitiesResult{Entities: []themory.Entity{}}
			rec := httptest.NewRecorder()
			h.Entities(rec, authedRequest("GET", "/v1/memory/entities?scope="+sc,
				&auth.UserContext{Subject: "u", TenantID: "t"}))
			if rec.Code != http.StatusOK {
				t.Fatalf("scope=%s expected 200, got %d", sc, rec.Code)
			}
			if fake.lastEntitiesScope != sc {
				t.Errorf("client received scope=%q, want %q", fake.lastEntitiesScope, sc)
			}
		})
	}
}

// T2.3 — D3 inheritance: empty entities → `[]` not null.
func TestMemoryEntities_EmptyResultSerialisesAsArray(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.entitiesResp = &themory.EntitiesResult{Entities: nil}

	rec := httptest.NewRecorder()
	h.Entities(rec, authedRequest("GET", "/v1/memory/entities?scope=user",
		&auth.UserContext{Subject: "u", TenantID: "t"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"entities":null`) {
		t.Errorf("D3 inheritance violated: serialised as null. body=%s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"entities":[`) {
		t.Errorf("expected entities as array, got: %s", rec.Body.String())
	}
}

func TestMemoryEntities_UpstreamErrorReturns502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.entitiesErr = errors.New("connection refused")

	rec := httptest.NewRecorder()
	h.Entities(rec, authedRequest("GET", "/v1/memory/entities?scope=user",
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
}

// =============================================================================
// GET /v1/memory/graph — themory-graph-gateway-dashboard
// =============================================================================

func TestMemoryGraph_ReturnsNodesAndEdges(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.graphResp = &themory.GraphResult{
		Nodes: []themory.GraphNode{{ID: "John Smith", ScopeType: "user", MemoryCount: 2}},
		Edges: []themory.GraphEdge{{Source: "John Smith", Relation: "works at", Target: "Google", MemoryCount: 1}},
	}
	rec := httptest.NewRecorder()
	h.Graph(rec, authedRequest("GET", "/v1/memory/graph?scope=user",
		&auth.UserContext{Subject: "user-A", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastUserID != "user-A" {
		t.Fatalf("subject isolation: client got %q, want user-A", fake.lastUserID)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"edges":[`) || !strings.Contains(body, "Google") {
		t.Fatalf("expected edges with Google, got %s", body)
	}
}

func TestMemoryGraph_InvalidScopeReturns400(t *testing.T) {
	h, fake := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	req := authedRequest("GET", "/v1/memory/graph", &auth.UserContext{Subject: "u", TenantID: "t"})
	req.URL.RawQuery = "scope=" + url.QueryEscape("bogus")
	h.Graph(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid scope, got %d", rec.Code)
	}
	if fake.lastGraphScope != "" {
		t.Errorf("client called before whitelist check — gate violated")
	}
}

func TestMemoryGraph_EmptyResultSerialisesAsArrays(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.graphResp = &themory.GraphResult{Nodes: nil, Edges: nil}
	rec := httptest.NewRecorder()
	h.Graph(rec, authedRequest("GET", "/v1/memory/graph?scope=user",
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, `"nodes":null`) || strings.Contains(body, `"edges":null`) {
		t.Errorf("D5 violated: null array. body=%s", body)
	}
	if !strings.Contains(body, `"nodes":[`) || !strings.Contains(body, `"edges":[`) {
		t.Errorf("expected nodes+edges as arrays, got %s", body)
	}
}

func TestMemoryGraph_UpstreamErrorReturns502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.graphErr = errors.New("connection refused")
	rec := httptest.NewRecorder()
	h.Graph(rec, authedRequest("GET", "/v1/memory/graph?scope=user",
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
}

// =============================================================================
// POST /v1/memory/{remember,recall,reflect} — T1.2
// =============================================================================

func authedBodyReq(method, target, body string, u *auth.UserContext) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if u != nil {
		req = req.WithContext(auth.WithUser(req.Context(), u))
	}
	return req
}

func TestMemoryRemember_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Remember(rec, httptest.NewRequest("POST", "/v1/memory/remember", strings.NewReader(`{"text":"x"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMemoryRemember_DerivesSubjectFromAuthAndDelegates(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.rememberResp = &themory.RememberResult{Items: []themory.MemoryRow{{ID: "m1", Content: "Paulo likes oat milk"}}}

	rec := httptest.NewRecorder()
	h.Remember(rec, authedBodyReq("POST", "/v1/memory/remember",
		`{"text":"Paulo likes oat milk","category":"prefs"}`,
		&auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastUserID != "user-A" {
		t.Fatalf("subject not derived from auth: got %q", fake.lastUserID)
	}
	if fake.lastRememberText != "Paulo likes oat milk" {
		t.Fatalf("text not forwarded: got %q", fake.lastRememberText)
	}
	if !strings.Contains(rec.Body.String(), `"items":[`) {
		t.Fatalf("expected items array in response, got %s", rec.Body.String())
	}
}

func TestMemoryRemember_MissingTextReturns400(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Remember(rec, authedBodyReq("POST", "/v1/memory/remember", `{}`,
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing text, got %d", rec.Code)
	}
}

func TestMemoryRecall_DelegatesAndReturnsResults(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.recallResp = &themory.RecallResult{Results: []themory.RecallHit{{ID: "m1", Content: "oat milk", Score: 0.92}}}

	rec := httptest.NewRecorder()
	h.Recall(rec, authedBodyReq("POST", "/v1/memory/recall",
		`{"query":"what milk","topK":5}`,
		&auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastRecallQuery != "what milk" {
		t.Fatalf("query not forwarded: got %q", fake.lastRecallQuery)
	}
	if !strings.Contains(rec.Body.String(), `"score":0.92`) {
		t.Fatalf("expected scored result, got %s", rec.Body.String())
	}
}

func TestMemoryRecall_MissingQueryReturns400(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Recall(rec, authedBodyReq("POST", "/v1/memory/recall", `{}`,
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing query, got %d", rec.Code)
	}
}

func TestMemoryReflect_DelegatesAndPassesThroughResult(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.reflectResp = &themory.ReflectResult{Raw: []byte(`{"consolidated":3}`)}

	rec := httptest.NewRecorder()
	h.Reflect(rec, authedBodyReq("POST", "/v1/memory/reflect", `{"maxIterations":4}`,
		&auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastReflectIter != 4 {
		t.Fatalf("maxIterations not forwarded: got %d", fake.lastReflectIter)
	}
	if !strings.Contains(rec.Body.String(), `"consolidated":3`) {
		t.Fatalf("provider result not passed through: %s", rec.Body.String())
	}
}

// F-test-2 — Recall MUST bound topK/threshold before reaching the vector store.
func TestMemoryRecall_RejectsOutOfRangeParams(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"topK negative", `{"query":"x","topK":-1}`},
		{"topK over cap", `{"query":"x","topK":9999999}`},
		{"threshold over 1", `{"query":"x","threshold":5.0}`},
		{"threshold negative", `{"query":"x","threshold":-0.5}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, fake := newMemoryHandler(t)
			rec := httptest.NewRecorder()
			h.Recall(rec, authedBodyReq("POST", "/v1/memory/recall", tc.body,
				&auth.UserContext{Subject: "u", TenantID: "t"}))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d", tc.name, rec.Code)
			}
			if fake.lastRecallQuery != "" {
				t.Fatalf("client must NOT be called on invalid params (%s)", tc.name)
			}
		})
	}
}

// F-test-1 — the new verb handlers' upstream-502 branches must be covered.
func TestMemoryVerbs_UpstreamErrorReturns502(t *testing.T) {
	t.Run("remember 502", func(t *testing.T) {
		h, fake := newMemoryHandler(t)
		fake.rememberErr = errors.New("connection refused")
		rec := httptest.NewRecorder()
		h.Remember(rec, authedBodyReq("POST", "/v1/memory/remember", `{"text":"x"}`,
			&auth.UserContext{Subject: "u", TenantID: "t"}))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("remember: expected 502, got %d", rec.Code)
		}
	})
	t.Run("recall 502", func(t *testing.T) {
		h, fake := newMemoryHandler(t)
		fake.recallErr = errors.New("connection refused")
		rec := httptest.NewRecorder()
		h.Recall(rec, authedBodyReq("POST", "/v1/memory/recall", `{"query":"x"}`,
			&auth.UserContext{Subject: "u", TenantID: "t"}))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("recall: expected 502, got %d", rec.Code)
		}
	})
	t.Run("reflect 502", func(t *testing.T) {
		h, fake := newMemoryHandler(t)
		fake.reflectErr = errors.New("connection refused")
		rec := httptest.NewRecorder()
		h.Reflect(rec, authedBodyReq("POST", "/v1/memory/reflect", `{}`,
			&auth.UserContext{Subject: "u", TenantID: "t"}))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("reflect: expected 502, got %d", rec.Code)
		}
	})
	t.Run("metrics 502", func(t *testing.T) {
		h, fake := newMemoryHandler(t)
		fake.metricsErr = errors.New("connection refused")
		rec := httptest.NewRecorder()
		h.Metrics(rec, authedRequest("GET", "/v1/memory/metrics",
			&auth.UserContext{Subject: "u", TenantID: "t"}))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("metrics: expected 502, got %d", rec.Code)
		}
	})
}

// Phase 2A — attribution-write: attributedTo threaded to the client.
func TestMemoryRemember_AttributedToThreaded(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.rememberResp = &themory.RememberResult{Items: []themory.MemoryRow{{ID: "m1"}}}
	rec := httptest.NewRecorder()
	h.Remember(rec, authedBodyReq("POST", "/v1/memory/remember",
		`{"text":"Paulo likes oat milk","attributedTo":"paulo"}`,
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rec.Code)
	}
	if fake.lastRememberAttr != "paulo" {
		t.Fatalf("attributedTo not threaded: got %q", fake.lastRememberAttr)
	}
	// v1.1 contract: a peer forces the verbatim path so attribution persists.
	if fake.lastRememberInfer == nil || *fake.lastRememberInfer != false {
		t.Fatalf("expected infer=false when attributedTo present, got %v", fake.lastRememberInfer)
	}
}

// Without a peer, remember keeps the default extraction path (infer unset).
func TestMemoryRemember_NoPeerKeepsDefaultInfer(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.rememberResp = &themory.RememberResult{Items: []themory.MemoryRow{{ID: "m1"}}}
	rec := httptest.NewRecorder()
	h.Remember(rec, authedBodyReq("POST", "/v1/memory/remember", `{"text":"plain fact"}`,
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rec.Code)
	}
	if fake.lastRememberInfer != nil {
		t.Fatalf("expected infer unset (default extraction) without a peer, got %v", *fake.lastRememberInfer)
	}
}

// Phase 2A — bi-temporal: valid asOf threaded to the client.
func TestMemoryRecall_AsOfThreaded(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.recallResp = &themory.RecallResult{Results: []themory.RecallHit{}}
	rec := httptest.NewRecorder()
	h.Recall(rec, authedBodyReq("POST", "/v1/memory/recall",
		`{"query":"x","asOf":"2026-06-01T00:00:00Z"}`,
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastRecallAsOf != "2026-06-01T00:00:00Z" {
		t.Fatalf("asOf not threaded: got %q", fake.lastRecallAsOf)
	}
}

// Phase 2A — ADR D2: invalid asOf datetime → 400 (not laundered to 502).
func TestMemoryRecall_InvalidAsOfReturns400(t *testing.T) {
	h, fake := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.Recall(rec, authedBodyReq("POST", "/v1/memory/recall",
		`{"query":"x","asOf":"not-a-date"}`,
		&auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid asOf, got %d", rec.Code)
	}
	if fake.lastRecallQuery != "" {
		t.Fatal("client must NOT be called on invalid asOf")
	}
}

// ADR D4 — hard-delete is opt-in via ?hard=true; default stays soft.
func TestMemoryForget_HardFlagThreadedToClient(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.forgetErr = nil

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/v1/memory/forget/mem-aaaa1111bbbb2222?hard=true",
		nil).WithContext(auth.WithUser(context.Background(), &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("memoryID", "mem-aaaa1111bbbb2222")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	h.Forget(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	if !fake.lastForgetHard {
		t.Fatal("hard flag not threaded to client when ?hard=true")
	}
}

// =============================================================================
// dashboard-phase2b-skills-browse T3.2 — GET /v1/memory/skills?repoId=
// =============================================================================

func TestMemorySkills_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.ListSkills(rec, httptest.NewRequest("GET", "/v1/memory/skills?repoId=acme", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMemorySkills_RejectsEmptyRepoID(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.ListSkills(rec, authedRequest("GET", "/v1/memory/skills", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on empty repoId, got %d", rec.Code)
	}
}

func TestMemorySkills_RejectsRepoIDWithSeparator(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.ListSkills(rec, authedRequest("GET", "/v1/memory/skills?repoId=a:b", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on repoId containing ':', got %d", rec.Code)
	}
}

// D3: the handler namespaces the upstream repoId as {subject}:{repoId}.
func TestMemorySkills_NamespacesRepoIDBySubject(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.skillsResp = &themory.SkillsResult{Skills: []themory.Skill{{ID: "s1"}}, Truncated: false}
	rec := httptest.NewRecorder()
	h.ListSkills(rec, authedRequest("GET", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "sub-123", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastSkillsRepoID != "sub-123:acme" {
		t.Errorf("expected namespaced repoId 'sub-123:acme', got %q", fake.lastSkillsRepoID)
	}
}

func TestMemorySkills_EmptyResultIsArray(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.skillsResp = &themory.SkillsResult{Skills: nil}
	rec := httptest.NewRecorder()
	h.ListSkills(rec, authedRequest("GET", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"skills":[]`) {
		t.Errorf("expected empty skills array, got %s", rec.Body.String())
	}
}

func TestMemorySkills_UpstreamErrorReturns502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.skillsErr = errors.New("connection refused")
	rec := httptest.NewRecorder()
	h.ListSkills(rec, authedRequest("GET", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream error, got %d", rec.Code)
	}
}

// =============================================================================
// skills-cross-repo-flat-list-gateway — GET /v1/memory/skills/all
// =============================================================================

// ADR D1: the handler passes the BARE authenticated subject (NOT namespaced).
func TestMemorySkillsAll_PassesBareSubjectNotNamespaced(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.skillsAllResp = &themory.SkillsAllResult{
		Skills: []themory.SkillWithRepo{{Skill: themory.Skill{ID: "s1"}, RepoID: "repo-a"}},
		Total:  1,
	}
	rec := httptest.NewRecorder()
	// F-1 (/review): a competing ?subject=attacker MUST be ignored — the subject
	// comes ONLY from the authenticated session, never from request input.
	h.ListSkillsAll(rec, authedRequest("GET", "/v1/memory/skills/all?limit=25&offset=10&q=csv&subject=attacker-supplied", &auth.UserContext{Subject: "sub-123", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastSkillsAllSubject != "sub-123" {
		t.Errorf("expected BARE authed subject 'sub-123' (query ?subject ignored), got %q", fake.lastSkillsAllSubject)
	}
	if fake.lastSkillsAllOpts.Limit != 25 || fake.lastSkillsAllOpts.Offset != 10 || fake.lastSkillsAllOpts.Query != "csv" {
		t.Errorf("query params not forwarded: %+v", fake.lastSkillsAllOpts)
	}
	if !strings.Contains(rec.Body.String(), `"repoId":"repo-a"`) {
		t.Errorf("expected per-row repoId in body, got %s", rec.Body.String())
	}
}

func TestMemorySkillsAll_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.ListSkillsAll(rec, httptest.NewRequest("GET", "/v1/memory/skills/all", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMemorySkillsAll_UpstreamErrorReturns502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.skillsAllErr = errors.New("connection refused")
	rec := httptest.NewRecorder()
	h.ListSkillsAll(rec, authedRequest("GET", "/v1/memory/skills/all", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream error, got %d", rec.Code)
	}
}

func TestMemorySkillsAll_EmptyResultIsArray(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.skillsAllResp = &themory.SkillsAllResult{Skills: nil, Total: 0}
	rec := httptest.NewRecorder()
	h.ListSkillsAll(rec, authedRequest("GET", "/v1/memory/skills/all", &auth.UserContext{Subject: "u", TenantID: "t"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"skills":[]`) {
		t.Errorf("expected empty skills array, got %s", rec.Body.String())
	}
}

// =============================================================================
// skills-write-surface T3.2 — POST/DELETE /v1/memory/skills
// =============================================================================

func TestMemoryAddSkill_RejectsUnauthenticated(t *testing.T) {
	h, _ := newMemoryHandler(t)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, httptest.NewRequest("POST", "/v1/memory/skills?repoId=acme", strings.NewReader(`{}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMemoryAddSkill_NamespacesAndCreates(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.addSkillResp = &themory.CreatedSkill{ID: "sk-1", Hash: "h-1"}
	body := `{"code":"export const x=1;","description":"a skill","codeLanguage":"typescript"}`
	r := authedRequest("POST", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "sub-123", TenantID: "t"})
	r = requestWithBody(r, body)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastSkillsRepoID != "sub-123:acme" {
		t.Errorf("expected namespaced 'sub-123:acme', got %q", fake.lastSkillsRepoID)
	}
	if fake.lastAddSkillDraft.CodeLanguage != "typescript" {
		t.Errorf("draft not threaded: %+v", fake.lastAddSkillDraft)
	}
}

func TestMemoryAddSkill_Conflict409(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.addSkillErr = themory.ErrSkillConflict
	r := authedRequest("POST", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"code":"x","description":"d","codeLanguage":"typescript"}`)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
}

func TestMemoryAddSkill_InvalidBody422(t *testing.T) {
	h, _ := newMemoryHandler(t)
	r := authedRequest("POST", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"code":"","description":"d","codeLanguage":"typescript"}`)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", rec.Code)
	}
}

func TestMemoryAddSkill_RejectsRepoIDWithSeparator(t *testing.T) {
	h, _ := newMemoryHandler(t)
	r := authedRequest("POST", "/v1/memory/skills?repoId=a:b", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"code":"x","description":"d","codeLanguage":"typescript"}`)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestMemoryForgetSkill_204(t *testing.T) {
	h, fake := newMemoryHandler(t)
	r := skillDeleteReq(t, "sk-1", "acme", &auth.UserContext{Subject: "sub", TenantID: "t"})
	rec := httptest.NewRecorder()
	h.ForgetSkill(rec, r)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if fake.lastSkillsRepoID != "sub:acme" || fake.lastForgetSkillID != "sk-1" {
		t.Errorf("namespacing/skillId wrong: repo=%q id=%q", fake.lastSkillsRepoID, fake.lastForgetSkillID)
	}
}

func TestMemoryForgetSkill_404(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.forgetSkillErr = themory.ErrNotFound
	r := skillDeleteReq(t, "sk-x", "acme", &auth.UserContext{Subject: "sub", TenantID: "t"})
	rec := httptest.NewRecorder()
	h.ForgetSkill(rec, r)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// requestWithBody resets the body of an authedRequest (which is created without one).
func requestWithBody(r *http.Request, body string) *http.Request {
	r2 := r.Clone(r.Context())
	r2.Body = io.NopCloser(strings.NewReader(body))
	return r2
}

// skillDeleteReq builds a DELETE with chi skillID param + repoId query + auth.
func skillDeleteReq(t *testing.T, skillID, repoID string, u *auth.UserContext) *http.Request {
	t.Helper()
	req := httptest.NewRequest("DELETE", "/v1/memory/skills/"+skillID+"?repoId="+repoID, nil)
	if u != nil {
		req = req.WithContext(auth.WithUser(req.Context(), u))
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("skillID", skillID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// =============================================================================
// live-test-gaps-fix F-1 — gateway propagates themory upstream 4xx (not 502)
// =============================================================================

// A themory upstream 422 (e.g. unsupported skill codeLanguage) is a CLIENT
// error — it MUST pass through as 422 with the upstream code/message, NOT be
// laundered into a misleading 502 "try again".
func TestMemoryAddSkill_Upstream422PassesThrough(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.addSkillErr = &themory.Error{
		StatusCode: http.StatusUnprocessableEntity,
		Body:       `{"code":"INVALID_BODY","message":"Invalid enum value. Expected 'typescript' | 'javascript', received 'python'"}`,
	}
	r := authedRequest("POST", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"code":"x","description":"d","codeLanguage":"python"}`)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 upstream passthrough, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVALID_BODY") {
		t.Errorf("expected upstream code INVALID_BODY echoed, got %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "MEMORY_UPSTREAM_UNAVAILABLE") {
		t.Errorf("upstream 4xx must NOT be laundered to 502, got %s", rec.Body.String())
	}
}

// Representative verb handler: an upstream 4xx on recall also passes through.
func TestMemoryRecall_Upstream400PassesThrough(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.recallErr = &themory.Error{
		StatusCode: http.StatusBadRequest,
		Body:       `{"code":"INVALID_QUERY","message":"query too long"}`,
	}
	r := authedRequest("POST", "/v1/memory/recall", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"query":"x"}`)
	rec := httptest.NewRecorder()
	h.Recall(rec, r)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 upstream passthrough, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_QUERY") {
		t.Errorf("expected upstream code echoed, got %s", rec.Body.String())
	}
}

// A themory upstream 5xx is NOT a client error — it stays 502 (upstream is
// genuinely unavailable from the consumer's view).
func TestMemoryAddSkill_Upstream5xxStays502(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.addSkillErr = &themory.Error{StatusCode: http.StatusInternalServerError, Body: `{"code":"INTERNAL"}`}
	r := authedRequest("POST", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"code":"x","description":"d","codeLanguage":"typescript"}`)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream 5xx, got %d", rec.Code)
	}
}

// F-1 security refinement: a themory upstream 401/403/429 is a GATEWAY-side
// condition (master key invalid/unscoped/rate-limited), NOT the consumer's
// fault — it must be laundered to 502, never surfaced as the consumer's own
// auth/rate-limit failure.
func TestMemoryRecall_Upstream401Becomes502(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusTooManyRequests} {
		h, fake := newMemoryHandler(t)
		fake.recallErr = &themory.Error{StatusCode: status, Body: `{"code":"X"}`}
		r := authedRequest("POST", "/v1/memory/recall", &auth.UserContext{Subject: "s", TenantID: "t"})
		r = requestWithBody(r, `{"query":"x"}`)
		rec := httptest.NewRecorder()
		h.Recall(rec, r)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("upstream %d must become 502 (gateway-side), got %d", status, rec.Code)
		}
	}
}

// SEC-STATUS-2 fail-closed: an UNEXPECTED upstream 4xx (outside the
// {400,413,422} consumer-fault allowlist) is laundered to 502, NOT passed
// through — provider drift must fail closed, not mis-attribute an infra/gateway
// condition as the consumer's fault.
func TestMemoryRecall_UnexpectedUpstream4xxBecomes502(t *testing.T) {
	for _, status := range []int{http.StatusConflict, http.StatusLocked, http.StatusUnavailableForLegalReasons, http.StatusNotAcceptable} {
		h, fake := newMemoryHandler(t)
		fake.recallErr = &themory.Error{StatusCode: status, Body: `{"code":"X","message":"y"}`}
		r := authedRequest("POST", "/v1/memory/recall", &auth.UserContext{Subject: "s", TenantID: "t"})
		r = requestWithBody(r, `{"query":"x"}`)
		rec := httptest.NewRecorder()
		h.Recall(rec, r)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("unexpected upstream 4xx %d must fail closed to 502, got %d", status, rec.Code)
		}
	}
}

// 413 (body too large) is a consumer-fault status in the allowlist → passthrough.
func TestMemoryAddSkill_Upstream413PassesThrough(t *testing.T) {
	h, fake := newMemoryHandler(t)
	fake.addSkillErr = &themory.Error{StatusCode: http.StatusRequestEntityTooLarge, Body: `{"code":"PAYLOAD_TOO_LARGE","message":"body exceeds 1MB"}`}
	r := authedRequest("POST", "/v1/memory/skills?repoId=acme", &auth.UserContext{Subject: "s", TenantID: "t"})
	r = requestWithBody(r, `{"code":"x","description":"d","codeLanguage":"typescript"}`)
	rec := httptest.NewRecorder()
	h.AddSkill(rec, r)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 passthrough, got %d", rec.Code)
	}
}
