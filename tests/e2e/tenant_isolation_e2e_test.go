//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Model B slice 2 / T5.1 — the headline confused-deputy (CWE-441) closure proven
// END-TO-END through the real gateway → TheMemory path: a customer bound to
// tenant A cannot read tenant B's memory, because the gateway authenticates the
// data path with a PER-TENANT theo_live_* key (resolved by the credential
// broker from the authenticated tenant) and TheMemory enforces isolation from
// that credential. Requires the Model B dev stack (THEMORY_REQUIRE_CREDENTIAL=true
// on themory + a bootstrapped THEMORY_PLATFORM_ADMIN_KEY on the gateway — see
// dev/README § Model B). Build-tagged `e2e`; run via `make e2e`.
//
// The mint-failure → fail-closed leg is proven deterministically at the
// unit/handler level (internal/themory/client_resolver_test.go +
// internal/routes/memory_failclosed_test.go) — it does not need a live outage here.
package e2e

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestTenantIsolationE2E_TenantACannotReadTenantB drives two customers in
// DIFFERENT tenants through the gateway and asserts cross-tenant reads are empty.
func TestTenantIsolationE2E_TenantACannotReadTenantB(t *testing.T) {
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping tenant-isolation e2e")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer db.Close()

	// Two customers, two tenants. seedAPIKey binds (subject, tenant_id); the
	// gateway resolves a per-tenant theo_live_* key from tenant_id via the broker.
	bearerA := seedAPIKey(t, db, "alice", "tn-alice")
	bearerB := seedAPIKey(t, db, "bob", "tn-bob")

	const canary = "tenant isolation canary phrase model-b"

	// Bob (tn-bob) remembers via the gateway → broker mints/uses the tn-bob key →
	// TheMemory stores under workspace tn-bob.
	remember(t, cloudURL, bearerB, "bob", canary)

	// Alice (tn-alice) recalls the same text → MUST be empty: her per-tenant key
	// is bound to workspace tn-alice; TheMemory never returns tn-bob's rows.
	resA := recall(t, cloudURL, bearerA, "alice", canary)
	if len(resA) != 0 {
		t.Fatalf("CROSS-TENANT LEAK: tn-alice recalled %d result(s) for tn-bob's memory — confused-deputy NOT closed", len(resA))
	}

	// Bob recalls his own → sees it (proves the canary is findable in its tenant,
	// so the empty result above is isolation, not a false negative).
	resB := recall(t, cloudURL, bearerB, "bob", canary)
	if len(resB) == 0 {
		t.Fatalf("tn-bob could not recall its OWN memory — broker/per-tenant wiring broken")
	}
}

// --- minimal HTTP helpers (reuse the package's env/mustDo/seedAPIKey) ---------

func remember(t *testing.T, cloudURL, bearer, userID, text string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"userId": userID, "text": text, "infer": false})
	req, _ := http.NewRequest(http.MethodPost, cloudURL+"/v1/memory/remember", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("remember(%s): status=%d body=%s", userID, resp.StatusCode, readBody(resp))
	}
}

func recall(t *testing.T, cloudURL, bearer, userID, query string) []any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"userId": userID, "query": query, "threshold": 0})
	req, _ := http.NewRequest(http.MethodPost, cloudURL+"/v1/memory/recall", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("recall(%s): status=%d body=%s", userID, resp.StatusCode, readBody(resp))
	}
	var out struct {
		Results []any `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("recall(%s): decode: %v", userID, err)
	}
	return out.Results
}
