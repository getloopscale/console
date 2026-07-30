// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/version"
)

// M22 T5.3 — GET /v1/version must be registered, and it must be registered OUTSIDE any auth
// middleware.
//
// Until M22 this service consumed /v1/version from every sibling and served none itself: the route
// returned a literal 404, measured 6/6 against the public-dev edge. The host reconciler probed the
// M21 aggregate instead, read its (correct) 401 as "a rota existe" and declared provenance
// converged — so the deploy's third axis was a false green.
//
// The assertion is on the composition root because that is where the defect would live: a handler
// that exists but is never mounted, or is mounted behind requireJWT, is indistinguishable from the
// 404 it replaces. This mirrors cmd/service_versions_wiring_test.go, which exists for the same
// reason — a route-table test stays green when the call is deleted from main().

func TestVersionRouteIsRegisteredInTheCompositionRoot(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "main.go", nil, parser.AllErrors)
	if err != nil {
		t.Fatalf("parsing main.go: %v", err)
	}

	var found, behindAuth bool
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Get" || len(call.Args) < 1 {
			return true
		}
		lit, ok := call.Args[0].(*ast.BasicLit)
		if !ok || lit.Value != `"/v1/version"` {
			return true
		}
		found = true
		// `r.With(requireJWT).Get(...)` — the receiver of .Get would itself be a call to With.
		if inner, ok := sel.X.(*ast.CallExpr); ok {
			if innerSel, ok := inner.Fun.(*ast.SelectorExpr); ok && innerSel.Sel.Name == "With" {
				behindAuth = true
			}
		}
		return true
	})

	if !found {
		t.Fatal(`main.go does not register r.Get("/v1/version", ...) — the reconciler's provenance ` +
			`probe would keep hitting a 404 while reporting convergence`)
	}
	if behindAuth {
		t.Fatal("/v1/version is registered behind a middleware chain. It is auth-exempt by " +
			"contract: with a credential in front, \"service down\" and \"credential wrong\" " +
			"produce the same response, which is the ambiguity the endpoint exists to remove")
	}
}

// The handler contract itself is exercised without the composition root, so a failure here points
// at the handler and a failure above points at the wiring.
func TestVersionHandlerAnswersUnauthenticated(t *testing.T) {
	w := httptest.NewRecorder()
	version.Handler()(w, httptest.NewRequest(http.MethodGet, "/v1/version", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	body := w.Body.String()
	for _, field := range []string{`"name"`, `"version"`, `"git_sha"`, `"built_at"`, `"node"`} {
		if !strings.Contains(body, field) {
			t.Errorf("response is missing %s: %s", field, body)
		}
	}
}
