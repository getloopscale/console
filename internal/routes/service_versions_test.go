// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/getloopscale/loop-console/internal/serviceversions"
)

// fakeCollector stands in for the real fan-out so the handler contract is tested
// without a network — the point of declaring VersionCollector on the consumer side.
type fakeCollector struct {
	rep  serviceversions.Report
	seen chan context.Context
}

func (f *fakeCollector) Collect(ctx context.Context) serviceversions.Report {
	if f.seen != nil {
		f.seen <- ctx
	}
	return f.rep
}

func fourVariantReport(at time.Time) serviceversions.Report {
	return serviceversions.Report{
		CollectedAt: at,
		Services: []serviceversions.ServiceStatus{
			serviceversions.OK("looprag", "0.35.0", "2026-07-01T00:00:00Z", at),
			serviceversions.Unreachable("looptrace", "connection refused", at),
			serviceversions.Timeout("loopmem", at),
			serviceversions.NotDeployed("loopstore", at),
		},
	}
}

func TestServiceVersions_Get_returns_collector_report(t *testing.T) {
	at := time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)
	h := NewServiceVersionsHandler(&fakeCollector{rep: fourVariantReport(at)}, slog.Default())

	w := httptest.NewRecorder()
	h.Get(w, httptest.NewRequest(http.MethodGet, "/v1/dashboard/status/versions", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var body struct {
		CollectedAt string           `json:"collected_at"`
		Services    []map[string]any `json:"services"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.CollectedAt == "" {
		t.Fatal("collected_at missing — DoD bullet 5 requires the collection instant")
	}
	if len(body.Services) != 4 {
		t.Fatalf("len(services) = %d, want 4 (loopstore must be present as not_deployed, not omitted)", len(body.Services))
	}
	if body.Services[3]["state"] != "not_deployed" {
		t.Fatalf("loopstore state = %v, want not_deployed", body.Services[3]["state"])
	}
}

func TestServiceVersions_Get_failure_variants_have_no_version_key(t *testing.T) {
	at := time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)
	h := NewServiceVersionsHandler(&fakeCollector{rep: fourVariantReport(at)}, slog.Default())

	w := httptest.NewRecorder()
	h.Get(w, httptest.NewRequest(http.MethodGet, "/v1/dashboard/status/versions", nil))

	var body struct {
		Services []map[string]any `json:"services"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, s := range body.Services {
		if s["state"] == "ok" {
			continue
		}
		if _, present := s["version"]; present {
			t.Fatalf("service %v in state %v leaked a version key over the HTTP boundary", s["name"], s["state"])
		}
	}
}

// The browser giving up must reach the probes (D1): the collector has to receive
// the request's own context, not a detached one.
func TestServiceVersions_Get_passes_request_context_to_collector(t *testing.T) {
	fake := &fakeCollector{seen: make(chan context.Context, 1)}
	h := NewServiceVersionsHandler(fake, slog.Default())

	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/status/versions", nil)
	ctx, cancel := context.WithCancel(req.Context())
	h.Get(httptest.NewRecorder(), req.WithContext(ctx))

	got := <-fake.seen
	cancel()
	if got.Err() == nil {
		t.Fatal("the context the collector saw was not cancelled — the browser giving up never reaches the probes (D1)")
	}
}

func TestMountServiceVersions_route_is_behind_requireJWT(t *testing.T) {
	var guarded int32
	spy := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&guarded, 1)
			next.ServeHTTP(w, r)
		})
	}
	r := chi.NewRouter()
	MountServiceVersions(r, NewServiceVersionsHandler(&fakeCollector{}, slog.Default()), spy)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/dashboard/status/versions", nil))

	if n := atomic.LoadInt32(&guarded); n != 1 {
		t.Fatalf("requireJWT ran %d times, want exactly 1 — the BFF route is unguarded", n)
	}
}

func TestMountServiceVersions_path_is_v1_dashboard_status_versions(t *testing.T) {
	noopJWT := func(next http.Handler) http.Handler { return next }
	r := chi.NewRouter()
	MountServiceVersions(r, NewServiceVersionsHandler(&fakeCollector{}, slog.Default()), noopJWT)

	for path, want := range map[string]int{
		"/v1/dashboard/status/versions": http.StatusOK,
		"/v1/dashboard/status":          http.StatusNotFound,
		"/v1/dashboard/versions":        http.StatusNotFound,
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != want {
			t.Fatalf("GET %s = %d, want %d", path, w.Code, want)
		}
	}
}

// failingWriter breaks mid-response, the one genuinely exceptional path: the status
// line is already on the wire, so there is no honest way to turn it into a 500.
type failingWriter struct{ header http.Header }

func (f *failingWriter) Header() http.Header {
	if f.header == nil {
		f.header = http.Header{}
	}
	return f.header
}
func (f *failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("connection closed by peer")
}
func (f *failingWriter) WriteHeader(int) {}

func TestServiceVersions_Get_encode_failure_is_logged_not_panicked(t *testing.T) {
	at := time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)
	h := NewServiceVersionsHandler(&fakeCollector{rep: fourVariantReport(at)}, slog.Default())

	// The assertion is that this returns at all: a broken client connection must
	// not take the handler down.
	h.Get(&failingWriter{}, httptest.NewRequest(http.MethodGet, "/v1/dashboard/status/versions", nil))
}
