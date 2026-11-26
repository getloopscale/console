//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Package e2e drives the FULL real path of the loop-console <-> TheMemory
// integration: a customer `theo_live_*` bearer hits the gateway (loop-console),
// which proxies to the real TheMemory REST server (subject-in-path scope),
// which persists to real pgvector. The LLM + embedder are served by a hermetic
// mock so the run is deterministic and free.
//
// Boot the stack + run this via `make e2e` (see tests/e2e/run.sh). The test
// reads its endpoints from env exported by run.sh:
//
//	E2E_CLOUD_URL      gateway base URL          (http://localhost:13002)
//	E2E_LOOPMEM_URL    TheMemory REST base URL   (http://localhost:18080)
//	E2E_PG_CLOUD_DSN   cloud postgres DSN        (for seeding loop_runtime_api_keys)
//	LOOPMEM_MASTER_KEY master bearer cloud->loopmem
//
// This test FAILS against a client that does not conform to TheMemory's real
// contract (the whole point — it is the oracle for the conformance fix).
package e2e

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func env(t *testing.T, key, def string) string {
	t.Helper()
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// requireE2EStack skips the test unless the e2e stack endpoints are explicitly
// exported (run.sh sets them). Without this, a plain `go test -tags e2e ./...`
// with no stack would try the localhost defaults and FAIL loudly instead of
// SKIPping — M6 (full-chain-e2e) hygiene so the suite is clean off-stack.
func requireE2EStack(t *testing.T) {
	t.Helper()
	if os.Getenv("E2E_CLOUD_URL") == "" || os.Getenv("E2E_PG_CLOUD_DSN") == "" {
		t.Skip("E2E_CLOUD_URL / E2E_PG_CLOUD_DSN not set — skipping (run via tests/e2e/run.sh / make e2e)")
	}
}

// requireE2EEdge returns the Traefik edge URL or SKIPs. The hermetic e2e harness
// (run.sh / make e2e) does NOT run Traefik — the edge ForwardAuth tests need a
// configured edge, exercised against a dev stack (make dev-up) where E2E_EDGE_URL
// is exported. Skipping here avoids flakily passing off a FOREIGN traefik that
// happens to listen on :8090 (e.g. another project's dev stack). M6 hygiene.
func requireE2EEdge(t *testing.T) string {
	t.Helper()
	edge := os.Getenv("E2E_EDGE_URL")
	if edge == "" {
		t.Skip("E2E_EDGE_URL not set — the hermetic e2e harness has no Traefik edge (run edge tests against a dev stack)")
	}
	return edge
}

// seedAPIKey inserts a legitimate customer theo_live_* key (key_hash =
// hex(sha256(bearer))). Returns the bearer to send. Model B: bff_minted=false —
// the BFF vault (which set it true) is removed; a customer key is never a shadow row.
//
// M3: loop_runtime_api_keys.account_id (and tenants.account_id) are NOT NULL (000044).
// The key must carry an account that OWNS its tenant (else the M1 ForwardAuth
// cross-account guard rejects it). This helper inherits the tenant's account when
// the tenant already exists (e.g. seeded via seedTenant), otherwise it provisions
// a synthetic owner + account + tenant for the given tenant id so the key's
// account owns it. Idempotent: all keys for the same tenant share one account.
func seedAPIKey(t *testing.T, db *sql.DB, subject, tenant string) string {
	t.Helper()
	accountID := ensureTenantAccount(t, db, tenant)

	bearer := "theo_live_" + subject + "_e2e_secret"
	sum := sha256.Sum256([]byte(bearer))
	keyHash := hex.EncodeToString(sum[:])
	id := "e2e-" + keyHash[:16]
	_, err := db.Exec(`
		INSERT INTO loop_runtime_api_keys
			(id, subject, tenant_id, account_id, key_name, key_hash, key_prefix, scopes, expires_at, bff_minted, created_at)
		VALUES ($1,$2,$3,$4,'e2e',$5,'theo_live_',$6::jsonb, NOW() + interval '1 hour', false, NOW())
		ON CONFLICT (key_hash) DO NOTHING`,
		id, subject, tenant, accountID, keyHash, `["memory:read","memory:write","memory:delete"]`)
	if err != nil {
		t.Fatalf("seed api key for %s: %v", subject, err)
	}
	return bearer
}

// ensureTenantAccount returns the account_id that owns `tenant`, provisioning a
// synthetic owner + account + tenant when the tenant row does not yet exist.
// Post-M3 (000044) every tenant has a NOT NULL account_id, so an existing tenant
// always resolves; the provisioning branch covers tests that seed only a key.
func ensureTenantAccount(t *testing.T, db *sql.DB, tenant string) string {
	t.Helper()
	var acct string
	err := db.QueryRow(`SELECT account_id FROM tenants WHERE id = $1`, tenant).Scan(&acct)
	if err == nil && acct != "" {
		return acct // inherit the existing tenant's account
	}
	// Provision owner + account + tenant for this tenant id (idempotent).
	owner := "owner-" + tenant
	acct = "acct-seed-" + tenant
	if _, err := db.Exec(
		`INSERT INTO users (id, email, username, display_name)
		 VALUES ($1, $1 || '@e2e.test', $1, $1) ON CONFLICT (id) DO NOTHING`, owner); err != nil {
		t.Fatalf("ensure owner for %s: %v", tenant, err)
	}
	if _, err := db.Exec(
		`INSERT INTO accounts (id, display_name, plan, owner_id, created_at, updated_at)
		 VALUES ($1, $1, 'starter', $2, NOW(), NOW()) ON CONFLICT (owner_id) DO NOTHING`, acct, owner); err != nil {
		t.Fatalf("ensure account for %s: %v", tenant, err)
	}
	if err := db.QueryRow(`SELECT id FROM accounts WHERE owner_id = $1`, owner).Scan(&acct); err != nil {
		t.Fatalf("resolve account for %s: %v", tenant, err)
	}
	if _, err := db.Exec(
		`INSERT INTO tenants (id, display_name, slug, owner_id, account_id, cell_id)
		 VALUES ($1, $1, $1, $2, $3, 'cell-1') ON CONFLICT (id) DO NOTHING`, tenant, owner, acct); err != nil {
		t.Fatalf("ensure tenant %s: %v", tenant, err)
	}
	return acct
}

// gatewayRemember writes a memory through the REAL gateway customer path
// (POST /v1/memory/remember with a theo_live_* key → broker per-tenant mint →
// loopmem) and returns the created memory id. M6: the master key is control-plane
// only — loopmem rejects it for data writes — so seeding goes through the gateway
// exactly like a real customer (replaces the legacy master-direct seedMemory for
// the gateway round-trip test).
func gatewayRemember(t *testing.T, cloudURL, bearer, text string) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"text": text})
	status, body := cloudPost(t, cloudURL, bearer, "/v1/memory/remember", string(payload))
	if status < 200 || status > 299 {
		t.Fatalf("gateway remember: status=%d body=%s", status, body)
	}
	var out struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || len(out.Items) == 0 {
		t.Fatalf("gateway remember: no item id in body=%s (err=%v)", body, err)
	}
	return out.Items[0].ID
}

func mustDo(t *testing.T, req *http.Request) *http.Response {
	t.Helper()
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", req.Method, req.URL, err)
	}
	return resp
}

func readBody(resp *http.Response) string {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return string(b)
}

// cloudList calls the gateway list endpoint as the customer.
func cloudList(t *testing.T, cloudURL, bearer string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, cloudURL+"/v1/memory/list", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode, readBody(resp)
}

// cloudForget calls the gateway forget endpoint as the customer.
func cloudForget(t *testing.T, cloudURL, bearer, memoryID string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, cloudURL+"/v1/memory/forget/"+memoryID, nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestMemoryE2E_GatewayProxyRoundTrip(t *testing.T) {
	requireE2EStack(t)
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://loop_runtime:loop_runtime@localhost:55432/loop_runtime?sslmode=disable")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open cloud pg: %v", err)
	}
	defer db.Close()

	const tenant = "e2e-tenant"
	alpha := "e2e-user-alpha"
	beta := "e2e-user-beta"

	alphaKey := seedAPIKey(t, db, alpha, tenant)
	betaKey := seedAPIKey(t, db, beta, tenant)

	alphaText := "my favorite color is blue"
	betaText := "i live in Lisbon"
	// Seed through the REAL gateway customer path (broker → loopmem), not the
	// master-direct write (loopmem rejects the control-plane master for data).
	alphaMemID := gatewayRemember(t, cloudURL, alphaKey, alphaText)
	betaMemID := gatewayRemember(t, cloudURL, betaKey, betaText)

	// Assertions are by memory ID, NOT by content substring. A real extraction
	// LLM normalizes (and may translate) the raw text into a canonical fact —
	// e.g. "i live in Lisbon" is stored as "user mora em Lisboa" by gpt-4o-mini.
	// A content-substring oracle holds only against the verbatim echo-mock and
	// is additionally weaker (a leak that survives translation would pass a
	// `!Contains("Lisbon")` isolation check). The memory ID is stable across
	// extraction, so it is the real-LLM-robust oracle for presence/isolation.

	// 1. Customer lists their memories through the gateway.
	t.Run("list returns own memories", func(t *testing.T) {
		status, body := cloudList(t, cloudURL, alphaKey)
		if status != http.StatusOK {
			t.Fatalf("list status=%d body=%s", status, body)
		}
		if !strings.Contains(body, alphaMemID) {
			t.Fatalf("expected alpha's memory id %s in list; got %s", alphaMemID, body)
		}
	})

	// 2. Cross-tenant isolation: alpha must NOT see beta's memory id.
	t.Run("list is scope-isolated", func(t *testing.T) {
		_, body := cloudList(t, cloudURL, alphaKey)
		if strings.Contains(body, betaMemID) {
			t.Fatalf("isolation breach: alpha's list contains beta's memory id %s: %s", betaMemID, body)
		}
	})

	// 3. IDOR: alpha tries to forget beta's memory id -> must be 404, and
	//    beta's memory must survive (asserted by id).
	t.Run("cross-tenant forget is denied (IDOR closed)", func(t *testing.T) {
		status := cloudForget(t, cloudURL, alphaKey, betaMemID)
		if status != http.StatusNotFound {
			t.Fatalf("expected 404 on cross-tenant forget, got %d", status)
		}
		s, body := cloudList(t, cloudURL, betaKey)
		if s != http.StatusOK || !strings.Contains(body, betaMemID) {
			t.Fatalf("beta's memory was wrongly affected by alpha's forget: status=%d body=%s", s, body)
		}
	})

	// 4. Owner forget round-trip: alpha forgets their own memory -> 204, gone.
	t.Run("owner forget removes the memory", func(t *testing.T) {
		status := cloudForget(t, cloudURL, alphaKey, alphaMemID)
		if status != http.StatusNoContent {
			t.Fatalf("expected 204 on owner forget, got %d", status)
		}
		_, body := cloudList(t, cloudURL, alphaKey)
		if strings.Contains(body, alphaMemID) {
			t.Fatalf("alpha's memory still present after forget: %s", body)
		}
	})
}

// cloudPost issues an authenticated POST to the gateway SDK surface.
func cloudPost(t *testing.T, cloudURL, bearer, path, body string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, cloudURL+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode, readBody(resp)
}

func cloudGet(t *testing.T, cloudURL, bearer, path string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, cloudURL+path, nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode, readBody(resp)
}

func cloudDelete(t *testing.T, cloudURL, bearer, path string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, cloudURL+path, nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	return resp.StatusCode, readBody(resp)
}

// Full-surface round-trip: remember -> recall -> reflect + metrics/entities,
// all through the gateway against real TheMemory + real pgvector (T4.1).
func TestMemoryE2E_FullVerbSurface(t *testing.T) {
	requireE2EStack(t)
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://loop_runtime:loop_runtime@localhost:55432/loop_runtime?sslmode=disable")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open cloud pg: %v", err)
	}
	defer db.Close()

	subject := "e2e-verbs-user"
	key := seedAPIKey(t, db, subject, "e2e-tenant")
	// A second subject for cross-subject isolation of the entities aggregation.
	betaKey := seedAPIKey(t, db, "e2e-verbs-beta", "e2e-tenant")

	// remember (write through the gateway, NOT seeded directly)
	t.Run("remember writes through the gateway", func(t *testing.T) {
		status, body := cloudPost(t, cloudURL, key, "/v1/memory/remember",
			`{"text":"my favorite drink is oat milk latte","category":"prefs"}`)
		if status != http.StatusCreated {
			t.Fatalf("remember status=%d body=%s", status, body)
		}
		if !strings.Contains(body, `"items"`) {
			t.Fatalf("remember response missing items: %s", body)
		}
	})

	// recall (semantic search) — the FULL path is exercised end-to-end through
	// the gateway → TheMemory → real pgvector. We assert the path (200 + a
	// `results` array), NOT semantic ranking: the hermetic mock embedder is a
	// deterministic hash, so cosine similarity between the query and the stored
	// fact is not meaningful. Semantic-quality recall is validated separately
	// against a real embedder (TheMemory's own GOAL TEST). threshold=0 ensures
	// the path returns whatever the store holds rather than gating on a score.
	t.Run("recall path returns 200 with a results array", func(t *testing.T) {
		status, body := cloudPost(t, cloudURL, key, "/v1/memory/recall",
			`{"query":"what do I like to drink","topK":10,"threshold":0}`)
		if status != http.StatusOK {
			t.Fatalf("recall status=%d body=%s", status, body)
		}
		if !strings.Contains(body, `"results"`) {
			t.Fatalf("recall response missing results array: %s", body)
		}
	})

	// metrics (real subject-scoped counts)
	t.Run("metrics returns real total_memories", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, key, "/v1/memory/metrics")
		if status != http.StatusOK {
			t.Fatalf("metrics status=%d body=%s", status, body)
		}
		var m struct {
			Total int `json:"total_memories"`
		}
		_ = json.Unmarshal([]byte(body), &m)
		if m.Total < 1 {
			t.Fatalf("expected total_memories >= 1 after remember, got %d (%s)", m.Total, body)
		}
	})

	// entities (subject-scoped aggregation — may be empty if no attributed_to)
	t.Run("entities endpoint returns 200 with an array", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, key, "/v1/memory/entities?scope=user")
		if status != http.StatusOK {
			t.Fatalf("entities status=%d body=%s", status, body)
		}
		if !strings.Contains(body, `"entities"`) {
			t.Fatalf("entities response missing array: %s", body)
		}
	})

	// reflect (consolidation) — accepted (202) through the gateway.
	t.Run("reflect runs through the gateway", func(t *testing.T) {
		status, body := cloudPost(t, cloudURL, key, "/v1/memory/reflect", `{}`)
		if status != http.StatusAccepted {
			t.Fatalf("reflect status=%d body=%s", status, body)
		}
	})

	// Phase 2A — attribution-write + bi-temporal asOf round-trip (T3.1).
	t.Run("remember-attributed then recall-asOf round-trip", func(t *testing.T) {
		// remember a fact attributed to a peer through the gateway
		status, body := cloudPost(t, cloudURL, key, "/v1/memory/remember",
			`{"text":"maria recommended the oat milk latte","attributedTo":"e2e-peer"}`)
		if status != http.StatusCreated {
			t.Fatalf("attributed remember status=%d body=%s", status, body)
		}

		// recall with a FIXED near-FUTURE asOf (EC-3) so the just-written memory
		// is within [t_valid, asOf] regardless of clock skew. Path proof only
		// (200 + results array) — semantic ranking deferred to the hermetic
		// embedder caveat, as in the prior cycle.
		recallBody := `{"query":"what milk","topK":10,"threshold":0,"asOf":"2099-01-01T00:00:00Z"}`
		status, body = cloudPost(t, cloudURL, key, "/v1/memory/recall", recallBody)
		if status != http.StatusOK {
			t.Fatalf("asOf recall status=%d body=%s", status, body)
		}
		if !strings.Contains(body, `"results"`) {
			t.Fatalf("asOf recall missing results array: %s", body)
		}

		// TheMemory entity extraction (Slice 1, shipped v0.10.0) changed the
		// /entities semantics: it now returns EXTRACTED entity NODES from the
		// memory text (real NER-style extraction), NOT the attributed_to peer.
		// The attribution WRITE is proven by the 201 + the asOf recall results
		// above; here we prove the entities aggregation reaches the store via the
		// new extraction path — the text "…oat milk latte" yields entity nodes.
		status, body = cloudGet(t, cloudURL, key, "/v1/memory/entities?scope=user")
		if status != http.StatusOK {
			t.Fatalf("entities status=%d body=%s", status, body)
		}
		if !strings.Contains(body, `"entities":[{`) {
			t.Fatalf("entities aggregation empty after remember — extraction did not reach the store: %s", body)
		}

		// Cross-subject isolation (F-test-3): a DIFFERENT subject's entities must
		// NOT contain alpha's extracted node "oat milk" — entities derives the
		// subject from auth (subject-in-path), as list/forget already prove.
		statusB, bodyB := cloudGet(t, cloudURL, betaKey, "/v1/memory/entities?scope=user")
		if statusB != http.StatusOK {
			t.Fatalf("beta entities status=%d body=%s", statusB, bodyB)
		}
		if strings.Contains(bodyB, "oat milk") {
			t.Fatalf("isolation breach: beta's entities contain alpha's extracted node: %s", bodyB)
		}
	})

	// Phase 2A — ADR D2: invalid asOf datetime → 400 (not 502).
	t.Run("invalid asOf returns 400", func(t *testing.T) {
		status, _ := cloudPost(t, cloudURL, key, "/v1/memory/recall",
			`{"query":"x","asOf":"not-a-date"}`)
		if status != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid asOf, got %d", status)
		}
	})

	// loopmem-graph-gateway-dashboard — graph endpoint round-trip through the
	// gateway → rebuilt loopmem (Slice 2 /graph). Asserts the {nodes,edges} shape
	// is served end-to-end. Edges are non-empty only when the extraction LLM emits
	// relations (the hermetic mock may not); the integration proof is the shape +
	// 200 + per-subject isolation, mirroring the entities round-trip caveat.
	t.Run("remember-relation then graph round-trip", func(t *testing.T) {
		status, body := cloudPost(t, cloudURL, key, "/v1/memory/remember",
			`{"text":"John Smith works at Google"}`)
		if status != http.StatusCreated {
			t.Fatalf("relation remember status=%d body=%s", status, body)
		}
		status, body = cloudGet(t, cloudURL, key, "/v1/memory/graph?scope=user")
		if status != http.StatusOK {
			t.Fatalf("graph status=%d body=%s", status, body)
		}
		if !strings.Contains(body, `"nodes"`) || !strings.Contains(body, `"edges"`) {
			t.Fatalf("graph response missing {nodes,edges}: %s", body)
		}

		// Per-subject isolation (mirror entities F-test-3): a DIFFERENT subject's
		// graph must NOT contain alpha's John Smith node/edge.
		statusB, bodyB := cloudGet(t, cloudURL, betaKey, "/v1/memory/graph?scope=user")
		if statusB != http.StatusOK {
			t.Fatalf("beta graph status=%d body=%s", statusB, bodyB)
		}
		if strings.Contains(bodyB, "John Smith") {
			t.Fatalf("isolation breach: beta's graph contains alpha's node: %s", bodyB)
		}
	})

	// loopmem-graph-gateway-dashboard — invalid scope → 400 (not 502) through gateway.
	t.Run("graph invalid scope returns 400", func(t *testing.T) {
		status, _ := cloudGet(t, cloudURL, key, "/v1/memory/graph?scope=bogus")
		if status != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid graph scope, got %d", status)
		}
	})
}

// zeroVector1536 is a deterministic dummy embedding for skill seeding. The
// skills listing query filters by kind/agent_id/superseded/soft-delete and does
// NOT use the embedding, so a zero vector is sufficient (the e2e loopmem runs
// LOOPSCALEMEM_EMBEDDER=openai → vector(1536)).
func zeroVector1536() string {
	return "[" + strings.Repeat("0,", 1535) + "0]"
}

// seedSkill inserts a kind='skill' row directly into TheMemory's DB under the
// given agent_id (the namespaced repoId the gateway computes: `{subject}:{repoId}`).
// There is no skill-WRITE REST surface (skills are read-only via the gateway),
// so the e2e seeds at the storage layer. dashboard-phase2b-skills-browse T5.1.
// seedSkill inserts a skill row directly into loopmem under the given workspace.
// M6: the workspace MUST be the TENANT id — the gateway browse resolves a
// per-tenant key whose loopmem workspace == tenantID (the M1 invariant), so a
// skill seeded under any other workspace (e.g. the legacy 'default') is invisible
// to the real per-tenant browse path.
func seedSkill(t *testing.T, loopmemDSN, workspace, agentID, hash, description, code string) {
	t.Helper()
	db, err := sql.Open("pgx", loopmemDSN)
	if err != nil {
		t.Fatalf("open loopmem pg: %v", err)
	}
	defer db.Close()
	_, err = db.Exec(
		`INSERT INTO memories (text, hash, embedding, payload, agent_id, workspace_id, kind, code, description, code_language)
		 VALUES ($1, $2, $3::vector, '{}'::jsonb, $4, $5, 'skill', $6, $7, 'typescript')`,
		description, hash, zeroVector1536(), agentID, workspace, code, description,
	)
	if err != nil {
		t.Fatalf("seed skill (agent_id=%s): %v", agentID, err)
	}
}

// TestMemoryE2E_SkillsBrowse proves the read-only skills browse path end-to-end
// through the gateway → TheMemory, including the D3 per-customer repo namespacing
// + cross-customer isolation. dashboard-phase2b-skills-browse T5.1.
func TestMemoryE2E_SkillsBrowse(t *testing.T) {
	requireE2EStack(t)
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://loop_runtime:loop_runtime@localhost:55432/loop_runtime?sslmode=disable")
	loopmemDSN := env(t, "E2E_PG_LOOPMEM_DSN", "postgres://themem:themem@localhost:55433/themem?sslmode=disable")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open cloud pg: %v", err)
	}
	defer db.Close()

	const tenant = "e2e-tenant"
	alpha := "e2e-skills-alpha"
	beta := "e2e-skills-beta"
	alphaKey := seedAPIKey(t, db, alpha, tenant)
	betaKey := seedAPIKey(t, db, beta, tenant)

	// The gateway computes the upstream repoId as `{subject}:{repoId}` (D3). Seed
	// a skill under alpha's namespace for the bare repoId "shared".
	const repoID = "shared"
	seedSkill(t, loopmemDSN, tenant, alpha+":"+repoID, "e2e-skill-hash-1", "deploy the alpha service", "kubectl apply -f alpha")

	t.Run("owner sees the seeded skill via the gateway", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, alphaKey, "/v1/memory/skills?repoId="+repoID)
		if status != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", status, body)
		}
		if !strings.Contains(body, "deploy the alpha service") {
			t.Fatalf("expected the seeded skill in the listing, got %s", body)
		}
		if !strings.Contains(body, "kubectl apply -f alpha") {
			t.Fatalf("expected the skill code in the listing, got %s", body)
		}
	})

	t.Run("D3 isolation: a different customer with the same bare repoId sees none", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, betaKey, "/v1/memory/skills?repoId="+repoID)
		if status != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", status, body)
		}
		if strings.Contains(body, "deploy the alpha service") {
			t.Fatalf("CROSS-CUSTOMER LEAK: beta saw alpha's skill (D3 namespacing failed). body=%s", body)
		}
		if !strings.Contains(body, `"skills":[]`) {
			t.Fatalf("expected empty skills for beta, got %s", body)
		}
	})

	t.Run("empty repoId rejected with 400", func(t *testing.T) {
		status, _ := cloudGet(t, cloudURL, alphaKey, "/v1/memory/skills?repoId=")
		if status != http.StatusBadRequest {
			t.Fatalf("expected 400 for empty repoId, got %d", status)
		}
	})
}

// TestMemoryE2E_SkillsAllCrossRepo proves the SDK-surface cross-repo flat skills
// list (GET /v1/memory/skills/all) end-to-end through the real gateway mux →
// TheMemory: the route is actually MOUNTED under RequireScope("memory:read"),
// passes the BARE authenticated subject, returns every repo's skills with a
// per-row repoId, and isolates other customers. skills-cross-repo-sdk-symmetry M3.
func TestMemoryE2E_SkillsAllCrossRepo(t *testing.T) {
	requireE2EStack(t)
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://loop_runtime:loop_runtime@localhost:55432/loop_runtime?sslmode=disable")
	loopmemDSN := env(t, "E2E_PG_LOOPMEM_DSN", "postgres://themem:themem@localhost:55433/themem?sslmode=disable")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open cloud pg: %v", err)
	}
	defer db.Close()

	const tenant = "e2e-tenant"
	alpha := "e2e-skillsall-alpha"
	beta := "e2e-skillsall-beta"
	alphaKey := seedAPIKey(t, db, alpha, tenant)
	betaKey := seedAPIKey(t, db, beta, tenant)

	// Two skills under alpha's subject, in two DIFFERENT bare repos. The gateway
	// passes the BARE subject; TheMemory prefix-scans agent_id LIKE 'alpha:%' and
	// returns each row's bare repoId.
	seedSkill(t, loopmemDSN, tenant, alpha+":repo-a", "e2e-skillsall-hash-a", "alpha parser util", "parse(x)")
	seedSkill(t, loopmemDSN, tenant, alpha+":repo-b", "e2e-skillsall-hash-b", "beta csv loader", "loadCsv(p)")

	t.Run("owner sees ALL its skills across repos with per-row repoId", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, alphaKey, "/v1/memory/skills/all")
		if status != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", status, body)
		}
		if !strings.Contains(body, "alpha parser util") || !strings.Contains(body, "beta csv loader") {
			t.Fatalf("expected BOTH repos' skills in the flat list, got %s", body)
		}
		if !strings.Contains(body, `"repoId":"repo-a"`) || !strings.Contains(body, `"repoId":"repo-b"`) {
			t.Fatalf("expected per-row bare repoId (repo-a + repo-b), got %s", body)
		}
	})

	t.Run("isolation: a different customer sees none of alpha's skills", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, betaKey, "/v1/memory/skills/all")
		if status != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", status, body)
		}
		if strings.Contains(body, "alpha parser util") || strings.Contains(body, "beta csv loader") {
			t.Fatalf("CROSS-CUSTOMER LEAK: beta saw alpha's cross-repo skills. body=%s", body)
		}
		if !strings.Contains(body, `"skills":[]`) {
			t.Fatalf("expected empty skills for beta, got %s", body)
		}
	})
}

// TestMemoryE2E_SkillsWrite proves the WRITE surface end-to-end through the
// gateway: an agent authors a skill (POST), sees it (GET), deletes it (DELETE);
// a duplicate description -> 409; a different customer cannot delete it (D3
// isolation -> 404). skills-write-surface T5.1.
func TestMemoryE2E_SkillsWrite(t *testing.T) {
	requireE2EStack(t)
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://loop_runtime:loop_runtime@localhost:55432/loop_runtime?sslmode=disable")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open cloud pg: %v", err)
	}
	defer db.Close()

	const tenant = "e2e-tenant"
	alphaKey := seedAPIKey(t, db, "e2e-skw-alpha", tenant)
	betaKey := seedAPIKey(t, db, "e2e-skw-beta", tenant)
	const repoID = "write-repo"
	const draft = `{"code":"export const deploy = () => {};","description":"deploy via gateway","codeLanguage":"typescript"}`

	var createdID string
	t.Run("agent authors a skill via POST -> 201", func(t *testing.T) {
		status, body := cloudPost(t, cloudURL, alphaKey, "/v1/memory/skills?repoId="+repoID, draft)
		if status != http.StatusCreated {
			t.Fatalf("expected 201, got %d body=%s", status, body)
		}
		var out struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(body), &out); err != nil || out.ID == "" {
			t.Fatalf("expected {id}, got %s (err %v)", body, err)
		}
		createdID = out.ID
	})

	t.Run("owner sees the authored skill via GET", func(t *testing.T) {
		status, body := cloudGet(t, cloudURL, alphaKey, "/v1/memory/skills?repoId="+repoID)
		if status != http.StatusOK || !strings.Contains(body, "deploy via gateway") {
			t.Fatalf("expected the authored skill, got %d %s", status, body)
		}
	})

	t.Run("duplicate description -> 409", func(t *testing.T) {
		status, _ := cloudPost(t, cloudURL, alphaKey, "/v1/memory/skills?repoId="+repoID,
			`{"code":"different","description":"deploy via gateway","codeLanguage":"typescript"}`)
		if status != http.StatusConflict {
			t.Fatalf("expected 409, got %d", status)
		}
	})

	t.Run("D3 isolation: another customer cannot delete it (404)", func(t *testing.T) {
		status, _ := cloudDelete(t, cloudURL, betaKey, "/v1/memory/skills/"+createdID+"?repoId="+repoID)
		if status != http.StatusNotFound {
			t.Fatalf("CROSS-CUSTOMER: beta deleting alpha's skill expected 404, got %d", status)
		}
	})

	t.Run("owner deletes -> 204; listing no longer shows it", func(t *testing.T) {
		status, _ := cloudDelete(t, cloudURL, alphaKey, "/v1/memory/skills/"+createdID+"?repoId="+repoID)
		if status != http.StatusNoContent {
			t.Fatalf("expected 204, got %d", status)
		}
		_, body := cloudGet(t, cloudURL, alphaKey, "/v1/memory/skills?repoId="+repoID)
		if strings.Contains(body, "deploy via gateway") {
			t.Fatalf("skill still present after delete: %s", body)
		}
	})
}
