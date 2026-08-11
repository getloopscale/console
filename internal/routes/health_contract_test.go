// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// The ecosystem-canonical operational names on the cloud API (B-124, contract rule D5).
//
// # The service was inconsistent with itself
//
// `/v1/version` is versioned. `/health` and `/ready` are not. All three are unauthenticated, all
// three are consumed by infrastructure, and they are registered within fifty lines of each other.
// That split is two decisions made at different times, not a considered boundary.
//
// Measured across nine services for the HTTP surface contract (B-115): nine different combinations
// of health paths. The contract's names are `/v1/health` and `/v1/health/ready`.
//
// # Why this repo is last of the nine
//
// theo-cloud is a BFF: it mirrors the names its upstreams choose, so conforming it before them
// would have meant mirroring names that were about to change. The eight upstream items landed
// first for that reason.
//
// # What is asserted here
//
// That both spellings answer, from the SAME handlers, and that liveness keeps the property its own
// file argues for: it never fails over a dependency, because a database blip failing liveness gets
// a recoverable process restarted under an orchestrator that restarts on health.

type failingPinger struct{}

func (failingPinger) PingContext(context.Context) error { return errDependencyDown }

type okPinger struct{}

func (okPinger) PingContext(context.Context) error { return nil }

var errDependencyDown = &dependencyDownError{}

type dependencyDownError struct{}

func (*dependencyDownError) Error() string { return "database unreachable" }

func noIntegrations() map[string][]string { return map[string][]string{} }

// router mounts both spellings the way `cmd/main.go` does, from the same two handlers.
func router(p Pinger) *chi.Mux {
	r := chi.NewRouter()
	liveness := NewHealthHandler(p, noIntegrations)
	readiness := NewReadyHandler(p, noIntegrations)

	r.Get("/health", liveness.ServeHTTP)
	r.Get("/ready", readiness.ServeHTTP)
	r.Get("/v1/health", liveness.ServeHTTP)
	r.Get("/v1/health/ready", readiness.ServeHTTP)
	return r
}

func get(t *testing.T, r *chi.Mux, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestHealthContract_BothSpellingsAnswer(t *testing.T) {
	r := router(okPinger{})

	for _, path := range []string{"/health", "/ready", "/v1/health", "/v1/health/ready"} {
		if code := get(t, r, path).Code; code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, code)
		}
	}
}

func TestHealthContract_CanonicalLivenessNeverFailsOverADependency(t *testing.T) {
	// The property `health.go` argues for in its own header, carried to the new name. Liveness
	// answering 503 over a database blip gets a recoverable process restarted, which loses
	// in-flight work and does not fix the database.
	r := router(failingPinger{})

	if code := get(t, r, "/v1/health").Code; code != http.StatusOK {
		t.Errorf("GET /v1/health = %d with a failing dependency, want 200", code)
	}
}

func TestHealthContract_CanonicalReadinessFailsOverADependency(t *testing.T) {
	// And the counterpart, which is the reason readiness exists as a separate question: it is what
	// tells a load balancer to drain instead of erroring.
	r := router(failingPinger{})

	if code := get(t, r, "/v1/health/ready").Code; code == http.StatusOK {
		t.Error("GET /v1/health/ready = 200 with a failing dependency; readiness must not pass")
	}
}

func TestHealthContract_BothSpellingsAnswerIdentically(t *testing.T) {
	// Same handlers, not copies. A second implementation drifts, and what drifts silently is the
	// degraded-detection — the half that keeps traffic off an instance that cannot serve.
	r := router(okPinger{})

	for _, pair := range [][2]string{{"/health", "/v1/health"}, {"/ready", "/v1/health/ready"}} {
		old, canonical := get(t, r, pair[0]), get(t, r, pair[1])
		if old.Code != canonical.Code || old.Body.String() != canonical.Body.String() {
			t.Errorf("%s and %s disagree:\n  %s → %d %s\n  %s → %d %s",
				pair[0], pair[1],
				pair[0], old.Code, old.Body.String(),
				pair[1], canonical.Code, canonical.Body.String())
		}
	}
}

func TestHealthContract_LivenessReportsAStatus(t *testing.T) {
	rec := get(t, router(okPinger{}), "/v1/health")

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("liveness body is not JSON: %v — %s", err, rec.Body.String())
	}
	if body["status"] == nil {
		t.Errorf("liveness body carries no status: %s", rec.Body.String())
	}
}
