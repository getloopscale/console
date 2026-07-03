// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/auth"
)

// stubLensDataClient counts calls + can error. `calls` is the total (read tests); `writeCalls`
// counts only mutating methods (write fail-closed tests assert it stays 0 without a JWT).
type stubLensDataClient struct {
	calls      int
	writeCalls int
	err        error
}

func (s *stubLensDataClient) read(body string) (json.RawMessage, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(body), nil
}
func (s *stubLensDataClient) write(body string) (json.RawMessage, error) {
	s.calls++
	s.writeCalls++
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(body), nil
}

func (s *stubLensDataClient) ListTraces(context.Context, int, int) (json.RawMessage, error) {
	return s.read(`{"traces":[{"traceId":"t1"}]}`)
}
func (s *stubLensDataClient) ListSessions(context.Context, int, int) (json.RawMessage, error) {
	return s.read(`{"sessions":[]}`)
}
func (s *stubLensDataClient) Observability(context.Context) (json.RawMessage, error) {
	return s.read(`{"traces":0}`)
}
func (s *stubLensDataClient) Cost(context.Context, string) (json.RawMessage, error) {
	return s.read(`{"total_usd":0}`)
}
func (s *stubLensDataClient) ListDatasets(context.Context) (json.RawMessage, error) {
	return s.read(`{"datasets":[]}`)
}
func (s *stubLensDataClient) GetDataset(context.Context, string) (json.RawMessage, error) {
	return s.read(`{"id":"ds_1","items":[]}`)
}
func (s *stubLensDataClient) ListEvaluators(context.Context) (json.RawMessage, error) {
	return s.read(`{"evaluators":[]}`)
}
func (s *stubLensDataClient) ListGuards(context.Context) (json.RawMessage, error) {
	return s.read(`{"guards":[]}`)
}
func (s *stubLensDataClient) GuardBreaches(context.Context, string) (json.RawMessage, error) {
	return s.read(`{"traceIds":[]}`)
}
func (s *stubLensDataClient) ListAgents(context.Context) (json.RawMessage, error) {
	return s.read(`{"agents":[]}`)
}
func (s *stubLensDataClient) GetTrace(context.Context, string) (json.RawMessage, error) {
	return s.read(`{"traceId":"t1"}`)
}
func (s *stubLensDataClient) Ask(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return s.read(`{"answer":"because"}`)
}
func (s *stubLensDataClient) CreateDataset(context.Context, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"id":"ds_1","name":"golden","itemCount":0}`)
}
func (s *stubLensDataClient) AddDatasetItem(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"id":"ds_1","items":[{"traceId":"tr_9"}]}`)
}
func (s *stubLensDataClient) DeleteDatasetItem(context.Context, string, string) (json.RawMessage, error) {
	return s.write(`{"id":"ds_1","items":[]}`)
}
func (s *stubLensDataClient) CreateEvaluator(context.Context, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"id":"ev_1"}`)
}
func (s *stubLensDataClient) RunEvaluator(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"evaluator":"e","written":1}`)
}
func (s *stubLensDataClient) DeleteEvaluator(context.Context, string) (json.RawMessage, error) {
	return s.write(`{}`)
}
func (s *stubLensDataClient) CreateGuard(context.Context, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"id":"gd_1"}`)
}
func (s *stubLensDataClient) DeleteGuard(context.Context, string) (json.RawMessage, error) {
	return s.write(`{}`)
}
func (s *stubLensDataClient) AddTraceTag(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"tags":["prod"]}`)
}
func (s *stubLensDataClient) DeleteTraceTag(context.Context, string, string) (json.RawMessage, error) {
	return s.write(`{"tags":[]}`)
}
func (s *stubLensDataClient) AddTraceAnnotation(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return s.write(`{"annotations":[{"name":"feedback"}]}`)
}
func (s *stubLensDataClient) DeleteTraceAnnotation(context.Context, string, url.Values) (json.RawMessage, error) {
	return s.write(`{"annotations":[]}`)
}

func newLensDashboard() (*LensDashboardHandler, *stubLensDataClient) {
	stub := &stubLensDataClient{}
	return NewLensDashboardHandler(stub, slog.New(slog.NewTextHandler(io.Discard, nil))), stub
}

// tenantCtx returns a request carrying an authenticated JWT tenant.
func tenantCtx(r *http.Request, tenant string) *http.Request {
	return r.WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: tenant, AccountID: "acc-" + tenant}))
}

// TestLensDashboard_Reads_Authenticated — each read returns 200 + the pass-through body
// and hits the upstream exactly once when a JWT tenant is present.
func TestLensDashboard_Reads_Authenticated(t *testing.T) {
	cases := []struct {
		name string
		call func(h *LensDashboardHandler, w http.ResponseWriter, r *http.Request)
		path string
	}{
		{"traces", (*LensDashboardHandler).ListTraces, "/v1/dashboard/lens/traces"},
		{"sessions", (*LensDashboardHandler).ListSessions, "/v1/dashboard/lens/sessions"},
		{"observability", (*LensDashboardHandler).Observability, "/v1/dashboard/lens/observability"},
		{"cost", (*LensDashboardHandler).Cost, "/v1/dashboard/lens/cost"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, stub := newLensDashboard()
			req := tenantCtx(httptest.NewRequest(http.MethodGet, tc.path, nil), "t1")
			w := httptest.NewRecorder()
			tc.call(h, w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("%s: want 200, got %d (%s)", tc.name, w.Code, w.Body.String())
			}
			if stub.calls != 1 {
				t.Fatalf("%s: expected 1 upstream call, got %d", tc.name, stub.calls)
			}
		})
	}
}

// TestLensDashboard_NoTenant_401_FailsClosed — no user / empty tenant → 401 on every read,
// and the upstream is NEVER called (fail-closed).
func TestLensDashboard_NoTenant_401_FailsClosed(t *testing.T) {
	reads := []struct {
		name string
		call func(h *LensDashboardHandler, w http.ResponseWriter, r *http.Request)
	}{
		{"traces", (*LensDashboardHandler).ListTraces},
		{"sessions", (*LensDashboardHandler).ListSessions},
		{"observability", (*LensDashboardHandler).Observability},
		{"cost", (*LensDashboardHandler).Cost},
	}
	ctxs := []struct {
		name string
		ctx  context.Context
	}{
		{"no user", context.Background()},
		{"empty tenant", auth.WithUser(context.Background(), &auth.UserContext{TenantID: ""})},
	}
	for _, rd := range reads {
		for _, cc := range ctxs {
			t.Run(rd.name+"/"+cc.name, func(t *testing.T) {
				h, stub := newLensDashboard()
				req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/lens/"+rd.name, nil).WithContext(cc.ctx)
				w := httptest.NewRecorder()
				rd.call(h, w, req)
				if w.Code != http.StatusUnauthorized {
					t.Fatalf("%s/%s: want 401, got %d", rd.name, cc.name, w.Code)
				}
				if stub.calls != 0 {
					t.Fatalf("%s/%s: upstream MUST NOT be called without a tenant (fail-closed), got %d", rd.name, cc.name, stub.calls)
				}
			})
		}
	}
}

// TestLensDashboard_UpstreamError_502 — an upstream error surfaces as 502 (never a partial 200).
func TestLensDashboard_UpstreamError_502(t *testing.T) {
	h, stub := newLensDashboard()
	stub.err = io.ErrUnexpectedEOF
	req := tenantCtx(httptest.NewRequest(http.MethodGet, "/v1/dashboard/lens/traces", nil), "t1")
	w := httptest.NewRecorder()
	h.ListTraces(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("want 502 on upstream error, got %d", w.Code)
	}
}

// noopJWT is a pass-through stand-in for the requireJWT middleware in the mount tests (the
// fail-closed tenant check happens in the handler's authTenant, independent of requireJWT).
func noopJWT(next http.Handler) http.Handler { return next }

// mountedLens builds the real chi router via MountLensDashboard so route-set + integration
// tests exercise the exact mounted table.
func mountedLens(t *testing.T) (*chi.Mux, *stubLensDataClient) {
	t.Helper()
	h, stub := newLensDashboard()
	r := chi.NewRouter()
	MountLensDashboard(r, h, noopJWT)
	return r, stub
}

// TestLensDashboard_Writes_Authenticated — each write route, with a JWT tenant, proxies to the
// upstream exactly once and returns the pass-through body.
func TestLensDashboard_Writes_Authenticated(t *testing.T) {
	cases := []struct {
		name, method, path, body string
	}{
		{"create-dataset", http.MethodPost, "/v1/dashboard/lens/datasets", `{"name":"golden"}`},
		{"add-dataset-item", http.MethodPost, "/v1/dashboard/lens/datasets/ds_1/items", `{"traceId":"tr_9"}`},
		{"delete-dataset-item", http.MethodDelete, "/v1/dashboard/lens/datasets/ds_1/items/tr_9", ``},
		{"create-evaluator", http.MethodPost, "/v1/dashboard/lens/evaluators", `{"name":"r","kind":"rule","config":{"predicate":"x"}}`},
		{"run-evaluator", http.MethodPost, "/v1/dashboard/lens/evaluators/ev_1/run", `{"limit":5}`},
		{"delete-evaluator", http.MethodDelete, "/v1/dashboard/lens/evaluators/ev_1", ``},
		{"create-guard", http.MethodPost, "/v1/dashboard/lens/guards", `{"evaluatorId":"ev_1","operator":"gte"}`},
		{"delete-guard", http.MethodDelete, "/v1/dashboard/lens/guards/gd_1", ``},
		{"add-tag", http.MethodPost, "/v1/dashboard/lens/traces/tr_1/tags", `{"tag":"prod"}`},
		{"delete-tag", http.MethodDelete, "/v1/dashboard/lens/traces/tr_1/tags?tag=prod", ``},
		{"add-annotation", http.MethodPost, "/v1/dashboard/lens/traces/tr_1/annotations", `{"label":"good"}`},
		{"delete-annotation", http.MethodDelete, "/v1/dashboard/lens/traces/tr_1/annotations?name=feedback", ``},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, stub := mountedLens(t)
			var bodyReader io.Reader
			if tc.body != "" {
				bodyReader = strings.NewReader(tc.body)
			}
			req := tenantCtx(httptest.NewRequest(tc.method, tc.path, bodyReader), "t1")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("%s: want 200, got %d (%s)", tc.name, w.Code, w.Body.String())
			}
			if stub.writeCalls != 1 {
				t.Fatalf("%s: expected 1 write upstream call, got %d", tc.name, stub.writeCalls)
			}
		})
	}
}

// TestLensDashboard_AllWrites_NoJWT_Denied — every write route without a JWT tenant → 401 and
// ZERO upstream write calls (fail-closed — invariant 5).
func TestLensDashboard_AllWrites_NoJWT_Denied(t *testing.T) {
	writes := []struct{ method, path, body string }{
		{http.MethodPost, "/v1/dashboard/lens/datasets", `{"name":"x"}`},
		{http.MethodPost, "/v1/dashboard/lens/datasets/ds_1/items", `{"traceId":"t"}`},
		{http.MethodDelete, "/v1/dashboard/lens/datasets/ds_1/items/tr_9", ``},
		{http.MethodPost, "/v1/dashboard/lens/evaluators", `{"name":"r","kind":"rule","config":{}}`},
		{http.MethodPost, "/v1/dashboard/lens/evaluators/ev_1/run", `{}`},
		{http.MethodDelete, "/v1/dashboard/lens/evaluators/ev_1", ``},
		{http.MethodPost, "/v1/dashboard/lens/guards", `{"evaluatorId":"e","operator":"gte"}`},
		{http.MethodDelete, "/v1/dashboard/lens/guards/gd_1", ``},
		{http.MethodPost, "/v1/dashboard/lens/traces/tr_1/tags", `{"tag":"p"}`},
		{http.MethodDelete, "/v1/dashboard/lens/traces/tr_1/tags?tag=p", ``},
		{http.MethodPost, "/v1/dashboard/lens/traces/tr_1/annotations", `{"label":"g"}`},
		{http.MethodDelete, "/v1/dashboard/lens/traces/tr_1/annotations?name=feedback", ``},
	}
	for _, wr := range writes {
		t.Run(wr.method+" "+wr.path, func(t *testing.T) {
			r, stub := mountedLens(t)
			var bodyReader io.Reader
			if wr.body != "" {
				bodyReader = strings.NewReader(wr.body)
			}
			// no tenantCtx → no JWT user in context
			req := httptest.NewRequest(wr.method, wr.path, bodyReader)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("want 401 without JWT, got %d", w.Code)
			}
			if stub.writeCalls != 0 {
				t.Fatalf("upstream write MUST NOT be called without a tenant (fail-closed), got %d", stub.writeCalls)
			}
		})
	}
}

// TestLensDashboard_RouteSet_NoBodyOrAgentsMutation — ADR-3: the mounted table has NO mutating
// verb on the trace/session BODY or on /agents. Trace tags/annotations ARE writable metadata.
func TestLensDashboard_RouteSet_NoBodyOrAgentsMutation(t *testing.T) {
	r, _ := mountedLens(t)
	type route struct{ method, pattern string }
	var routes []route
	_ = chi.Walk(r, func(method, pattern string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes = append(routes, route{method, pattern})
		return nil
	})
	for _, rt := range routes {
		if rt.method != http.MethodPost && rt.method != http.MethodDelete {
			continue
		}
		// forbidden: mutating the trace/session body itself, or any /agents mutation.
		// Allowed POST/DELETE under a trace: /tags, /annotations (writable metadata) and /ask
		// (read-scope copilot query — not a body mutation).
		underTrace := strings.HasPrefix(rt.pattern, "/v1/dashboard/lens/traces/{traceID}")
		writableMeta := strings.Contains(rt.pattern, "/tags") || strings.Contains(rt.pattern, "/annotations") || strings.Contains(rt.pattern, "/ask")
		bad := rt.pattern == "/v1/dashboard/lens/traces" ||
			(underTrace && !writableMeta) ||
			strings.HasPrefix(rt.pattern, "/v1/dashboard/lens/sessions") ||
			strings.HasPrefix(rt.pattern, "/v1/dashboard/lens/agents")
		if bad {
			t.Fatalf("forbidden mutating route on read-only surface: %s %s", rt.method, rt.pattern)
		}
	}
	// sanity: the writable metadata routes ARE present.
	var hasTagPost bool
	for _, rt := range routes {
		if rt.method == http.MethodPost && strings.Contains(rt.pattern, "/tags") {
			hasTagPost = true
		}
	}
	if !hasTagPost {
		t.Fatal("expected POST .../traces/{id}/tags to be mounted (writable metadata)")
	}
}

// TestLensDashboard_WriteUpstreamError_502 — a write upstream error surfaces as 502.
func TestLensDashboard_WriteUpstreamError_502(t *testing.T) {
	r, stub := mountedLens(t)
	stub.err = io.ErrUnexpectedEOF
	req := tenantCtx(httptest.NewRequest(http.MethodPost, "/v1/dashboard/lens/datasets", strings.NewReader(`{"name":"x"}`)), "t1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("want 502 on write upstream error, got %d", w.Code)
	}
}
