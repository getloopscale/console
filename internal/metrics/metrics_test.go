// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestIncTokenExchange(t *testing.T) {
	// Should not panic
	IncTokenExchange(true)
	IncTokenExchange(false)
}

func TestIncDeviceFlow(t *testing.T) {
	IncDeviceFlow(true)
	IncDeviceFlow(false)
}

func TestObserveTenantProvisioning(t *testing.T) {
	ObserveTenantProvisioning(true, 150*time.Millisecond)
	ObserveTenantProvisioning(false, 3*time.Second)
}

func TestIncAuthRejection(t *testing.T) {
	IncAuthRejection("expired")
	IncAuthRejection("invalid")
	IncAuthRejection("no_tenant")
	IncAuthRejection("unknown_reason") // should not panic
}

func TestIncWebhook(t *testing.T) {
	IncWebhook(true)
	IncWebhook(false)
}

func TestIncCheckout(t *testing.T) {
	IncCheckout(true)
	IncCheckout(false)
}

func TestIncUsageDrift(t *testing.T) {
	IncUsageDrift()
}

func TestIncSubscriptionFallback(t *testing.T) {
	IncSubscriptionFallback()
}

func TestObserveHTTPRequest(t *testing.T) {
	ObserveHTTPRequest("GET", "/health", "200", 5*time.Millisecond)
	ObserveHTTPRequest("POST", "/v1/auth/device/authorize", "200", 120*time.Millisecond)
}

func TestHandler_ReturnsPrometheusFormat(t *testing.T) {
	// Fire some metrics so there is output
	IncTokenExchange(true)
	IncWebhook(true)

	h := Handler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	body := rec.Body.String()

	// Prometheus exposition format contains HELP and TYPE lines
	if !strings.Contains(body, "loopscale_auth_token_exchanges_total") {
		t.Error("missing loopscale_auth_token_exchanges_total in /metrics output")
	}
	if !strings.Contains(body, "loopscale_webhook_events_total") {
		t.Error("missing loopscale_webhook_events_total in /metrics output")
	}
	if !strings.Contains(body, "loop_console_http_request_duration_seconds") {
		t.Error("missing loop_console_http_request_duration_seconds in /metrics output")
	}
	if !strings.Contains(body, "loopscale_tenant_provisioning_duration_seconds") {
		t.Error("missing loopscale_tenant_provisioning_duration_seconds in /metrics output")
	}
}

func TestIncServiceVersionProbe_increments_labelled_series(t *testing.T) {
	before := ServiceVersionProbeValue("looprag", "ok")

	IncServiceVersionProbe("looprag", "ok")
	IncServiceVersionProbe("looprag", "ok")
	IncServiceVersionProbe("looptrace", "timeout")

	if got := ServiceVersionProbeValue("looprag", "ok") - before; got != 2 {
		t.Fatalf("looprag/ok delta = %v, want 2", got)
	}
	if got := ServiceVersionProbeValue("looptrace", "timeout"); got < 1 {
		t.Fatalf("looptrace/timeout = %v, want >= 1", got)
	}
}

func TestIncServiceVersionProbe_does_not_cross_contaminate_labels(t *testing.T) {
	IncServiceVersionProbe("loopstore", "not_deployed")

	if got := ServiceVersionProbeValue("loopstore", "unreachable"); got != 0 {
		t.Fatalf("loopstore/unreachable = %v, want 0 — labels cross-contaminated", got)
	}
}

// The gateway serves requests in parallel, so this counter is written by N request
// goroutines at once. CounterVec promises safety; a contract that is never
// exercised is an assumption, so this exercises it.
func TestIncServiceVersionProbe_is_safe_under_concurrent_requests(t *testing.T) {
	const goroutines, perGoroutine = 8, 100
	before := ServiceVersionProbeValue("loopmem", "ok")

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				IncServiceVersionProbe("loopmem", "ok")
			}
		}()
	}
	wg.Wait()

	if got := ServiceVersionProbeValue("loopmem", "ok") - before; got != goroutines*perGoroutine {
		t.Fatalf("delta = %v, want %d — increment lost under concurrency", got, goroutines*perGoroutine)
	}
	if got := ServiceVersionProbeValue("loopmem", "timeout"); got != 0 {
		t.Fatalf("neighbouring series = %v, want 0 — labels contaminated under concurrency", got)
	}
}
