//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M18 (KEYSTONE) — the non-negotiable proof of invariant #6 for the RAG capability:
// cross-tenant isolation + the per-verb scope wall + fail-closed hold END-TO-END through
// the REAL Traefik edge + REAL ForwardAuth + a REAL theo-rag container. Mirrors the
// memory edge e2e (edge_forward_auth_e2e_test.go, #113) but uses collections CRUD (no
// embedding — pure isolation) so the proof needs no LLM.
//
// The stack is hermetic (docker-compose.edge.e2e.yaml): container upstream http://rag:8080,
// mock-openai, consumer keys seeded in the CLOUD DB, per-tenant keys minted by the broker.
// theo-rag runs with THEORAG_REQUIRE_CREDENTIAL=true (M13) so the direct-to-service no-key
// request 401s. Test names carry the TestEdgeForwardAuth prefix so `make e2e-edge`
// (-run TestEdgeForwardAuth) picks them up.
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

// seedRagAPIKey inserts a customer theo_live_* key in the CLOUD DB scoped for rag
// (mirrors seedAPIKey but with rag scopes). The consumer key resolution is theo-cloud's
// job (capability-agnostic); only the scopes JSON differs from the memory variant.
func seedRagAPIKey(t *testing.T, db *sql.DB, subject, tenant, scopesJSON string) string {
	t.Helper()
	accountID := ensureTenantAccount(t, db, tenant)
	bearer := "theo_live_" + subject + "_e2e_secret"
	sum := sha256.Sum256([]byte(bearer))
	keyHash := hex.EncodeToString(sum[:])
	id := "e2e-rag-" + keyHash[:16]
	_, err := db.Exec(`
		INSERT INTO loopruntime_api_keys
			(id, subject, tenant_id, account_id, key_name, key_hash, key_prefix, scopes, expires_at, bff_minted, created_at)
		VALUES ($1,$2,$3,$4,'e2e-rag',$5,'theo_live_',$6::jsonb, NOW() + interval '1 hour', false, NOW())
		ON CONFLICT (key_hash) DO NOTHING`,
		id, subject, tenant, accountID, keyHash, scopesJSON)
	if err != nil {
		t.Fatalf("seed rag api key for %s: %v", subject, err)
	}
	return bearer
}

// ragCreateCollection POSTs a collection to base (edge or direct); returns the status.
func ragCreateCollection(t *testing.T, base, bearer, name string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name})
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/rag/collections", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode
}

// ragCreateCollectionDirect POSTs straight at the rag service (bypassing the edge/rewrite):
// theo-rag's native path is /v1/collections (no /rag prefix).
func ragCreateCollectionDirect(t *testing.T, ragURL, bearer, name string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name})
	req, _ := http.NewRequest(http.MethodPost, ragURL+"/v1/collections", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode
}

// ragListCollectionNames GETs the caller workspace's collections through the edge and
// returns their names (workspace-scoped by the minted per-tenant key).
func ragListCollectionNames(t *testing.T, edgeURL, bearer string) []string {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, edgeURL+"/v1/rag/collections", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list collections: want 200, got %d (%s)", resp.StatusCode, readBody(resp))
	}
	var out struct {
		Items []struct {
			Name *string `json:"name"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode collections list: %v", err)
	}
	names := make([]string, 0, len(out.Items))
	for _, it := range out.Items {
		if it.Name != nil {
			names = append(names, *it.Name)
		}
	}
	return names
}

// TestEdgeForwardAuthRagTenantIsolationE2E is the headline invariant-#6 proof for rag:
// two tenants through the edge; A cannot see B's collection; B sees its own.
func TestEdgeForwardAuthRagTenantIsolationE2E(t *testing.T) {
	edgeURL := requireE2EEdge(t)
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping edge rag ForwardAuth e2e")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer db.Close()

	seedUser(t, db, "rag-alice-uid", "rag-alice@e2e.test")
	seedUser(t, db, "rag-bob-uid", "rag-bob@e2e.test")
	seedTenant(t, db, "tn-rag-alice", "rag-alice-uid")
	seedTenant(t, db, "tn-rag-bob", "rag-bob-uid")
	bearerA := seedRagAPIKey(t, db, "rag-alice", "tn-rag-alice", `["rag:read","rag:write"]`)
	bearerB := seedRagAPIKey(t, db, "rag-bob", "tn-rag-bob", `["rag:read","rag:write"]`)

	const collName = "edge-rag-isolation-canary-m18"

	// (1) Bob creates a collection THROUGH THE EDGE (ForwardAuth mints tn-rag-bob's key).
	if code := ragCreateCollection(t, edgeURL, bearerB, collName); code != http.StatusCreated {
		t.Fatalf("Bob create through the edge: want 201, got %d", code)
	}

	// (2) Alice lists through the edge → Bob's collection MUST be ABSENT (cross-tenant isolation).
	for _, n := range ragListCollectionNames(t, edgeURL, bearerA) {
		if n == collName {
			t.Fatalf("CROSS-TENANT LEAK THROUGH THE EDGE: tn-rag-alice saw tn-rag-bob's collection %q", collName)
		}
	}

	// (3) Bob lists his own → PRESENT (the empty result above is isolation, not a false negative).
	found := false
	for _, n := range ragListCollectionNames(t, edgeURL, bearerB) {
		if n == collName {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("tn-rag-bob could not list its OWN collection through the edge — ForwardAuth/mint/rewrite wiring broken")
	}
}

// TestEdgeForwardAuthRag_PerVerbWall — a minted rag:read-only key is 403 on a write
// THROUGH Traefik (theo-rag's M11 requireScopeOnPrincipal('rag:write')).
func TestEdgeForwardAuthRag_PerVerbWall(t *testing.T) {
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

	seedUser(t, db, "rag-ro-uid", "rag-ro@e2e.test")
	seedTenant(t, db, "tn-rag-ro", "rag-ro-uid")
	bearerRO := seedRagAPIKey(t, db, "rag-ro", "tn-rag-ro", `["rag:read"]`) // read ONLY

	if code := ragCreateCollection(t, edgeURL, bearerRO, "should-be-403"); code != http.StatusForbidden {
		t.Fatalf("per-verb wall: a minted rag:read key must be 403 on POST /v1/rag/collections through the edge, got %d", code)
	}
}

// TestEdgeForwardAuthRag_FailClosed proves fail-closed at BOTH the edge and the service,
// and that the minted key ≠ the customer key.
func TestEdgeForwardAuthRag_FailClosed(t *testing.T) {
	edgeURL := requireE2EEdge(t)
	ragURL := env(t, "E2E_RAG_URL", "")
	if ragURL == "" {
		t.Skip("E2E_RAG_URL not set — cannot reach the rag service directly")
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

	seedUser(t, db, "rag-fc-uid", "rag-fc@e2e.test")
	seedTenant(t, db, "tn-rag-fc", "rag-fc-uid")
	bearerC := seedRagAPIKey(t, db, "rag-fc", "tn-rag-fc", `["rag:read","rag:write"]`)

	// (5) No-key through the edge → DENIED at ForwardAuth (never reaches theo-rag).
	req, _ := http.NewRequest(http.MethodPost, edgeURL+"/v1/rag/collections", nil)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("no-key at the edge must be DENIED, got %d", resp.StatusCode)
	}
	if resp.Header.Get("Authorization") != "" {
		t.Fatal("a denied edge request must not carry an Authorization header")
	}
	resp.Body.Close()

	// (6) No-key DIRECT to the rag service → 401 (theo-rag M13 THEORAG_REQUIRE_CREDENTIAL).
	if code := ragCreateCollectionDirect(t, ragURL, "", "direct-no-key"); code != http.StatusUnauthorized {
		t.Fatalf("direct-to-service with no key must be 401 (M13 fail-closed), got %d", code)
	}

	// (7) The RAW customer key DIRECT to the rag service → 401 (theo-rag does not know it;
	// only the edge-minted per-tenant key resolves). Combined with the edge-write 201
	// (isolation test), this proves the edge Del-then-set a DIFFERENT valid key (minted ≠ customer).
	if code := ragCreateCollectionDirect(t, ragURL, bearerC, "direct-customer-key"); code != http.StatusUnauthorized {
		t.Fatalf("the RAW customer key must NOT resolve direct-to-service (minted≠customer proof); want 401, got %d", code)
	}
}
