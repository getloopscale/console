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
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// stubLensDataClient counts calls + can error. It exposes ONLY the read methods — the
// read-only interface is enforced at compile time (no mutating method exists to call).
type stubLensDataClient struct {
	calls int
	err   error
}

func (s *stubLensDataClient) ListTraces(context.Context, int, int) (json.RawMessage, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"traces":[{"traceId":"t1"}]}`), nil
}
func (s *stubLensDataClient) ListSessions(context.Context, int, int) (json.RawMessage, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"sessions":[]}`), nil
}
func (s *stubLensDataClient) Observability(context.Context) (json.RawMessage, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"traces":0}`), nil
}
func (s *stubLensDataClient) Cost(context.Context, string) (json.RawMessage, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"total_usd":0}`), nil
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
