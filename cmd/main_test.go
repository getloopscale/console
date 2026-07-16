// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/config"
	"github.com/usetheodev/theo-cloud/internal/rag"
	"github.com/usetheodev/theo-cloud/internal/routes"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// stubOAuthHandler builds an M8 OAuth broker with no registered providers — enough for the
// route-set walk (the handlers are never invoked during chi.Walk). An unconfigured provider
// map is exactly the shipped default until an operator registers OAuth apps via env.
func stubOAuthHandler() *routes.RagConnectorsOAuthHandler {
	return routes.NewRagConnectorsOAuthHandler(nil, nil, nil, nil, "", "", "", "", quietLogger())
}

func stubResolve(context.Context, string) (*auth.UserContext, []string, error) {
	return nil, nil, nil
}
func stubAuthorize(context.Context, string, string) (bool, error) { return true, nil }

// M38 T4 — buildLensForwardAuth is nil (feature off) when LENS_BASE_URL is unset,
// so existing deployments (LENS_BASE_URL empty) register no lens route.
func TestBuildLensForwardAuth_Disabled_WhenBaseURLUnset(t *testing.T) {
	h, broker, err := buildLensForwardAuth(config.Config{LensBaseURL: ""}, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when LENS_BASE_URL unset: %v", err)
	}
	if h != nil {
		t.Fatal("handler should be nil (feature off) when LENS_BASE_URL is unset")
	}
	if broker != nil {
		t.Fatal("broker should be nil (feature off) when LENS_BASE_URL is unset")
	}
}

// M38/M41 T4 — when LENS_BASE_URL is set (with a platform key), the handler AND the broker
// are wired. M41 (D2) — the broker is ALSO returned so the SAME broker serves both the
// edge ForwardAuth handler AND the dashboard BFF resolver (one mint cache).
func TestBuildLensForwardAuth_Wired_WhenConfigured(t *testing.T) {
	cfg := config.Config{
		LensBaseURL:          "http://theo-lens:18082",
		LensPlatformAdminKey: config.Secret("theo_live_platform"),
	}
	h, broker, err := buildLensForwardAuth(cfg, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when configured: %v", err)
	}
	if h == nil {
		t.Fatal("handler should be non-nil when LENS_BASE_URL is configured")
	}
	if broker == nil {
		t.Fatal("broker should be non-nil when configured (M41 — exposed for the dashboard BFF)")
	}
}

// M14 T4.1 — buildRagForwardAuth is nil (feature off) when RAG_BASE_URL is unset.
// M16 T2.1 — the broker is ALSO nil when unset (no MCP binding either).
func TestBuildRagForwardAuth_Disabled_WhenBaseURLUnset(t *testing.T) {
	h, broker, err := buildRagForwardAuth(config.Config{RagBaseURL: ""}, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when RAG_BASE_URL unset: %v", err)
	}
	if h != nil {
		t.Fatal("handler should be nil (feature off) when RAG_BASE_URL is unset")
	}
	if broker != nil {
		t.Fatal("broker should be nil (feature off) when RAG_BASE_URL is unset")
	}
}

// M14 T4.1 — when RAG_BASE_URL is set (with a platform key), the handler is wired.
// M16 T2.1 (D2) — the broker is ALSO returned so the SAME broker can serve both the
// REST ForwardAuth handler AND the MCP-resolve rag binding (one mint cache).
func TestBuildRagForwardAuth_Wired_WhenConfigured(t *testing.T) {
	cfg := config.Config{
		RagBaseURL:          "http://theo-rag:8787",
		RagPlatformAdminKey: config.Secret("rag_live_platform"),
	}
	h, broker, err := buildRagForwardAuth(cfg, stubResolve, stubAuthorize, quietLogger())
	if err != nil {
		t.Fatalf("unexpected error when configured: %v", err)
	}
	if h == nil {
		t.Fatal("handler should be non-nil when RAG_BASE_URL is configured")
	}
	if broker == nil {
		t.Fatal("broker should be non-nil when configured (M16 D2 — exposed for the MCP binding)")
	}
}

// M21 T1.2 — the /v1/dashboard/rag BFF route set is READ+WRITE (lifted from the M17
// read-only): the reads (GET collections/analytics) AND the writes (POST collections,
// DELETE collections/{id}, POST documents, DELETE documents/{id}, POST answers) are all
// mounted, and NO unexpected verb slips in. Walks the actual mounted routes via chi.Walk.
func TestRagDashboard_ReadWriteRouteSet(t *testing.T) {
	r := chi.NewRouter()
	h := routes.NewRagDashboardHandler(nil, quietLogger())
	passthrough := func(next http.Handler) http.Handler { return next } // stand-in for requireJWT
	mountRagDashboard(r, h, stubOAuthHandler(), passthrough)

	got := map[string]bool{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/v1/dashboard/rag") {
			got[method+" "+route] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	want := []string{
		"GET /v1/dashboard/rag/collections",
		"GET /v1/dashboard/rag/analytics",
		"GET /v1/dashboard/rag/documents",
		"POST /v1/dashboard/rag/collections",
		"DELETE /v1/dashboard/rag/collections/{id}",
		"POST /v1/dashboard/rag/documents",
		"DELETE /v1/dashboard/rag/documents/{id}",
		"POST /v1/dashboard/rag/answers",
		"GET /v1/dashboard/rag/connectors",
		"POST /v1/dashboard/rag/connectors/{provider}/connect",
		"POST /v1/dashboard/rag/connectors/{id}/sync",
		"DELETE /v1/dashboard/rag/connectors/{id}",
		"GET /v1/dashboard/rag/connectors/providers",
		// authorize + callback are NOT here — they are browser-redirect endpoints mounted at the
		// root path /v1/rag-connect (cookie-session auth, #199), not under this Bearer-only surface.
	}
	for _, w := range want {
		if !got[w] {
			t.Fatalf("expected route %q mounted under /v1/dashboard/rag; got %+v", w, got)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("unexpected extra route under /v1/dashboard/rag: got %d routes, want %d (%+v)", len(got), len(want), got)
	}
}

// M44 — the lens dashboard mount is read+write+delete. Walks the SHIPPED route table
// (routes.MountLensDashboard) and asserts: (a) the writable management routes are present, and
// (b) ADR-3 holds — NO mutating verb (POST/DELETE) on the trace/session BODY or on /agents;
// trace tags/annotations ARE writable metadata; /ask is a read-scope copilot POST;
// /replay is the M55 read-scope ephemeral provider re-run (never persists to the immutable trace).
func TestLensDashboard_ReadWriteRouteSet(t *testing.T) {
	r := chi.NewRouter()
	h := routes.NewLensDashboardHandler(nil, quietLogger())
	passthrough := func(next http.Handler) http.Handler { return next } // stand-in for requireJWT
	routes.MountLensDashboard(r, h, passthrough)

	got := map[string]bool{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/v1/dashboard/lens") {
			return nil
		}
		got[method+" "+route] = true
		if method == http.MethodPost || method == http.MethodDelete {
			underTrace := strings.HasPrefix(route, "/v1/dashboard/lens/traces/{traceID}")
			// The sanctioned trace management writes — none mutates the immutable trace BODY:
			// /tags + /annotations are writable human metadata; /ask is the read-scope copilot POST
			// (+ /ask/feedback); /replay is the M55 ephemeral provider re-run (never persisted); and
			// /enqueue-for-labeling is the M63 labeling-queue enqueue (adds the span to a review
			// workflow, not a body edit). All are behind the fail-closed per-tenant guard.
			writableMeta := strings.Contains(route, "/tags") || strings.Contains(route, "/annotations") ||
				strings.Contains(route, "/ask") || strings.Contains(route, "/replay") ||
				strings.Contains(route, "/enqueue-for-labeling")
			bad := route == "/v1/dashboard/lens/traces" ||
				(underTrace && !writableMeta) ||
				strings.HasPrefix(route, "/v1/dashboard/lens/sessions") ||
				strings.HasPrefix(route, "/v1/dashboard/lens/agents")
			if bad {
				t.Fatalf("ADR-3 violation: mutating %s on read-only surface %q", method, route)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	// The writable management routes MUST be present (a representative subset).
	want := []string{
		"POST /v1/dashboard/lens/datasets",
		"DELETE /v1/dashboard/lens/datasets/{datasetID}/items/{traceID}",
		"POST /v1/dashboard/lens/evaluators",
		"POST /v1/dashboard/lens/evaluators/{evaluatorID}/run",
		"DELETE /v1/dashboard/lens/evaluators/{evaluatorID}",
		"POST /v1/dashboard/lens/guards",
		"DELETE /v1/dashboard/lens/guards/{guardID}",
		"POST /v1/dashboard/lens/traces/{traceID}/tags",
		"DELETE /v1/dashboard/lens/traces/{traceID}/tags",
		"POST /v1/dashboard/lens/traces/{traceID}/annotations",
		"POST /v1/dashboard/lens/traces/{traceID}/replay",
		"GET /v1/dashboard/lens/traces",
		"GET /v1/dashboard/lens/agents",
	}
	for _, w := range want {
		if !got[w] {
			t.Fatalf("expected route %q mounted under /v1/dashboard/lens; got %+v", w, got)
		}
	}
}

// stubDashMinter records the args the SHIPPED newRagDashboardKeyResolver passes.
type stubDashMinter struct {
	gotAccount string
	gotTenant  string
	gotScopes  []string
	calls      int
}

func (s *stubDashMinter) KeyForTenantScoped(_ context.Context, accountID, tenantID string, scopes []string) (string, error) {
	s.calls++
	s.gotAccount, s.gotTenant, s.gotScopes = accountID, tenantID, scopes
	return "rag_live_" + tenantID, nil
}

// M21 T1.2 — the SHIPPED dashboard keyResolver mints a rag:read+write+delete key from the
// JWT tenant (the UI manages RAG). The tenant/account MUST come from the JWT, never a param.
func TestNewRagDashboardKeyResolver_MintsReadWriteFromJWTTenant(t *testing.T) {
	stub := &stubDashMinter{}
	resolve := newRagDashboardKeyResolver(stub)

	ctx := auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"})
	key, err := resolve(ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if key != "rag_live_tenantA" {
		t.Fatalf("key = %q, want rag_live_tenantA", key)
	}
	if stub.gotTenant != "tenantA" || stub.gotAccount != "accA" {
		t.Fatalf("resolver must mint from the JWT tenant/account, got tenant=%q account=%q", stub.gotTenant, stub.gotAccount)
	}
	want := map[string]bool{"rag:read": true, "rag:write": true, "rag:delete": true}
	if len(stub.gotScopes) != len(want) {
		t.Fatalf("dashboard key MUST be minted rag:read+write+delete, got %+v", stub.gotScopes)
	}
	for _, s := range stub.gotScopes {
		if !want[s] {
			t.Fatalf("unexpected scope %q in the dashboard key (want exactly read+write+delete), got %+v", s, stub.gotScopes)
		}
	}
}

// M17 T3.1 — cross-tenant isolation on the SHIPPED resolver: tenant A resolves A's key,
// tenant B resolves B's — never a shared/cross key.
func TestNewRagDashboardKeyResolver_CrossTenantIsolation(t *testing.T) {
	resolve := newRagDashboardKeyResolver(&stubDashMinter{})
	keyA, _ := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"}))
	keyB, _ := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantB", AccountID: "accB"}))
	if keyA == keyB {
		t.Fatalf("cross-tenant leak: A and B resolved the same key %q", keyA)
	}
}

// M17 T3.1 — fail-closed on the SHIPPED resolver: no JWT tenant → error, minter NOT called.
func TestNewRagDashboardKeyResolver_FailsClosed(t *testing.T) {
	stub := &stubDashMinter{}
	resolve := newRagDashboardKeyResolver(stub)
	for _, ctx := range []context.Context{
		context.Background(),
		auth.WithUser(context.Background(), &auth.UserContext{TenantID: ""}),
	} {
		if _, err := resolve(ctx); err == nil {
			t.Fatal("expected error with no authenticated tenant (fail-closed)")
		}
	}
	if stub.calls != 0 {
		t.Fatalf("minter MUST NOT be called without a tenant, got %d calls", stub.calls)
	}
}

// stubLensDashMinter records the args the SHIPPED newLensDashboardKeyResolver passes.
type stubLensDashMinter struct {
	gotAccount string
	gotTenant  string
	gotScopes  []string
	calls      int
}

func (s *stubLensDashMinter) KeyForTenantScoped(_ context.Context, accountID, tenantID string, scopes []string) (string, error) {
	s.calls++
	s.gotAccount, s.gotTenant, s.gotScopes = accountID, tenantID, scopes
	return "theo_live_" + tenantID, nil
}

// M44 — the SHIPPED lens dashboard keyResolver mints a observability:read+write+delete key from the JWT
// tenant (the management BFF; ADR-1: one resolver, per-verb least privilege enforced at
// theo-lens). The tenant/account MUST come from the JWT, never a param; the scope set MUST be
// exactly [observability:read, observability:write, observability:delete].
func TestNewLensDashboardKeyResolver_MintsReadWriteDeleteFromJWTTenant(t *testing.T) {
	stub := &stubLensDashMinter{}
	resolve := newLensDashboardKeyResolver(stub)

	key, err := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"}))
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if key != "theo_live_tenantA" {
		t.Fatalf("key = %q, want theo_live_tenantA", key)
	}
	if stub.gotTenant != "tenantA" || stub.gotAccount != "accA" {
		t.Fatalf("resolver must mint from the JWT tenant/account, got tenant=%q account=%q", stub.gotTenant, stub.gotAccount)
	}
	want := map[string]bool{"observability:read": true, "observability:write": true, "observability:delete": true}
	if len(stub.gotScopes) != len(want) {
		t.Fatalf("dashboard key MUST be minted observability:read+write+delete, got %+v", stub.gotScopes)
	}
	for _, s := range stub.gotScopes {
		if !want[s] {
			t.Fatalf("unexpected scope %q (want exactly read+write+delete), got %+v", s, stub.gotScopes)
		}
	}
}

// M41 — cross-tenant isolation on the SHIPPED lens resolver.
func TestNewLensDashboardKeyResolver_CrossTenantIsolation(t *testing.T) {
	resolve := newLensDashboardKeyResolver(&stubLensDashMinter{})
	keyA, _ := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantA", AccountID: "accA"}))
	keyB, _ := resolve(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "tenantB", AccountID: "accB"}))
	if keyA == keyB {
		t.Fatalf("cross-tenant leak: A and B resolved the same key %q", keyA)
	}
}

// M41 — fail-closed on the SHIPPED lens resolver: no JWT tenant → error, minter NOT called.
func TestNewLensDashboardKeyResolver_FailsClosed(t *testing.T) {
	stub := &stubLensDashMinter{}
	resolve := newLensDashboardKeyResolver(stub)
	for _, ctx := range []context.Context{
		context.Background(),
		auth.WithUser(context.Background(), &auth.UserContext{TenantID: ""}),
	} {
		if _, err := resolve(ctx); err == nil {
			t.Fatal("expected error with no authenticated tenant (fail-closed)")
		}
	}
	if stub.calls != 0 {
		t.Fatalf("minter MUST NOT be called without a tenant, got %d calls", stub.calls)
	}
}

// stubRagMinter mints a per-tenant key = "rag_live_"+workspaceID (workspace == tenant).
type stubRagMinter struct{}

func (stubRagMinter) MintKey(_ context.Context, workspaceID, _ string, scopes []string) (*rag.MintResult, error) {
	return &rag.MintResult{ID: "k_" + workspaceID, Secret: "rag_live_" + workspaceID, Scopes: scopes}, nil
}

// M21 T6.1 (G5) — END-TO-END write-path isolation through the FULL BFF chain:
// mounted router → requireJWT → handler → data_client → newRagDashboardKeyResolver →
// broker mint → stub theo-rag. Proves a tenant-A dashboard WRITE carries a tenant-A
// scoped key and tenant-B a tenant-B key (distinct — no cross-tenant leak), the JWT
// tenant is the sole source, and a no-JWT write is denied 401 with NO upstream call.
func TestRagDashboard_WritePath_CrossTenantIsolation_E2E(t *testing.T) {
	// A stub theo-rag that records the bearer + method + path per request.
	type hit struct{ auth, method, path string }
	var hits []hit
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, hit{r.Header.Get("Authorization"), r.Method, r.URL.Path})
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"col_x","name":"docs"}`))
	}))
	defer upstream.Close()

	broker, err := rag.NewBroker(stubRagMinter{}, 16, time.Hour, []string{"rag:read", "rag:write", "rag:delete"})
	if err != nil {
		t.Fatalf("broker: %v", err)
	}
	resolver := newRagDashboardKeyResolver(broker)
	client := rag.NewDataClient(upstream.URL, upstream.Client()).WithKeyResolver(resolver)
	h := routes.NewRagDashboardHandler(client, quietLogger())

	// requireJWT stand-in: inject the tenant from a test header (the real chain uses the
	// Kratos JWT; here we drive the SAME auth.UserContext the handler + resolver read).
	requireJWT := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if tenant := r.Header.Get("X-Test-Tenant"); tenant != "" {
				r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{TenantID: tenant, AccountID: "acc-" + tenant}))
			}
			next.ServeHTTP(w, r)
		})
	}
	router := chi.NewRouter()
	mountRagDashboard(router, h, stubOAuthHandler(), requireJWT)

	create := func(tenant string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/rag/collections", strings.NewReader(`{"name":"docs"}`))
		if tenant != "" {
			req.Header.Set("X-Test-Tenant", tenant)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	// tenant A + tenant B write → each carries its OWN per-tenant bearer at theo-rag.
	if w := create("tenantA"); w.Code != http.StatusCreated {
		t.Fatalf("tenantA create: want 201, got %d (%s)", w.Code, w.Body.String())
	}
	if w := create("tenantB"); w.Code != http.StatusCreated {
		t.Fatalf("tenantB create: want 201, got %d", w.Code)
	}
	if len(hits) != 2 {
		t.Fatalf("expected 2 upstream writes, got %d", len(hits))
	}
	if hits[0].auth != "Bearer rag_live_tenantA" {
		t.Fatalf("tenantA write carried %q, want Bearer rag_live_tenantA", hits[0].auth)
	}
	if hits[1].auth != "Bearer rag_live_tenantB" {
		t.Fatalf("tenantB write carried %q, want Bearer rag_live_tenantB", hits[1].auth)
	}
	if hits[0].auth == hits[1].auth {
		t.Fatal("cross-tenant leak: A and B writes carried the SAME bearer")
	}
	if hits[0].method != http.MethodPost || hits[0].path != "/v1/collections" {
		t.Fatalf("upstream write shape = %s %s, want POST /v1/collections", hits[0].method, hits[0].path)
	}

	// No JWT → 401, and NO upstream write (fail-closed on the write path).
	before := len(hits)
	if w := create(""); w.Code != http.StatusUnauthorized {
		t.Fatalf("no-JWT write: want 401, got %d", w.Code)
	}
	if len(hits) != before {
		t.Fatal("no-JWT write reached theo-rag — must fail closed BEFORE any upstream call")
	}
}
