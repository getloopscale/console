// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package normalize

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Red Team theo-cloud#86 regression-protectors. The middleware MUST
// redirect any request with consecutive slashes in the URI to the
// canonical single-slash form with HTTP 308 (preserves method + body).
// The 4 scenarios lock the 4-axis attack surface from the issue body.

func TestPathSlashes_DoubleSlashEnginePath_Returns308_RedTeam86(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("next handler must NOT be called for double-slash paths")
	})
	h := PathSlashes(next)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RequestURI = "//engine/api/v1/projects" // verbatim Red Team repro
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusPermanentRedirect {
		t.Errorf("Red Team #86: want 308, got %d", w.Code)
	}
	if got := w.Header().Get("Location"); got != "/engine/api/v1/projects" {
		t.Errorf("Red Team #86: Location must collapse to canonical /engine/api/v1/projects, got %q", got)
	}
}

func TestPathSlashes_TripleSlash_DefenseInDepth_RedTeam86(t *testing.T) {
	h := PathSlashes(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("next handler must NOT be called for triple-slash paths")
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RequestURI = "///engine/api/v1/secrets"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusPermanentRedirect {
		t.Errorf("triple-slash must also 308, got %d", w.Code)
	}
	if got := w.Header().Get("Location"); got != "/engine/api/v1/secrets" {
		t.Errorf("triple-slash Location must collapse to canonical, got %q", got)
	}
}

func TestPathSlashes_PreservesQueryString_RedTeam86(t *testing.T) {
	h := PathSlashes(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("next handler must NOT be called for double-slash paths")
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RequestURI = "//engine/api/v1/environments?project=teste&limit=10"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusPermanentRedirect {
		t.Errorf("want 308, got %d", w.Code)
	}
	if got := w.Header().Get("Location"); got != "/engine/api/v1/environments?project=teste&limit=10" {
		t.Errorf("query string must survive normalization, got %q", got)
	}
}

func TestPathSlashes_CanonicalSinglePath_PassesThrough_RedTeam86(t *testing.T) {
	called := false
	h := PathSlashes(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RequestURI = "/engine/api/v1/projects"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("canonical path must pass through, got %d", w.Code)
	}
	if !called {
		t.Error("next handler must be called for canonical paths")
	}
}

func TestPathSlashes_RootPath_PassesThrough_RedTeam86(t *testing.T) {
	h := PathSlashes(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RequestURI = "/"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("single-slash root MUST pass through, got %d", w.Code)
	}
}

func TestPathSlashes_POSTPreservesMethodVia308_RedTeam86(t *testing.T) {
	// 308 (not 301/302) is mandatory so a POST/PUT probe retries the
	// canonical path with the same body and method per RFC 7538.
	h := PathSlashes(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("next handler must NOT be called for double-slash paths")
	}))
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RequestURI = "//engine/api/v1/projects/teste/scale"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusPermanentRedirect {
		t.Errorf("POST must use 308 (not 301/302) so method+body survive, got %d", w.Code)
	}
}
