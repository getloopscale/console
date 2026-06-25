//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// platform-api-gateway edge unification (M8 slice-3a) T4.1 — per-route-class proof
// that the SINGLE Traefik edge (:8090) routes every concern correctly: the dashboard
// SPA (history-API fallback), the Ory Kratos auth flows (single-origin cookie — R2),
// and the cloud-API BFF. The /v1/memory capability isolation is proven by the M6
// TestEdgeForwardAuthTenantIsolationE2E through this SAME edge (unchanged).
//
// Reuses the package harness (env from tenant_isolation_e2e_test.go). Each test
// SKIPS (not fails) when the unified stack is not reachable (EC-7), so the suite is
// safe to run without the compose up. Run via `make e2e` (with the traefik+dashboard
// services up) or:
//
//	E2E_EDGE_URL=http://localhost:8090 go test -tags=e2e ./tests/e2e/ -run TestEdge_
package e2e

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// edgeClient is a no-redirect-follow client with a short timeout so an unreachable
// edge SKIPs fast instead of hanging the suite.
func edgeClient() *http.Client {
	return &http.Client{
		Timeout: 3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse // observe Set-Cookie / 3xx without following
		},
	}
}

// skipUnlessEdgeUp probes the edge and SKIPs the test when it is not reachable.
func skipUnlessEdgeUp(t *testing.T, edge string) {
	t.Helper()
	c := &http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(edge + "/health")
	if err != nil {
		t.Skipf("unified edge %s not reachable — skipping (bring up the stack: docker compose up -d traefik dashboard)", edge)
	}
	_ = resp.Body.Close()
}

func TestEdge_BffRouter_ReachesBff(t *testing.T) {
	edge := env(t, "E2E_EDGE_URL", "http://localhost:8090")
	skipUnlessEdgeUp(t, edge)

	resp, err := edgeClient().Get(edge + "/health")
	if err != nil {
		t.Fatalf("GET %s/health: %v", edge, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("BFF /health through the edge: want 200, got %d (bff router must reach theo-cloud:13002)", resp.StatusCode)
	}
}

func TestEdge_SpaFallback_DeepLinkReturnsIndexHtml(t *testing.T) {
	edge := env(t, "E2E_EDGE_URL", "http://localhost:8090")
	skipUnlessEdgeUp(t, edge)

	// A client-side route that does NOT exist as a static file must fall back to the
	// SPA shell (index.html), not 404 — the history-API fallback (nginx try_files).
	resp, err := edgeClient().Get(edge + "/some/spa/deep/link")
	if err != nil {
		t.Fatalf("GET deep link: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("SPA deep-link fallback: want 200, got %d (catch-all must serve index.html)", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/html") {
		t.Errorf("SPA deep-link Content-Type: want text/html*, got %q", ct)
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if !strings.Contains(strings.ToLower(string(body)), "<!doctype html") && !strings.Contains(strings.ToLower(string(body)), "<html") {
		t.Errorf("SPA deep-link body is not the HTML shell (first bytes): %.120q", string(body))
	}
}

func TestEdge_KratosRouter_ReachesKratos_SingleOrigin(t *testing.T) {
	edge := env(t, "E2E_EDGE_URL", "http://localhost:8090")
	skipUnlessEdgeUp(t, edge)

	// The kratos browser login-flow init reaches Kratos through the edge. R2/EC-4:
	// any Set-Cookie returned MUST be single-origin safe — no `Domain=` attribute that
	// diverges from the edge origin (a Domain mismatch breaks the session cookie).
	resp, err := edgeClient().Get(edge + "/self-service/login/browser")
	if err != nil {
		t.Fatalf("GET kratos login/browser: %v", err)
	}
	defer resp.Body.Close()
	// Kratos answers a browser init with 200 (JSON flow) or a 3xx to the UI — either
	// proves the kratos router reached Kratos (a 404 would mean the SPA catch-all ate it).
	if resp.StatusCode == http.StatusNotFound {
		t.Fatalf("kratos route returned 404 — the SPA catch-all swallowed /self-service (router precedence broken)")
	}
	for _, c := range resp.Cookies() {
		if c.Domain != "" && !strings.Contains(edge, c.Domain) {
			t.Errorf("R2 single-origin violation: kratos Set-Cookie %q has Domain=%q diverging from edge %q", c.Name, c.Domain, edge)
		}
	}
}
