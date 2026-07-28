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

func TestDashboardServiceBuildsFromSource(t *testing.T) {
	// dashboard-manualchunks-tdz-fix T2.1 (ADR D3): the edge dashboard must build the
	// SPA bundle FROM SOURCE (reproducible) rather than mount the gitignored
	// ./dashboard/dist (stale, not built by the dev flow). And the build context must
	// exclude host node_modules (EC-1) so the image build is reproducible.
	compose, err := os.ReadFile(filepath.Join("..", "..", "docker-compose.dev.yaml"))
	if err != nil {
		t.Fatalf("read docker-compose.dev.yaml: %v", err)
	}
	mustContain(t, string(compose), "dev/dashboard.Dockerfile",
		"dashboard service builds from source via the multi-stage Dockerfile")
	if strings.Contains(string(compose), "./dashboard/dist:/usr/share/nginx/html") {
		t.Error("dashboard must NOT mount the gitignored ./dashboard/dist — it builds from source (T2.1)")
	}
	di, err := os.ReadFile(filepath.Join("..", "..", ".dockerignore"))
	if err != nil {
		t.Fatalf("read .dockerignore: %v", err)
	}
	mustContain(t, string(di), "node_modules",
		".dockerignore excludes node_modules from the build context (EC-1)")
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

// routerBlock returns the YAML lines belonging to a named router block (from its
// 4-space header until the next router header at the same indent).
func routerBlock(cfg, router string) string {
	in := false
	var b strings.Builder
	for _, ln := range strings.Split(cfg, "\n") {
		if routerHeaderRe.MatchString(ln) {
			if in {
				break // reached the next router
			}
			if strings.TrimSpace(ln) == router+":" {
				in = true
				continue
			}
		}
		if in {
			b.WriteString(ln)
			b.WriteString("\n")
		}
	}
	return b.String()
}

func TestTraefikDynamicConfig_GatewaySubpathsReachBffNotThemory(t *testing.T) {
	// theo-workspace#7: theo-cloud's customer-facing /v1/memory/{skills,exports,webhooks}
	// mount (RequireScope on theo_live_*) was shadowed by memory-edge (priority 100),
	// which rewrites /v1/memory/* to themory's native path → 404 for these gateway-owned
	// routes. A dedicated higher-priority router must front them to the BFF, with:
	//   - NO memory-rewrite (theo-cloud owns the /v1/memory/* path verbatim), and
	//   - NO forward-auth (the customer theo_live_* must reach RequireScope intact;
	//     forward-auth swaps it for a themory-minted key pg-cloud cannot resolve → 401).
	cfg := readConfig(t, "dynamic.yml")

	for _, p := range []string{"/v1/memory/skills", "/v1/memory/exports", "/v1/memory/webhooks"} {
		mustContain(t, cfg, "PathPrefix(`"+p+"`)", "gateway-edge router fronts "+p)
	}
	gw := routerPriority(t, cfg, "memory-gateway-edge")
	mem := routerPriority(t, cfg, "memory-edge")
	if gw <= mem {
		t.Errorf("memory-gateway-edge(%d) must out-rank memory-edge(%d) so the gateway paths are not shadowed → themory 404", gw, mem)
	}
	block := routerBlock(cfg, "memory-gateway-edge")
	if !strings.Contains(block, "theo-cloud-bff") {
		t.Error("memory-gateway-edge must route to theo-cloud-bff (the gateway owns these paths)")
	}
	if strings.Contains(block, "memory-rewrite") {
		t.Error("memory-gateway-edge must NOT apply memory-rewrite — theo-cloud owns /v1/memory/* verbatim")
	}
	if strings.Contains(block, "forward-auth") {
		t.Error("memory-gateway-edge must NOT apply forward-auth — the customer theo_live_* key must reach RequireScope intact")
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
	kratos := routerPriority(t, cfg, "kratos")
	spa := routerPriority(t, cfg, "dashboard-spa")
	if mem <= bff || bff <= spa {
		t.Errorf("precedence must be memory(%d) > bff(%d) > spa(%d) — capability must beat the catch-alls", mem, bff, spa)
	}
	// ADR D3 defense-in-depth covers ALL routers: kratos must also beat the SPA
	// catch-all by an EXPLICIT priority (not rule-length), so a future rule edit
	// cannot silently let the catch-all swallow the auth flows (ARCH-03/CV-04).
	if kratos <= spa {
		t.Errorf("kratos(%d) must out-rank the SPA catch-all spa(%d) by explicit priority", kratos, spa)
	}
	if spa == 0 || kratos == 0 {
		t.Errorf("dashboard-spa(%d) and kratos(%d) must carry explicit priorities, not rely on default", spa, kratos)
	}
}

func TestNoCaddyReferencesRemain(t *testing.T) {
	// M8 slice-3a (EC-3): Traefik is the single edge — the Caddyfile is retired and no
	// FUNCTIONAL caddy reference (a compose service/image, a run invocation in dev/)
	// survives. Explanatory comments noting the retirement ARE allowed (they document
	// history); the scan only flags non-comment lines.
	root := filepath.Join("..", "..")
	if _, err := os.Stat(filepath.Join(root, "dev", "caddy", "Caddyfile")); !os.IsNotExist(err) {
		t.Errorf("dev/caddy/Caddyfile must be deleted (Traefik is the single edge); stat err=%v", err)
	}
	scan := func(path string) {
		b, err := os.ReadFile(path)
		if err != nil {
			return
		}
		for i, ln := range strings.Split(string(b), "\n") {
			tr := strings.TrimSpace(ln)
			if tr == "" || strings.HasPrefix(tr, "#") {
				continue
			}
			if strings.Contains(strings.ToLower(tr), "caddy") {
				t.Errorf("functional caddy reference at %s:%d: %q (Traefik is the single edge)", path, i+1, tr)
			}
		}
	}
	scan(filepath.Join(root, "docker-compose.dev.yaml"))
	_ = filepath.WalkDir(filepath.Join(root, "dev"), func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		scan(p)
		return nil
	})
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
	// Comment lines (which describe the prod overlay) are allowed to mention it.
	cfg := readConfig(t, "dynamic.yml")
	for _, ln := range strings.Split(cfg, "\n") {
		trimmed := strings.TrimSpace(ln)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(trimmed, "serversTransport: internal-tls") {
			t.Error("dev must NOT reference internal-tls (would force mTLS to run the stack); the prod overlay wires it")
		}
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
