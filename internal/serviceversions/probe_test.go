package serviceversions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// hungServer holds every request until the caller's context is cancelled — the
// exact shape the M21 fan-out must survive without head-of-line blocking.
func hungServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)
	return srv
}

func versionServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestProbe_happy_path_returns_ok_with_version(t *testing.T) {
	srv := versionServer(t, `{"version":"0.35.0","built_at":"2026-07-01T00:00:00Z"}`)

	got := probe(context.Background(), srv.Client(), Target{Name: "theo-rag", BaseURL: srv.URL}, time.Second, time.Now)

	if got.State() != StateOK {
		t.Fatalf("State() = %q, want ok", got.State())
	}
	m := marshalToMap(t, got)
	if m["version"] != "0.35.0" {
		t.Fatalf("version = %v, want 0.35.0", m["version"])
	}
	if m["built_at"] != "2026-07-01T00:00:00Z" {
		t.Fatalf("built_at = %v, want the target built_at", m["built_at"])
	}
}

func TestProbe_trailing_slash_base_url_still_resolves(t *testing.T) {
	var path atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path.Store(r.URL.Path)
		_, _ = w.Write([]byte(`{"version":"1.0.0"}`))
	}))
	defer srv.Close()

	got := probe(context.Background(), srv.Client(), Target{Name: "theo-lens", BaseURL: srv.URL + "/"}, time.Second, time.Now)

	if got.State() != StateOK {
		t.Fatalf("State() = %q, want ok", got.State())
	}
	if p, _ := path.Load().(string); p != "/v1/version" {
		t.Fatalf("requested path = %q, want /v1/version — a trailing slash produced a doubled separator", p)
	}
}

func TestProbe_empty_base_url_is_not_deployed_without_any_request(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	defer srv.Close()

	got := probe(context.Background(), srv.Client(), Target{Name: "theo-storage", BaseURL: ""}, time.Second, time.Now)

	if got.State() != StateNotDeployed {
		t.Fatalf("State() = %q, want not_deployed", got.State())
	}
	if n := atomic.LoadInt32(&hits); n != 0 {
		t.Fatalf("probe emitted %d requests for an unconfigured target, want 0", n)
	}
}

func TestProbe_refused_connection_is_unreachable(t *testing.T) {
	got := probe(context.Background(), http.DefaultClient, Target{Name: "theo-rag", BaseURL: "http://127.0.0.1:1"}, time.Second, time.Now)

	if got.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable", got.State())
	}
	m := marshalToMap(t, got)
	if m["reason"] != "connection refused" {
		t.Fatalf("reason = %v, want the closed-set connection refused", m["reason"])
	}
}

func TestProbe_hung_server_is_timeout_within_budget(t *testing.T) {
	srv := hungServer(t)

	start := time.Now()
	got := probe(context.Background(), srv.Client(), Target{Name: "theo-rag", BaseURL: srv.URL}, 100*time.Millisecond, time.Now)
	elapsed := time.Since(start)

	if got.State() != StateTimeout {
		t.Fatalf("State() = %q, want timeout", got.State())
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("probe took %v, want ~perService (100ms) — the per-service budget did not bite", elapsed)
	}
	m := marshalToMap(t, got)
	if _, present := m["version"]; present {
		t.Fatalf("timeout payload leaked a version key: %v", m)
	}
}

func TestProbe_non_200_is_unreachable_with_http_reason(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	got := probe(context.Background(), srv.Client(), Target{Name: "theo-memory", BaseURL: srv.URL}, time.Second, time.Now)

	if got.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable", got.State())
	}
	m := marshalToMap(t, got)
	if m["reason"] != "http 503" {
		t.Fatalf("reason = %v, want http 503", m["reason"])
	}
}

func TestProbe_malformed_body_is_unreachable(t *testing.T) {
	srv := versionServer(t, `this is not json`)

	got := probe(context.Background(), srv.Client(), Target{Name: "theo-lens", BaseURL: srv.URL}, time.Second, time.Now)

	if got.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable", got.State())
	}
	m := marshalToMap(t, got)
	if m["reason"] != "malformed payload" {
		t.Fatalf("reason = %v, want malformed payload", m["reason"])
	}
}

// R5: transport errors in Go carry host and port ("dial tcp 172.18.0.4:8787:
// connect: connection refused") and this JSON is served to the browser.
func TestProbe_reason_never_leaks_base_url(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	host := srv.URL
	srv.Close() // now refuses, so the transport error carries host:port

	for _, tc := range []struct {
		name   string
		target Target
	}{
		{"refused", Target{Name: "theo-rag", BaseURL: host}},
		{"dns", Target{Name: "theo-rag", BaseURL: "http://no-such-host.invalid"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := probe(context.Background(), http.DefaultClient, tc.target, 2*time.Second, time.Now)

			b, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			hostPort := strings.TrimPrefix(tc.target.BaseURL, "http://")
			if strings.Contains(string(b), hostPort) {
				t.Fatalf("payload leaked internal topology %q: %s", hostPort, b)
			}
		})
	}
}

// D10 / EC-2: client.Do under a parent-cancelled context returns context.Canceled,
// NOT DeadlineExceeded. Without the ctx.Err() guard this classifies as unreachable —
// marking a healthy service as down every time a browser tab is closed.
func TestProbe_client_cancellation_is_timeout_not_unreachable(t *testing.T) {
	srv := hungServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()

	start := time.Now()
	got := probe(ctx, srv.Client(), Target{Name: "theo-lens", BaseURL: srv.URL}, 5*time.Second, time.Now)

	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("took %v after parent cancel — the derived context did not propagate", elapsed)
	}
	if got.State() != StateTimeout {
		t.Fatalf("State() = %q after caller cancellation, want timeout — a healthy target must never be reported unreachable because the browser gave up (D10)", got.State())
	}
}
