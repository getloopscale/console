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
//   - Forget -> ownership pre-check via the listing, then POST /v1/forget
//                {memoryId}; not-owned -> ErrNotFound WITHOUT touching provider
//   - Metrics-> total_memories DERIVED by counting the scope (provider has no
//                metrics endpoint)
//   - Entities-> empty (provider has no entities endpoint)

package unit

import (
	"context"
	"encoding/json"
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
	listRequests   []*http.Request
	forgetRequests []*http.Request
	forgetBodies   []string

	// listItems is the canned listing returned by the scope endpoint.
	listItems []map[string]any
	// forgetStatus is the status returned by POST /v1/forget (default 204).
	forgetStatus int
}

func newRecordingServer(t *testing.T) *recordingServer {
	t.Helper()
	s := &recordingServer{forgetStatus: 204}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/v1/scopes/"):
			s.listRequests = append(s.listRequests, r.Clone(context.Background()))
			items := s.listItems
			if items == nil {
				items = []map[string]any{}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/forget":
			body, _ := io.ReadAll(r.Body)
			s.forgetRequests = append(s.forgetRequests, r.Clone(context.Background()))
			s.forgetBodies = append(s.forgetBodies, string(body))
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
	if q.Has("offset") {
		t.Errorf("offset must NOT be sent (provider gap); got %q", q.Get("offset"))
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

// Forget invariant 1 (IDOR closed): when the id is NOT in the subject's scope,
// Forget returns ErrNotFound WITHOUT ever calling POST /v1/forget.
func TestTheMemoryClient_ForgetDeniesUnownedMemory(t *testing.T) {
	stub := newRecordingServer(t)
	stub.listItems = []map[string]any{item("mem-owned", "mine")}

	client := themory.NewClient(stub.URL, "k", nil)
	err := client.Forget(context.Background(), "victim-subject", "mem-belongs-to-someone-else", false)
	if !themory.IsNotFound(err) {
		t.Fatalf("expected ErrNotFound for unowned id, got %v", err)
	}
	if len(stub.forgetRequests) != 0 {
		t.Errorf("provider forget must NOT be called for an unowned id (IDOR); called %d times", len(stub.forgetRequests))
	}
}

// Forget invariant 2: an owned id is deleted via POST /v1/forget {memoryId}.
func TestTheMemoryClient_ForgetDeletesOwnedMemory(t *testing.T) {
	stub := newRecordingServer(t)
	stub.listItems = []map[string]any{item("mem-owned", "mine")}

	client := themory.NewClient(stub.URL, "owner", nil)
	if err := client.Forget(context.Background(), "owner-subject", "mem-owned", false); err != nil {
		t.Fatalf("Forget owned: %v", err)
	}
	if len(stub.forgetRequests) != 1 {
		t.Fatalf("expected 1 forget call, got %d", len(stub.forgetRequests))
	}
	var body struct {
		MemoryID string `json:"memoryId"`
	}
	if err := json.Unmarshal([]byte(stub.forgetBodies[0]), &body); err != nil {
		t.Fatalf("forget body not JSON: %v", err)
	}
	if body.MemoryID != "mem-owned" {
		t.Errorf("forget body memoryId = %q, want mem-owned", body.MemoryID)
	}
}

// Forget invariant 3: a 404 from the provider on the delegated delete surfaces
// as ErrNotFound.
func TestTheMemoryClient_ForgetPropagatesProvider404(t *testing.T) {
	stub := newRecordingServer(t)
	stub.listItems = []map[string]any{item("mem-owned", "mine")}
	stub.forgetStatus = 404

	client := themory.NewClient(stub.URL, "k", nil)
	err := client.Forget(context.Background(), "owner", "mem-owned", false)
	if !themory.IsNotFound(err) {
		t.Errorf("expected ErrNotFound on provider 404, got %v", err)
	}
}

// Metrics invariant: total_memories is DERIVED by counting the scope; usage
// counters are 0 (provider has no metrics endpoint).
func TestTheMemoryClient_MetricsDerivesTotalFromScope(t *testing.T) {
	stub := newRecordingServer(t)
	stub.listItems = []map[string]any{item("a", "1"), item("b", "2"), item("c", "3")}

	client := themory.NewClient(stub.URL, "k", nil)
	m, err := client.Metrics(context.Background(), "u")
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	if m.TotalMemories != 3 {
		t.Errorf("total_memories = %d, want 3 (derived)", m.TotalMemories)
	}
	if m.AddEvents != 0 || m.RetrievalAPIUsage != 0 || m.EntityCount != 0 {
		t.Errorf("usage counters must be 0 (provider gap); got %+v", m)
	}
}

// Entities invariant: returns empty WITHOUT calling the provider (no endpoint).
func TestTheMemoryClient_EntitiesReturnsEmptyWithoutProviderCall(t *testing.T) {
	stub := newRecordingServer(t)
	client := themory.NewClient(stub.URL, "k", nil)
	res, err := client.Entities(context.Background(), "u", "user")
	if err != nil {
		t.Fatalf("Entities: %v", err)
	}
	if res == nil || len(res.Entities) != 0 {
		t.Errorf("expected empty entities, got %+v", res)
	}
	if len(stub.listRequests) != 0 || len(stub.forgetRequests) != 0 {
		t.Errorf("Entities must not call the provider; list=%d forget=%d", len(stub.listRequests), len(stub.forgetRequests))
	}
}

// roundTripperFunc adapts a function to http.RoundTripper.
type roundTripperFunc func(r *http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
