//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// platform-api-gateway-edge-slice1 (M6) T2.1 — the headline proof for the edge
// slice: tenant isolation holds END-TO-END through the Traefik edge, where authZ
// is delegated to theo-cloud's ForwardAuth endpoint and the data path goes to
// theo-memory DIRECTLY (ADR D7). A consumer bound to tenant A cannot read tenant
// B's memory through the edge, because ForwardAuth mints a PER-TENANT theo_live_*
// (workspace = TenantID) that themory enforces isolation from — the client's own
// key never reaches themory (D3, Traefik authResponseHeaders Del-then-set).
//
// Reuses the package harness (seedAPIKey/remember/recall/env/mustDo from
// tenant_isolation_e2e_test.go) but points at the EDGE (:8090) instead of the
// gateway BFF (:13002). Requires the Model B dev stack + the traefik service
// (docker compose up -d traefik). Build-tagged `e2e`; run via `make e2e` or:
//
//	E2E_EDGE_URL=http://localhost:8090 E2E_PG_CLOUD_DSN=... go test -tags=e2e ./tests/e2e/ -run TestEdge
package e2e

import (
	"database/sql"
	"net/http"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestEdgeForwardAuthTenantIsolationE2E drives two customers in DIFFERENT tenants
// THROUGH THE EDGE and asserts cross-tenant reads are empty.
func TestEdgeForwardAuthTenantIsolationE2E(t *testing.T) {
	edgeURL := env(t, "E2E_EDGE_URL", "http://localhost:8090")
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping edge ForwardAuth e2e")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer db.Close()

	// Seed the FK chain: users(id) ← tenants(owner_id); tenants(id) ← theo_api_keys(tenant_id).
	seedUser(t, db, "edge-alice-uid", "edge-alice@e2e.test")
	seedUser(t, db, "edge-bob-uid", "edge-bob@e2e.test")
	seedTenant(t, db, "tn-edge-alice", "edge-alice-uid")
	seedTenant(t, db, "tn-edge-bob", "edge-bob-uid")
	bearerA := seedAPIKey(t, db, "edge-alice", "tn-edge-alice")
	bearerB := seedAPIKey(t, db, "edge-bob", "tn-edge-bob")

	const canary = "edge tenant isolation canary phrase m6"

	// Bob remembers THROUGH THE EDGE: :8090/v1/memory/remember → ForwardAuth mints
	// tn-edge-bob's key → rewrite → themory:8080/v1/remember (workspace tn-edge-bob).
	remember(t, edgeURL, bearerB, "edge-bob", canary)

	// Alice recalls the same text through the edge → MUST be empty (her minted key
	// is bound to workspace tn-edge-alice; themory never returns tn-edge-bob's rows).
	resA := recall(t, edgeURL, bearerA, "edge-alice", canary)
	if len(resA) != 0 {
		t.Fatalf("CROSS-TENANT LEAK THROUGH THE EDGE: tn-edge-alice recalled %d result(s) for tn-edge-bob's memory", len(resA))
	}

	// Bob recalls his own through the edge → sees it (the empty result above is
	// isolation, not a false negative — the edge path genuinely reaches the data).
	resB := recall(t, edgeURL, bearerB, "edge-bob", canary)
	if len(resB) == 0 {
		t.Fatalf("tn-edge-bob could not recall its OWN memory through the edge — ForwardAuth/mint/rewrite wiring broken")
	}
}

// seedUser inserts a minimal users row so tenants.owner_id FK resolves.
func seedUser(t *testing.T, db *sql.DB, userID, email string) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO users (id, email, username, display_name)
		VALUES ($1, $2, $1, $1)
		ON CONFLICT (id) DO NOTHING`,
		userID, email)
	if err != nil {
		t.Fatalf("seed user %s: %v", userID, err)
	}
}

// seedTenant inserts a minimal tenant row so theo_api_keys.tenant_id FK resolves.
func seedTenant(t *testing.T, db *sql.DB, tenantID, ownerID string) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO tenants (id, slug, owner_id, display_name)
		VALUES ($1, $1, $2, $1)
		ON CONFLICT (id) DO NOTHING`,
		tenantID, ownerID)
	if err != nil {
		t.Fatalf("seed tenant %s: %v", tenantID, err)
	}
}

// TestEdgeForwardAuth_NoKey_DeniedAtEdge proves the edge fails closed: a request
// with no valid theo_live_* is DENIED by ForwardAuth (401/403) and never reaches
// themory (Traefik makes no upstream call without an explicit ALLOW — EC-7).
func TestEdgeForwardAuth_NoKey_DeniedAtEdge(t *testing.T) {
	edgeURL := env(t, "E2E_EDGE_URL", "http://localhost:8090")

	req, _ := http.NewRequest(http.MethodPost, edgeURL+"/v1/memory/recall", nil)
	// No Authorization header at all.
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("edge must DENY an unauthenticated request at ForwardAuth, got %d", resp.StatusCode)
	}
	// The minted Authorization is never set on a deny, so themory is never called.
	if resp.Header.Get("Authorization") != "" {
		t.Fatal("a denied edge request must not carry an Authorization header")
	}
}
