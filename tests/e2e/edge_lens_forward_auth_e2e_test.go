//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M40 (KEYSTONE) — the non-negotiable proof of invariant #6 for the LENS capability:
// cross-tenant isolation + the per-verb scope wall + fail-closed hold END-TO-END through
// the REAL Traefik edge + REAL ForwardAuth (the M38 handler) + REAL broker + a REAL
// theo-lens container. Mirrors the rag edge e2e (edge_rag_forward_auth_e2e_test.go, M18)
// but uses datasets CRUD (no LLM — pure isolation) so the proof needs no OTLP/provider.
//
// The stack is hermetic (docker-compose.edge.e2e.yaml): container upstream http://lens:8080,
// consumer keys seeded in the CLOUD DB, per-tenant keys minted by the broker. theo-lens runs
// with THEOLENS_REQUIRE_CREDENTIAL=true (M13) so the direct-to-service no-key request 401s.
// Test names carry the TestEdgeForwardAuth prefix so `make e2e-edge` (-run TestEdgeForwardAuth)
// picks them up.
//
// Deltas vs the rag mirror: theo-lens POST /v1/datasets returns 200 (idempotent create-or-get),
// NOT rag's 201; the list shape is {"datasets":[{name}]}, NOT rag's {"items":[{name}]}.
package e2e

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// seedLensAPIKey inserts a customer theo_live_* key in the CLOUD DB scoped for lens
// (mirrors seedAPIKey but with lens scopes). Consumer key resolution is theo-cloud's job
// (capability-agnostic); only the scopes JSON differs from the memory/rag variants.
func seedLensAPIKey(t *testing.T, db *sql.DB, subject, tenant, scopesJSON string) string {
	t.Helper()
	accountID := ensureTenantAccount(t, db, tenant)
	bearer := "theo_live_" + subject + "_e2e_secret"
	sum := sha256.Sum256([]byte(bearer))
	keyHash := hex.EncodeToString(sum[:])
	id := "e2e-lens-" + keyHash[:16]
	_, err := db.Exec(`
		INSERT INTO theo_api_keys
			(id, subject, tenant_id, account_id, key_name, key_hash, key_prefix, scopes, expires_at, bff_minted, created_at)
		VALUES ($1,$2,$3,$4,'e2e-lens',$5,'theo_live_',$6::jsonb, NOW() + interval '1 hour', false, NOW())
		ON CONFLICT (key_hash) DO NOTHING`,
		id, subject, tenant, accountID, keyHash, scopesJSON)
	if err != nil {
		t.Fatalf("seed lens api key for %s: %v", subject, err)
	}
	return bearer
}

// lensCreateDataset POSTs a dataset to base (edge or direct); returns the status.
// theo-lens's create-or-get returns 200 (not 201).
func lensCreateDataset(t *testing.T, base, bearer, name string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name})
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/lens/datasets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode
}

// lensCreateDatasetDirect POSTs straight at the lens service (bypassing the edge/rewrite):
// theo-lens's native path is /v1/datasets (no /lens prefix).
func lensCreateDatasetDirect(t *testing.T, lensURL, bearer, name string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name})
	req, _ := http.NewRequest(http.MethodPost, lensURL+"/v1/datasets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode
}

// lensListDatasetNames GETs the caller workspace's datasets through the edge and returns
// their names (workspace-scoped by the minted per-tenant key). Shape: {"datasets":[{name}]}.
func lensListDatasetNames(t *testing.T, edgeURL, bearer string) []string {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, edgeURL+"/v1/lens/datasets", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list datasets: want 200, got %d (%s)", resp.StatusCode, readBody(resp))
	}
	var out struct {
		Datasets []struct {
			Name *string `json:"name"`
		} `json:"datasets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode datasets list: %v", err)
	}
	names := make([]string, 0, len(out.Datasets))
	for _, it := range out.Datasets {
		if it.Name != nil {
			names = append(names, *it.Name)
		}
	}
	return names
}

// TestEdgeForwardAuthLensTenantIsolationE2E is the headline invariant-#6 proof for lens:
// two tenants through the edge; A cannot see B's dataset; B sees its own.
func TestEdgeForwardAuthLensTenantIsolationE2E(t *testing.T) {
	edgeURL := requireE2EEdge(t)
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping edge lens ForwardAuth e2e")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer db.Close()

	seedUser(t, db, "lens-alice-uid", "lens-alice@e2e.test")
	seedUser(t, db, "lens-bob-uid", "lens-bob@e2e.test")
	seedTenant(t, db, "tn-lens-alice", "lens-alice-uid")
	seedTenant(t, db, "tn-lens-bob", "lens-bob-uid")
	bearerA := seedLensAPIKey(t, db, "lens-alice", "tn-lens-alice", `["lens:read","lens:write"]`)
	bearerB := seedLensAPIKey(t, db, "lens-bob", "tn-lens-bob", `["lens:read","lens:write"]`)

	const dsName = "edge-lens-isolation-canary-m40"

	// (1) Bob creates a dataset THROUGH THE EDGE (ForwardAuth mints tn-lens-bob's key). 200 (create-or-get).
	if code := lensCreateDataset(t, edgeURL, bearerB, dsName); code != http.StatusOK {
		t.Fatalf("Bob create through the edge: want 200, got %d", code)
	}

	// (2) Alice lists through the edge → Bob's dataset MUST be ABSENT (cross-tenant isolation).
	for _, n := range lensListDatasetNames(t, edgeURL, bearerA) {
		if n == dsName {
			t.Fatalf("CROSS-TENANT LEAK THROUGH THE EDGE: tn-lens-alice saw tn-lens-bob's dataset %q", dsName)
		}
	}

	// (3) Bob lists his own → PRESENT (the empty result above is isolation, not a false negative).
	found := false
	for _, n := range lensListDatasetNames(t, edgeURL, bearerB) {
		if n == dsName {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("tn-lens-bob could not list its OWN dataset through the edge — ForwardAuth/mint/rewrite wiring broken")
	}
}

// TestEdgeForwardAuthLens_PerVerbWall — a minted lens:read-only key is 403 on a write
// THROUGH Traefik (theo-lens's M22 requireScopeOnPrincipal('lens:write')).
func TestEdgeForwardAuthLens_PerVerbWall(t *testing.T) {
	edgeURL := requireE2EEdge(t)
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer db.Close()

	seedUser(t, db, "lens-ro-uid", "lens-ro@e2e.test")
	seedTenant(t, db, "tn-lens-ro", "lens-ro-uid")
	bearerRO := seedLensAPIKey(t, db, "lens-ro", "tn-lens-ro", `["lens:read"]`) // read ONLY

	if code := lensCreateDataset(t, edgeURL, bearerRO, "should-be-403"); code != http.StatusForbidden {
		t.Fatalf("per-verb wall: a minted lens:read key must be 403 on POST /v1/lens/datasets through the edge, got %d", code)
	}
}

// TestEdgeForwardAuthLens_FailClosed proves fail-closed at BOTH the edge and the service,
// and that the minted key ≠ the customer key.
func TestEdgeForwardAuthLens_FailClosed(t *testing.T) {
	edgeURL := requireE2EEdge(t)
	lensURL := env(t, "E2E_LENS_URL", "")
	if lensURL == "" {
		t.Skip("E2E_LENS_URL not set — cannot reach the lens service directly")
	}
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer db.Close()

	seedUser(t, db, "lens-fc-uid", "lens-fc@e2e.test")
	seedTenant(t, db, "tn-lens-fc", "lens-fc-uid")
	bearerC := seedLensAPIKey(t, db, "lens-fc", "tn-lens-fc", `["lens:read","lens:write"]`)

	// (5) No-key through the edge → DENIED at ForwardAuth (never reaches theo-lens).
	req, _ := http.NewRequest(http.MethodPost, edgeURL+"/v1/lens/datasets", nil)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("no-key at the edge must be DENIED, got %d", resp.StatusCode)
	}
	if resp.Header.Get("Authorization") != "" {
		t.Fatal("a denied edge request must not carry an Authorization header")
	}
	resp.Body.Close()

	// (5b) The SAME customer key bearerC WORKS through the edge → 200 (ForwardAuth mints
	// tn-lens-fc's per-tenant key). Asserting this alongside (7) makes minted≠customer
	// airtight WITHIN this test: one key, 200 through the edge but 401 direct ⇒ the edge
	// Del-then-set a DIFFERENT valid key than the customer's.
	if code := lensCreateDataset(t, edgeURL, bearerC, "edge-works-for-customer-key"); code != http.StatusOK {
		t.Fatalf("the customer key MUST work through the edge (mints per-tenant): want 200, got %d", code)
	}

	// (6) No-key DIRECT to the lens service → 401 (theo-lens M13 THEOLENS_REQUIRE_CREDENTIAL).
	if code := lensCreateDatasetDirect(t, lensURL, "", "direct-no-key"); code != http.StatusUnauthorized {
		t.Fatalf("direct-to-service with no key must be 401 (M13 fail-closed), got %d", code)
	}

	// (7) The SAME RAW customer key DIRECT to the lens service → 401 (theo-lens does not know
	// it; only the edge-minted per-tenant key resolves). With (5b) this is the airtight
	// minted≠customer proof: bearerC is 200 through the edge yet 401 direct-to-service.
	if code := lensCreateDatasetDirect(t, lensURL, bearerC, "direct-customer-key"); code != http.StatusUnauthorized {
		t.Fatalf("the RAW customer key must NOT resolve direct-to-service (minted≠customer proof); want 401, got %d", code)
	}
}
