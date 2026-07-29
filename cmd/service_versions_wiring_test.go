// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/config"
)

// M21 F-test-2 — the composition root is the one place the status panel is
// assembled, and nothing failed when it was removed.
//
// The sibling BFFs' route-set tests (TestRagDashboard_ReadWriteRouteSet,
// TestLensDashboard_ReadWriteRouteSet) call the mount function themselves, so they
// prove the ROUTE TABLE and not the CALL: deleting the call from main() leaves
// them green. The three tests below split that in two — one asserts the call
// exists in main(), the other two assert what the call produces.

// TestServiceVersions_MountedFromMain reads the composition root's own syntax tree
// and asserts main() still calls mountServiceVersions. It is deliberately an AST
// walk rather than a grep: a grep passes on a commented-out call, and the parser
// drops comments from the statement list.
func TestServiceVersions_MountedFromMain(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse cmd/main.go: %v", err)
	}

	var mainFn *ast.FuncDecl
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == "main" && fn.Recv == nil {
			mainFn = fn
			break
		}
	}
	if mainFn == nil {
		t.Fatal("func main not found in cmd/main.go")
	}

	called := false
	ast.Inspect(mainFn, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == "mountServiceVersions" {
			called = true
		}
		return true
	})
	if !called {
		t.Fatal("main() no longer calls mountServiceVersions — the status panel is built but never mounted, " +
			"so GET /v1/dashboard/status/versions 404s while every unit test stays green")
	}
}

// TestServiceVersions_RouteSet walks the routes the mount actually registers, and
// proves the JWT middleware is on the path rather than merely passed in.
func TestServiceVersions_RouteSet(t *testing.T) {
	r := chi.NewRouter()
	jwtSeen := false
	requireJWT := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			jwtSeen = true
			next.ServeHTTP(w, req)
		})
	}
	mountServiceVersions(r, config.Config{}, quietLogger(), requireJWT)

	got := map[string]bool{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		got[method+" "+route] = true
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	want := "GET /v1/dashboard/status/versions"
	if !got[want] {
		t.Fatalf("expected %q mounted; got %+v", want, got)
	}
	if len(got) != 1 {
		t.Fatalf("unexpected extra route under the status mount: got %d (%+v), want exactly 1", len(got), got)
	}

	// With every target unconfigured the collector answers not_deployed instantly,
	// so this exercises the real handler without touching the network.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/dashboard/status/versions", nil))
	if !jwtSeen {
		t.Fatal("the versions route answered without passing through requireJWT — the aggregate is public")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GET versions = %d, want 200", rec.Code)
	}
}

// TestServiceVersionTargets_CoverTheFleet pins the four data-plane services the
// panel claims to cover. Dropping one would silently shrink the fleet the operator
// believes is being watched — the absence is exactly what the panel must show.
func TestServiceVersionTargets_CoverTheFleet(t *testing.T) {
	targets := serviceVersionTargets(config.Config{
		ThemoryBaseURL: "http://theo-memory:8080",
		RagBaseURL:     "http://theo-rag:8787",
		LensBaseURL:    "http://theo-lens:18082",
	})

	got := map[string]string{}
	for _, tg := range targets {
		got[tg.Name] = tg.BaseURL
	}
	for _, name := range []string{"theo-memory", "theo-rag", "theo-lens", "theo-storage"} {
		if _, ok := got[name]; !ok {
			t.Fatalf("%s missing from the probed fleet; got %+v", name, got)
		}
	}
	if len(targets) != 4 {
		t.Fatalf("got %d targets, want 4", len(targets))
	}
	// theo-storage carries an empty base URL on purpose: it resolves to
	// not_deployed by the generic rule instead of being omitted.
	if got["theo-storage"] != "" {
		t.Fatalf("theo-storage BaseURL = %q, want empty (not_deployed by the generic rule)", got["theo-storage"])
	}
}
