// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package sandboxgateway_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/getloopscale/loop-console/internal/sandboxgateway"
)

func TestMountPutsEachPathBehindItsGate(t *testing.T) {
	gate := func(name string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Gate", name)
				next.ServeHTTP(w, r)
			})
		}
	}
	r := chi.NewRouter()
	sandboxgateway.Mount(r, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), gate("key or login"), gate("login"))

	for path, want := range map[string]string{
		"/v1/sandboxes":             "key or login",
		"/v1/sandboxes/sbx_1/files": "key or login",
		"/v1/capabilities":          "key or login",
		"/v1/templates":             "key or login",
		"/v1/templates/tpl_1":       "key or login",
		// A secret outlives the sandbox that reads it, so a key that only runs
		// sandboxes does not write one.
		"/v1/secrets":       "login",
		"/v1/secrets/TOKEN": "login",
	} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNoContent || rec.Header().Get("X-Gate") != want {
			t.Errorf("%s answered %d behind the gate %q, want 204 behind %q", path, rec.Code, rec.Header().Get("X-Gate"), want)
		}
	}

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/api-keys", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("/v1/api-keys answered %d: the sandbox's own keys are not forwarded", rec.Code)
	}
}
