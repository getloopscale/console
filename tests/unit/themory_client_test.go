// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// TheMemory HTTP client tests — rewritten 2026-06-18 (conform-to-provider) to
// assert TheMemory's REAL contract (its code-generated /v1/openapi.json), not
// the earlier hand-authored consumer-expectation spec.
//
// Real contract under test:
//   - List   -> GET  /v1/scopes/user/{subject}/memories  (scope-in-path; NO
//                X-Theo-User-Id header — the real server ignores it)
//                response: {items:[{id,text,createdAt,metadata}], nextCursor}
//   - Forget -> DELETE /v1/scopes/user/{subject}/memories/{id} (+?hard); the
//                provider enforces scope ownership (cross-scope -> 404 ->
//                ErrNotFound); no gateway-side listAll pre-check (cutover)
//   - Metrics-> total_memories DERIVED by counting the scope (provider has no
//                metrics endpoint)
//   - Entities-> empty (provider has no entities endpoint)

package unit

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/themory"
)

// recordingServer routes by path so a single test can exercise both the
// listing (ownership) and the forget delegation.
type recordingServer struct {
	*httptest.Server
	listRequests        []*http.Request
	deleteRequests      []*http.Request
	metricsRequests     []*http.Request
	entitiesRequests    []*http.Request
	skillsRequests      []*http.Request
	addSkillRequests    []*http.Request
	addSkillBodies      []string
	forgetSkillRequests []*http.Request

	// skillsBody is the canned body returned by the GET /skills endpoint.
	skillsBody map[string]any
	// addSkillStatus, when non-zero, overrides the POST /skills response status (e.g. 409).
	addSkillStatus int
	// forgetSkillStatus, when non-zero, overrides the DELETE /skills/{id} status (e.g. 404).
	forgetSkillStatus int

	// listItems is the canned listing returned by the scope endpoint.
	listItems []map[string]any
	// listEntityEcho, when non-empty, is echoed as the response `entity` field
	// (fail-closed cascade contract, incident 2026-07-23).
	listEntityEcho string
	// metricsBody is the canned body returned by the /metrics endpoint.
	metricsBody map[string]any
	// entitiesItems is the canned entities array returned by /entities.
	entitiesItems []map[string]any
	// forgetStatus is the status returned by the DELETE memories endpoint (default 204).
	forgetStatus int
}

func newRecordingServer(t *testing.T) *recordingServer {
	t.Helper()
	s := &recordingServer{forgetStatus: 204}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/metrics"):
			s.metricsRequests = append(s.metricsRequests, r.Clone(context.Background()))
			w.Header().Set("Content-Type", "application/json")
			body := s.metricsBody
			if body == nil {
				body = map[string]any{"total_memories": 0, "entity_count": 0, "add_events": 0, "retrieval_api_usage": 0}
			}
			_ = json.NewEncoder(w).Encode(body)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/skills"):
			s.addSkillRequests = append(s.addSkillRequests, r.Clone(context.Background()))
			body, _ := io.ReadAll(r.Body)
			s.addSkillBodies = append(s.addSkillBodies, string(body))
			w.Header().Set("Content-Type", "application/json")
			if s.addSkillStatus != 0 {
				w.WriteHeader(s.addSkillStatus)
				_ = json.NewEncoder(w).Encode(map[string]any{"code": "SKILL_ALREADY_EXISTS"})
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "sk-new", "hash": "h-new"})
		case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/skills/"):
			s.forgetSkillRequests = append(s.forgetSkillRequests, r.Clone(context.Background()))
			if s.forgetSkillStatus != 0 {
				w.WriteHeader(s.forgetSkillStatus)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/skills"):
			s.skillsRequests = append(s.skillsRequests, r.Clone(context.Background()))
			w.Header().Set("Content-Type", "application/json")
			body := s.skillsBody
			if body == nil {
				body = map[string]any{"skills": []map[string]any{}, "truncated": false}
			}
			_ = json.NewEncoder(w).Encode(body)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/entities"):
			s.entitiesRequests = append(s.entitiesRequests, r.Clone(context.Background()))
			w.Header().Set("Content-Type", "application/json")
			ents := s.entitiesItems
			if ents == nil {
				ents = []map[string]any{}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"entities": ents})
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/v1/scopes/"):
			s.listRequests = append(s.listRequests, r.Clone(context.Background()))
			items := s.listItems
			if items == nil {
				items = []map[string]any{}
			}
			w.Header().Set("Content-Type", "application/json")
			body := map[string]any{"items": items}
			if s.listEntityEcho != "" {
				body["entity"] = s.listEntityEcho
			}
			_ = json.NewEncoder(w).Encode(body)
		case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/memories/"):
			s.deleteRequests = append(s.deleteRequests, r.Clone(context.Background()))
			w.WriteHeader(s.forgetStatus)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func item(id, text string) map[string]any {
	return map[string]any{"id": id, "text": text, "createdAt": "2026-06-18T00:00:00Z"}
}

// Invariant 1: every outbound request carries the MASTER bearer. The customer's
// theo_live_* key is NEVER sent to TheMemory.
func TestTheMemoryClient_SendsMasterBearerOnList(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "master-key-secret", nil)
	if _, err := client.List(context.Background(), "user-A", themory.ListOptions{Limit: 10}); err != nil {
		t.Fatalf("List: %v", err)
	}
	if got := stub.listRequests[0].Header.Get("Authorization"); got != "Bearer master-key-secret" {
		t.Errorf("Authorization header = %q, want %q", got, "Bearer master-key-secret")
	}
}

// Invariant 2 (CRITICAL): tenant isolation is enforced by SCOPE-IN-PATH. List
// targets /v1/scopes/user/{subject}/memories — the subject is in the path, not
// a header the server ignores.
func TestTheMemoryClient_ListScopesBySubjectInPath(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	if _, err := client.List(context.Background(), "user-alex-from-auth", themory.ListOptions{}); err != nil {
		t.Fatalf("List: %v", err)
	}
	gotPath := stub.listRequests[0].URL.Path
	if gotPath != "/v1/scopes/user/user-alex-from-auth/memories" {
		t.Errorf("list path = %q, want /v1/scopes/user/user-alex-from-auth/memories", gotPath)
	}
	// The real server ignores X-Theo-User-Id; the old client relied on it and
	// silently broke isolation. Assert we do NOT depend on it.
	if got := stub.listRequests[0].Header.Get("X-Theo-User-Id"); got != "" {
		t.Errorf("X-Theo-User-Id should not be sent (server ignores it); got %q", got)
	}
}

// Invariant 3: limit + category + cursor propagate; offset is NOT sent (the
// provider scope endpoint does not support it).
func TestTheMemoryClient_PropagatesSupportedQueryParams(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	_, err := client.List(context.Background(), "u", themory.ListOptions{
		Limit: 25, Offset: 50, Category: "preferences", Cursor: "abc",
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	q := stub.listRequests[0].URL.Query()
	if q.Get("limit") != "25" {
		t.Errorf("limit = %q, want 25", q.Get("limit"))
	}
	if q.Get("category") != "preferences" {
		t.Errorf("category = %q, want preferences", q.Get("category"))
	}
	if q.Get("cursor") != "abc" {
		t.Errorf("cursor = %q, want abc", q.Get("cursor"))
	}
	// 2026-07-22: the provider implements real SQL offset pagination — the
	// client now FORWARDS it (the old pin asserted the inverse during the gap).
	if q.Get("offset") != "50" {
		t.Errorf("offset = %q, want 50 (forwarded to the provider)", q.Get("offset"))
	}
}

// Invariant 4: the provider's {items:[{id,text,createdAt,metadata}]} maps to the
// dashboard's {memories:[{id,content,category,created_at}]}.
func TestTheMemoryClient_MapsProviderItemsToMemories(t *testing.T) {
	stub := newRecordingServer(t)
	it := item("mem-1", "favorite color is blue")
	it["metadata"] = map[string]any{"category": "preferences"}
	stub.listItems = []map[string]any{it}

	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.List(context.Background(), "u", themory.ListOptions{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(res.Memories) != 1 {
		t.Fatalf("want 1 memory, got %d", len(res.Memories))
	}
	m := res.Memories[0]
	if m.ID != "mem-1" || m.Content != "favorite color is blue" || m.Category != "preferences" {
		t.Errorf("mapping wrong: %+v", m)
	}
	if m.CreatedAt == "" {
		t.Errorf("created_at not mapped")
	}
}

// Invariant 5: the client uses the provided *http.Client (otelhttp wrapping in
// prod must not be bypassed).
func TestTheMemoryClient_UsesProvidedHTTPClient(t *testing.T) {
	stub := newRecordingServer(t)
	called := false
	custom := &http.Client{
		Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			called = true
			return http.DefaultTransport.RoundTrip(r)
		}),
	}
	client := themory.NewClient(stub.URL, "k", custom)
	if _, err := client.List(context.Background(), "u", themory.ListOptions{}); err != nil {
		t.Fatalf("List: %v", err)
	}
	if !called {
		t.Error("client bypassed the provided *http.Client — otelhttp would be bypassed in prod (D4)")
	}
}

// Forget cutover invariant 1: ownership is now PROVIDER-enforced. A cross-scope
// id makes the provider's scope-checked DELETE return 404 → ErrNotFound. The
// gateway no longer pages the scope (no listAll) — it delegates one DELETE.
func TestTheMemoryClient_ForgetDeniesUnownedMemory(t *testing.T) {
	stub := newRecordingServer(t)
	stub.forgetStatus = 404 // provider rejects: id not in this subject's scope

	client := themory.NewClient(stub.URL, "k", nil)
	err := client.Forget(context.Background(), "victim-subject", "mem-belongs-to-someone-else", false)
	if !themory.IsNotFound(err) {
		t.Fatalf("expected ErrNotFound for cross-scope id, got %v", err)
	}
	if len(stub.listRequests) != 0 {
		t.Errorf("cutover: Forget must NOT page the scope (listAll removed); listed %d times", len(stub.listRequests))
	}
	if len(stub.deleteRequests) != 1 {
		t.Errorf("expected exactly 1 delegated DELETE, got %d", len(stub.deleteRequests))
	}
}

// Forget cutover invariant 2: an owned id is deleted via a single scope-checked
// DELETE /v1/scopes/user/{subject}/memories/{id} (no GET listing, no POST body).
func TestTheMemoryClient_ForgetDeletesOwnedMemory(t *testing.T) {
	stub := newRecordingServer(t)

	client := themory.NewClient(stub.URL, "owner", nil)
	if err := client.Forget(context.Background(), "owner-subject", "mem-owned", false); err != nil {
		t.Fatalf("Forget owned: %v", err)
	}
	if len(stub.deleteRequests) != 1 {
		t.Fatalf("expected 1 delete call, got %d", len(stub.deleteRequests))
	}
	gotPath := stub.deleteRequests[0].URL.Path
	if gotPath != "/v1/scopes/user/owner-subject/memories/mem-owned" {
		t.Errorf("delete path = %q, want /v1/scopes/user/owner-subject/memories/mem-owned", gotPath)
	}
	if q := stub.deleteRequests[0].URL.Query().Get("hard"); q != "" {
		t.Errorf("soft forget must not set ?hard, got %q", q)
	}
}

// Forget cutover invariant 3: ?hard=true propagates for GDPR erasure.
func TestTheMemoryClient_ForgetHardPropagates(t *testing.T) {
	stub := newRecordingServer(t)

	client := themory.NewClient(stub.URL, "owner", nil)
	if err := client.Forget(context.Background(), "owner-subject", "mem-owned", true); err != nil {
		t.Fatalf("Forget hard: %v", err)
	}
	if len(stub.deleteRequests) != 1 {
		t.Fatalf("expected 1 delete call, got %d", len(stub.deleteRequests))
	}
	if q := stub.deleteRequests[0].URL.Query().Get("hard"); q != "true" {
		t.Errorf("hard forget must set ?hard=true, got %q", q)
	}
}

// Forget cutover invariant 4: a 404 from the provider surfaces as ErrNotFound.
func TestTheMemoryClient_ForgetPropagatesProvider404(t *testing.T) {
	stub := newRecordingServer(t)
	stub.forgetStatus = 404

	client := themory.NewClient(stub.URL, "k", nil)
	err := client.Forget(context.Background(), "owner", "mem-owned", false)
	if !themory.IsNotFound(err) {
		t.Errorf("expected ErrNotFound on provider 404, got %v", err)
	}
}

// Metrics now maps the provider's real subject-scoped /metrics endpoint
// (ADR D2 amendment) — total/entity_count/add_events real, retrieval 0.
func TestTheMemoryClient_MetricsMapsProviderEndpoint(t *testing.T) {
	stub := newRecordingServer(t)
	stub.metricsBody = map[string]any{
		"total_memories": 7, "entity_count": 2, "add_events": 7, "retrieval_api_usage": 0,
	}
	client := themory.NewClient(stub.URL, "k", nil)
	m, err := client.Metrics(context.Background(), "u")
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	if m.TotalMemories != 7 || m.EntityCount != 2 || m.AddEvents != 7 {
		t.Errorf("metrics mapping wrong: %+v", m)
	}
	if len(stub.metricsRequests) != 1 {
		t.Errorf("expected 1 metrics call, got %d", len(stub.metricsRequests))
	}
	if got := stub.metricsRequests[0].URL.Path; got != "/v1/scopes/user/u/metrics" {
		t.Errorf("metrics path = %q, want /v1/scopes/user/u/metrics", got)
	}
}

// Entities maps the provider's real subject-scoped /entities endpoint for the
// user scope; non-user scopes return empty WITHOUT a provider call.
func TestTheMemoryClient_EntitiesMapsProviderEndpoint(t *testing.T) {
	stub := newRecordingServer(t)
	stub.entitiesItems = []map[string]any{
		{"id": "paulo", "scope_type": "user", "memory_count": 3, "last_seen_at": "2026-06-18T00:00:00Z"},
	}
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.Entities(context.Background(), "u", "user")
	if err != nil {
		t.Fatalf("Entities: %v", err)
	}
	if len(res.Entities) != 1 || res.Entities[0].ID != "paulo" || res.Entities[0].MemoryCount != 3 {
		t.Errorf("entities mapping wrong: %+v", res.Entities)
	}
	if len(stub.entitiesRequests) != 1 {
		t.Errorf("expected 1 entities call, got %d", len(stub.entitiesRequests))
	}
}

func TestTheMemoryClient_EntitiesNonUserScopeReturnsEmptyWithoutProviderCall(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.Entities(context.Background(), "u", "session")
	if err != nil {
		t.Fatalf("Entities: %v", err)
	}
	if res == nil || len(res.Entities) != 0 {
		t.Errorf("expected empty entities for non-user scope, got %+v", res)
	}
	if len(stub.entitiesRequests) != 0 {
		t.Errorf("non-user scope must not call the provider; got %d", len(stub.entitiesRequests))
	}
}

// --- dashboard-phase2b-skills-browse T3.1: ListSkills -----------------------

// ListSkills hits /v1/scopes/skill/{repoId}/skills and parses the result.
func TestTheMemoryClient_ListSkillsParsesResult(t *testing.T) {
	stub := newRecordingServer(t)
	code := "kubectl rollout restart"
	stub.skillsBody = map[string]any{
		"skills": []map[string]any{
			{"id": "s1", "hash": "h1", "description": "restart", "code": code, "codeLanguage": "bash", "createdAt": "2026-06-01T00:00:00Z", "derivedFrom": []string{}, "supersededBy": nil},
		},
		"truncated": false,
	}
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.ListSkills(context.Background(), "acme")
	if err != nil {
		t.Fatalf("ListSkills: %v", err)
	}
	if len(res.Skills) != 1 {
		t.Fatalf("expected 1 skill, got %d", len(res.Skills))
	}
	if res.Skills[0].ID != "s1" || res.Skills[0].Description != "restart" {
		t.Errorf("unexpected skill: %+v", res.Skills[0])
	}
	if res.Skills[0].Code == nil || *res.Skills[0].Code != code {
		t.Errorf("expected code %q, got %v", code, res.Skills[0].Code)
	}
	if len(stub.skillsRequests) != 1 {
		t.Fatalf("expected 1 skills request, got %d", len(stub.skillsRequests))
	}
	if got := stub.skillsRequests[0].URL.Path; got != "/v1/scopes/skill/acme/skills" {
		t.Errorf("unexpected path %q", got)
	}
}

// ListSkills normalizes a nil skills array to an empty slice.
func TestTheMemoryClient_ListSkillsNormalizesNil(t *testing.T) {
	stub := newRecordingServer(t)
	stub.skillsBody = map[string]any{"truncated": false} // no "skills" key
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.ListSkills(context.Background(), "acme")
	if err != nil {
		t.Fatalf("ListSkills: %v", err)
	}
	if res.Skills == nil {
		t.Errorf("expected non-nil empty slice, got nil")
	}
	if len(res.Skills) != 0 {
		t.Errorf("expected empty, got %d", len(res.Skills))
	}
}

// EC-2: ListSkills url.PathEscapes the namespaced repoId so a ':'/'/'-bearing
// segment produces a well-formed single-segment path.
func TestTheMemoryClient_ListSkillsEscapesRepoID(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	_, err := client.ListSkills(context.Background(), "sub-123:org/repo")
	if err != nil {
		t.Fatalf("ListSkills: %v", err)
	}
	if len(stub.skillsRequests) != 1 {
		t.Fatalf("expected 1 skills request, got %d", len(stub.skillsRequests))
	}
	// EscapedPath() keeps %2F/%3A encoded; the repoId stays one path segment.
	got := stub.skillsRequests[0].URL.EscapedPath()
	if got != "/v1/scopes/skill/sub-123:org%2Frepo/skills" {
		t.Errorf("expected escaped single-segment path, got %q", got)
	}
}

// roundTripperFunc adapts a function to http.RoundTripper.
type roundTripperFunc func(r *http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// --- skills-write-surface T3.1: AddSkill / ForgetSkill --------------------

func TestTheMemoryClient_AddSkillPostsDraftAndParsesResult(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.AddSkill(context.Background(), "sub:acme", themory.SkillDraft{
		Code: "export const x=1;", Description: "a skill", CodeLanguage: "typescript",
	})
	if err != nil {
		t.Fatalf("AddSkill: %v", err)
	}
	if res.ID != "sk-new" || res.Hash != "h-new" {
		t.Errorf("unexpected created skill: %+v", res)
	}
	if len(stub.addSkillRequests) != 1 {
		t.Fatalf("expected 1 add-skill request, got %d", len(stub.addSkillRequests))
	}
	if got := stub.addSkillRequests[0].URL.EscapedPath(); got != "/v1/scopes/skill/sub:acme/skills" {
		t.Errorf("unexpected escaped path %q", got)
	}
	if !strings.Contains(stub.addSkillBodies[0], `"codeLanguage":"typescript"`) {
		t.Errorf("body missing codeLanguage: %s", stub.addSkillBodies[0])
	}
}

func TestTheMemoryClient_AddSkillMaps409ToErrSkillConflict(t *testing.T) {
	stub := newRecordingServer(t)
	stub.addSkillStatus = http.StatusConflict
	client := themory.NewClient(stub.URL, "k", nil)
	_, err := client.AddSkill(context.Background(), "sub:acme", themory.SkillDraft{
		Code: "x", Description: "dupe", CodeLanguage: "typescript",
	})
	if !errors.Is(err, themory.ErrSkillConflict) {
		t.Fatalf("expected ErrSkillConflict, got %v", err)
	}
}

func TestTheMemoryClient_ForgetSkillDeletes(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	if err := client.ForgetSkill(context.Background(), "sub:acme", "sk-1"); err != nil {
		t.Fatalf("ForgetSkill: %v", err)
	}
	if len(stub.forgetSkillRequests) != 1 {
		t.Fatalf("expected 1 forget-skill request, got %d", len(stub.forgetSkillRequests))
	}
	if got := stub.forgetSkillRequests[0].URL.EscapedPath(); got != "/v1/scopes/skill/sub:acme/skills/sk-1" {
		t.Errorf("unexpected escaped path %q", got)
	}
}

func TestTheMemoryClient_ForgetSkillMaps404ToErrNotFound(t *testing.T) {
	stub := newRecordingServer(t)
	stub.forgetSkillStatus = http.StatusNotFound
	client := themory.NewClient(stub.URL, "k", nil)
	err := client.ForgetSkill(context.Background(), "sub:acme", "sk-x")
	if !themory.IsNotFound(err) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// Session-separation (2026-07-23): a non-empty SessionID targets the SESSION
// tier path `/v1/scopes/session/{id}/memories` (M8 working memory).
func TestTheMemoryClient_SessionIDTargetsSessionScopePath(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	if _, err := client.List(context.Background(), "u", themory.ListOptions{SessionID: "sess-42"}); err != nil {
		t.Fatalf("List: %v", err)
	}
	if got := stub.listRequests[0].URL.Path; got != "/v1/scopes/session/sess-42/memories" {
		t.Errorf("path = %q, want /v1/scopes/session/sess-42/memories", got)
	}
}

// Session-separation (2026-07-23): ListSessions hits the provider's session
// enumeration endpoint for the subject.
func TestTheMemoryClient_ListSessionsPath(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	if _, err := client.ListSessions(context.Background(), "user-A"); err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if got := stub.listRequests[0].URL.Path; got != "/v1/scopes/user/user-A/sessions" {
		t.Errorf("path = %q, want /v1/scopes/user/user-A/sessions", got)
	}
}

// theo-cloud#252: the per-entity filter forwards to the provider's ?entity=.
func TestTheMemoryClient_ForwardsEntityFilter(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	if _, err := client.List(context.Background(), "u", themory.ListOptions{Entity: "Codex Reviewer"}); err != nil {
		t.Fatalf("List: %v", err)
	}
	if got := stub.listRequests[0].URL.Query().Get("entity"); got != "Codex Reviewer" {
		t.Errorf("entity = %q, want %q", got, "Codex Reviewer")
	}
}

// Incident 2026-07-23: the provider's ?entity= echo threads through so
// cascade-delete clients can FAIL CLOSED when a provider ignored the filter.
func TestTheMemoryClient_DecodesEntityEcho(t *testing.T) {
	stub := newRecordingServer(t)
	stub.listEntityEcho = "Codex"
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.List(context.Background(), "u", themory.ListOptions{Entity: "Codex"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if res.Entity == nil || *res.Entity != "Codex" {
		t.Errorf("Entity echo = %v, want Codex", res.Entity)
	}
}
