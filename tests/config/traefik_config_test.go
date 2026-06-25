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
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/routes"
)

// routerHeaderRe matches a router key at the 4-space indent under `http.routers:`
// (e.g. "    memory-edge:"). Used to scope a priority lookup to one router block.
var routerHeaderRe = regexp.MustCompile(`^    [a-z][a-z0-9-]*:\s*$`)

// routerPriority returns the explicit numeric `priority:` of a named router, or 0
// if absent. It resets at every router header so it only reads the priority that
// belongs to the target router's block (no bleed into the next router).
func routerPriority(t *testing.T, cfg, router string) int {
	t.Helper()
	in := false
	for _, ln := range strings.Split(cfg, "\n") {
		if routerHeaderRe.MatchString(ln) {
			in = strings.TrimSpace(ln) == router+":"
			continue
		}
		if in && strings.HasPrefix(strings.TrimSpace(ln), "priority:") {
			raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(ln), "priority:"))
			n, err := strconv.Atoi(raw)
			if err != nil {
				t.Fatalf("router %s: bad priority %q: %v", router, raw, err)
			}
			return n
		}
	}
	return 0
}

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
	// ADR D7: the CAPABILITY data upstream is theo-memory DIRECTLY, never the BFF.
	// (slice-3a: the BFF url http://theo-cloud:13002 now legitimately appears as the
	// `bff` router's own upstream for /v1/* non-capability traffic — D7 is about the
	// /v1/memory capability route, not a blanket ban on the BFF url.)
	mustContain(t, cfg, "http://themory:8080", "capability upstream is theo-memory REST direct (ADR D7)")
	if memoryRouteTargetsBff(cfg) {
		t.Error("D7 violation: the /v1/memory capability must route to themory, NOT theo-cloud's BFF (double-auth)")
	}
}

// memoryRouteTargetsBff reports whether the memory-edge router's `service:` is the
// BFF (a D7 violation). It scopes the lookup to the memory-edge router block.
func memoryRouteTargetsBff(cfg string) bool {
	in := false
	for _, ln := range strings.Split(cfg, "\n") {
		if routerHeaderRe.MatchString(ln) {
			in = strings.TrimSpace(ln) == "memory-edge:"
			continue
		}
		if in && strings.HasPrefix(strings.TrimSpace(ln), "service:") {
			svc := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(ln), "service:"))
			return svc == "theo-cloud-bff" || svc == "bff"
		}
	}
	return false
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

// --- M8 slice-3a: unified-edge routers ---

func TestTraefikDynamicConfig_HasKratosRouter(t *testing.T) {
	cfg := readConfig(t, "dynamic.yml")
	mustContain(t, cfg, "PathPrefix(`/self-service`)", "kratos router fronts the self-service auth flows")
	mustContain(t, cfg, "http://kratos:4433", "kratos upstream is the Ory Kratos public API")
}

func TestTraefikDynamicConfig_HasBffRouter(t *testing.T) {
	cfg := readConfig(t, "dynamic.yml")
	mustContain(t, cfg, "PathPrefix(`/v1`)", "bff router fronts the cloud-API /v1 surface")
	mustContain(t, cfg, "PathPrefix(`/engine`)", "bff router fronts the /engine proxy")
	mustContain(t, cfg, "http://theo-cloud:13002", "bff upstream is the theo-cloud cloud-API")
}

func TestTraefikDynamicConfig_HasSpaCatchAll(t *testing.T) {
	cfg := readConfig(t, "dynamic.yml")
	mustContain(t, cfg, "PathPrefix(`/`)", "SPA catch-all router fronts the dashboard")
	mustContain(t, cfg, "http://dashboard", "SPA catch-all upstream is the nginx dashboard static service")
}

func TestTraefikDynamicConfig_CapabilityRoutePrecedence(t *testing.T) {
	// ADR D3: rule-length already makes /v1/memory beat /v1, but explicit priority is
	// defense-in-depth. memory > bff > spa must hold so a capability never falls into
	// the BFF or the SPA catch-all.
	cfg := readConfig(t, "dynamic.yml")
	mem := routerPriority(t, cfg, "memory-edge")
	bff := routerPriority(t, cfg, "bff")
	spa := routerPriority(t, cfg, "dashboard-spa")
	if !(mem > bff && bff > spa) {
		t.Errorf("precedence must be memory(%d) > bff(%d) > spa(%d) — capability must beat the catch-alls", mem, bff, spa)
	}
	if spa == 0 {
		t.Error("dashboard-spa must carry an explicit priority (the lowest), not rely on default")
	}
}

func TestTraefikDynamicConfig_HasInternalTlsServersTransport(t *testing.T) {
	// ADR D4: define the TLS-to-backend transport for the authz hop so prod can flip
	// the BFF/authz service to https:// without a missing-config error.
	cfg := readConfig(t, "dynamic.yml")
	mustContain(t, cfg, "serversTransports:", "TLS-to-backend scaffold exists (ADR D4)")
	mustContain(t, cfg, "internal-tls", "the internal-tls serversTransport is defined")
	mustContain(t, cfg, "serverName:", "internal-tls verifies the backend cert name (SNI)")
	mustContain(t, cfg, "rootCAs:", "internal-tls trusts the platform CA")
}

func TestTraefikDynamicConfig_InternalTlsUnreferencedInDev(t *testing.T) {
	// ADR D4 (R3): the transport is DEFINED but NOT wired in dev — every service stays
	// http:// so `up` stays one command. The prod overlay flips the authz hop to https.
	cfg := readConfig(t, "dynamic.yml")
	if strings.Contains(cfg, "serversTransport: internal-tls") {
		t.Error("dev must NOT reference internal-tls (would force mTLS to run the stack); the prod overlay wires it")
	}
}

func TestDashboardNginxConf_HasSpaFallback(t *testing.T) {
	// ADR D2: the dashboard SPA is served by nginx (Traefik has no file server).
	// The history-API fallback (Caddy's `try_files {path} /index.html`) must live
	// in nginx.conf so deep links resolve to the SPA shell.
	b, err := os.ReadFile(filepath.Join("..", "..", "dev", "dashboard", "nginx.conf"))
	if err != nil {
		t.Fatalf("read dev/dashboard/nginx.conf: %v", err)
	}
	mustContain(t, string(b), "try_files $uri $uri/ /index.html", "SPA history-API fallback to index.html")
}

func TestTraefikDynamicConfig_MemoryPrefixBoundary(t *testing.T) {
	// EC-2: PathPrefix(`/v1/memory`) also matches /v1/memoryfoo, but the rewrite regex
	// only fires with a trailing slash. Pin the accepted M6-carryover behavior so it
	// cannot silently change: the rule is the bare prefix and the rewrite is slash-gated.
	cfg := readConfig(t, "dynamic.yml")
	mustContain(t, cfg, "PathPrefix(`/v1/memory`)", "memory route uses the bare-prefix rule (M6 carryover)")
	mustContain(t, cfg, "^/v1/memory/(.*)", "rewrite is slash-gated: /v1/memoryfoo is forwarded unrewritten (themory 404s — harmless)")
}
