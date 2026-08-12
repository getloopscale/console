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

	"github.com/usetheoai/theo-cloud/internal/config"
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

// TestServiceVersionTargets_CoverTheFleet pins the five data-plane services the
// panel claims to cover. Dropping one would silently shrink the fleet the operator
// believes is being watched — the absence is exactly what the panel must show.
func TestServiceVersionTargets_CoverTheFleet(t *testing.T) {
	targets := serviceVersionTargets(config.Config{
		ThemoryBaseURL:    "http://theo-memory:8080",
		RagBaseURL:        "http://theo-rag:8787",
		LensBaseURL:       "http://theo-lens:18082",
		StorageBaseURL:    "http://host.docker.internal:18086",
		SkillsBaseURL:     "http://host.docker.internal:18087",
		PromptlyBaseURL:   "http://theo-promptly:18085",
		TrustBaseURL:      "http://theo-trust:18088",
		EngineAPIURL:      "http://theo-api.theo-system:8080",
		TraefikMcpBaseURL: "http://host.k3d.internal:18090",
	})

	got := map[string]string{}
	for _, tg := range targets {
		got[tg.Name] = tg.BaseURL
	}
	// theo-promptly e theo-trust JA' existiam na config e estavam fora desta lista.
	// A omissao contradizia o invariante declarado logo abaixo (e no comentario de
	// serviceVersionTargets): um servico ausente esconde que ele existe e nao subiu.
	//
	// theo-api e' o engine. Entrou quando passou a falar o contrato da frota
	// (`GET /v1/version` -> {version, built_at}); antes divergia em path e em nome
	// de campo, e por isso nao havia como sonda-lo com o mesmo coletor.
	for _, name := range []string{
		"theo-memory", "theo-rag", "theo-lens", "theo-storage", "theo-skills",
		"theo-promptly", "theo-trust", "theo-api", "theo-traefik-mcp",
	} {
		if _, ok := got[name]; !ok {
			t.Fatalf("%s missing from the probed fleet; got %+v", name, got)
		}
	}
	if len(targets) != 9 {
		t.Fatalf("got %d targets, want 9", len(targets))
	}
	// Every target's URL must FLOW FROM CONFIG. This assertion replaced one that
	// pinned theo-storage to the empty string: that was true while the service had no
	// deployment, and it silently became a lie the day it got one — the panel reported
	// `not deployed` over a healthy service, which is the same class of falsehood the
	// panel exists to prevent, only in the opposite direction.
	//
	// The PORT is asserted, not just the presence of a value. The doc records why
	// (theo-workspace/docs/service-version-endpoint.md, "a segunda armadilha"): the
	// panel once showed an empty `Built` for theo-rag because the manifest pointed at a
	// stray process on another port. Nothing went red — a stray process answers 200
	// just the same — and the gate of the day only checked that the variable was set,
	// not with what.
	for name, want := range map[string]string{
		"theo-memory":      "http://theo-memory:8080",
		"theo-rag":         "http://theo-rag:8787",
		"theo-lens":        "http://theo-lens:18082",
		"theo-storage":     "http://host.docker.internal:18086",
		"theo-promptly":    "http://theo-promptly:18085",
		"theo-trust":       "http://theo-trust:18088",
		"theo-api":         "http://theo-api.theo-system:8080",
		"theo-traefik-mcp": "http://host.k3d.internal:18090",
	} {
		if got[name] != want {
			t.Fatalf("%s BaseURL = %q, want %q (the URL must come from config, port included)", name, got[name], want)
		}
	}
}

// An unconfigured service must still be LISTED, as not_deployed. Omitting it would
// hide that it exists and did not come up, and the operator counts the rows and
// concludes the fleet is complete.
func TestServiceVersionTargets_UnconfiguredServiceIsListedNotDropped(t *testing.T) {
	targets := serviceVersionTargets(config.Config{}) // nada configurado

	if len(targets) != 9 {
		t.Fatalf("got %d targets with an empty config, want all 9 still listed", len(targets))
	}
	for _, tg := range targets {
		if tg.BaseURL != "" {
			t.Errorf("%s has BaseURL %q from an empty config — it must come from config, never a literal", tg.Name, tg.BaseURL)
		}
	}
}
