// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// platform-api-gateway-edge-slice1 (M6) T1.1/T1.2 — config-shape gates for the
// Traefik dev edge. These assert the load-bearing structure of the static +
// dynamic config (ForwardAuth wiring, capability-namespace rewrite, themory-direct
// upstream per ADR D7, and tracing-OFF per D4) so the config cannot silently drift
// away from the code contract. The end-to-end behavior is proven by the e2e (T2.1).

package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/routes"
)

func readConfig(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "dev", "traefik", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(b)
}

func mustContain(t *testing.T, haystack, needle, why string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("config missing %q (%s)", needle, why)
	}
}

func TestTraefikDynamicConfig_HasForwardAuthOnMemoryRoute(t *testing.T) {
	cfg := readConfig(t, "dynamic.yml")

	mustContain(t, cfg, "PathPrefix(`/v1/memory`)", "router fronts the /v1/memory capability namespace")
	mustContain(t, cfg, "forwardAuth", "authZ is delegated to the theo-cloud ForwardAuth endpoint")
	// The ForwardAuth address MUST point at the exact internal path the code
	// registers — guards against drift between routes.AuthzForwardPath and the config.
	mustContain(t, cfg, "http://theo-cloud:13002"+routes.AuthzForwardPath,
		"forwardAuth.address matches routes.AuthzForwardPath")
	mustContain(t, cfg, "authResponseHeaders", "the minted Authorization is copied upstream (Del-then-set = D3 strip)")
	mustContain(t, cfg, `"Authorization"`, "authResponseHeaders lists Authorization")
}

func TestTraefikDynamicConfig_RewritesNamespaceToThemoryDirect(t *testing.T) {
	cfg := readConfig(t, "dynamic.yml")

	mustContain(t, cfg, "replacePathRegex", "capability namespace is rewritten to themory's native path")
	mustContain(t, cfg, "^/v1/memory/(.*)", "rewrite source is the /v1/memory namespace")
	mustContain(t, cfg, "/v1/$1", "rewrite target is themory's /v1/* path")
	// ADR D7: the data upstream is theo-memory DIRECTLY, never theo-cloud's BFF.
	mustContain(t, cfg, "http://themory:8080", "upstream is theo-memory REST direct (ADR D7)")
	if strings.Contains(cfg, "url: \"http://theo-cloud:13002\"") {
		t.Error("D7 violation: the data upstream must NOT be theo-cloud's BFF (double-auth)")
	}
}

func TestTraefikStaticConfig_TracingDisabled(t *testing.T) {
	// D4: a `tracing:` block would capture the minted Authorization into spans.
	cfg := readConfig(t, "traefik.yml")
	for _, line := range strings.Split(cfg, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue // comments (incl. the D4 rationale) are allowed to mention tracing
		}
		if strings.HasPrefix(trimmed, "tracing:") {
			t.Errorf("D4 violation: tracing must be OFF in the dev edge (found %q)", trimmed)
		}
	}
}
