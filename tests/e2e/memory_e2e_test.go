//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package e2e drives the FULL real path of the theo-cloud <-> TheMemory
// integration: a customer `theo_live_*` bearer hits the gateway (theo-cloud),
// which proxies to the real TheMemory REST server (subject-in-path scope),
// which persists to real pgvector. The LLM + embedder are served by a hermetic
// mock so the run is deterministic and free.
//
// Boot the stack + run this via `make e2e` (see tests/e2e/run.sh). The test
// reads its endpoints from env exported by run.sh:
//
//	E2E_CLOUD_URL      gateway base URL          (http://localhost:13002)
//	E2E_THEMORY_URL    TheMemory REST base URL   (http://localhost:18080)
//	E2E_PG_CLOUD_DSN   cloud postgres DSN        (for seeding theo_api_keys)
//	THEMORY_MASTER_KEY master bearer cloud->themory
//
// This test FAILS against a client that does not conform to TheMemory's real
// contract (the whole point — it is the oracle for the conformance fix).
package e2e

import (
	"bytes"
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

// seedAPIKey inserts a customer theo_live_* key the exact way the gateway's BFF
// vault does: key_hash = hex(sha256(bearer)). Returns the bearer to send.
func seedAPIKey(t *testing.T, db *sql.DB, subject, tenant string) string {
	t.Helper()
	bearer := "theo_live_" + subject + "_e2e_secret"
	sum := sha256.Sum256([]byte(bearer))
	keyHash := hex.EncodeToString(sum[:])
	id := "e2e-" + keyHash[:16]
	_, err := db.Exec(`
		INSERT INTO theo_api_keys
			(id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, expires_at, bff_minted, created_at)
		VALUES ($1,$2,$3,'e2e',$4,'theo_live_',$5::jsonb, NOW() + interval '1 hour', true, NOW())
		ON CONFLICT (key_hash) DO NOTHING`,
		id, subject, tenant, keyHash, `["memory:read","memory:write","memory:delete"]`)
	if err != nil {
		t.Fatalf("seed api key for %s: %v", subject, err)
	}
	return bearer
}

// seedMemory writes a memory into TheMemory under user scope == subject, via the
// real POST /v1/remember (master bearer). Returns the created memory id.
func seedMemory(t *testing.T, themoryURL, masterKey, subject, text string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"text": text, "userId": subject})
	req, _ := http.NewRequest(http.MethodPost, themoryURL+"/v1/remember", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+masterKey)
	req.Header.Set("Content-Type", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("seed memory: POST /v1/remember status=%d body=%s", resp.StatusCode, readBody(resp))
	}
	var out struct {
		Items []struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("seed memory: decode: %v", err)
	}
	if len(out.Items) == 0 {
		t.Fatalf("seed memory: extraction returned 0 items for %q (mock-openai wiring?)", text)
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
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	themoryURL := env(t, "E2E_THEMORY_URL", "http://localhost:18080")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://theocloud:theocloud@localhost:55432/theocloud?sslmode=disable")
	masterKey := env(t, "THEMORY_MASTER_KEY", "e2e-master-key")

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
	alphaMemID := seedMemory(t, themoryURL, masterKey, alpha, alphaText)
	betaMemID := seedMemory(t, themoryURL, masterKey, beta, betaText)

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
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://theocloud:theocloud@localhost:55432/theocloud?sslmode=disable")

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

	// themory-graph-gateway-dashboard — graph endpoint round-trip through the
	// gateway → rebuilt themory (Slice 2 /graph). Asserts the {nodes,edges} shape
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

	// themory-graph-gateway-dashboard — invalid scope → 400 (not 502) through gateway.
	t.Run("graph invalid scope returns 400", func(t *testing.T) {
		status, _ := cloudGet(t, cloudURL, key, "/v1/memory/graph?scope=bogus")
		if status != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid graph scope, got %d", status)
		}
	})
}

// zeroVector1536 is a deterministic dummy embedding for skill seeding. The
// skills listing query filters by kind/agent_id/superseded/soft-delete and does
// NOT use the embedding, so a zero vector is sufficient (the e2e themory runs
// THEOMEM_EMBEDDER=openai → vector(1536)).
func zeroVector1536() string {
	return "[" + strings.Repeat("0,", 1535) + "0]"
}

// seedSkill inserts a kind='skill' row directly into TheMemory's DB under the
// given agent_id (the namespaced repoId the gateway computes: `{subject}:{repoId}`).
// There is no skill-WRITE REST surface (skills are read-only via the gateway),
// so the e2e seeds at the storage layer. dashboard-phase2b-skills-browse T5.1.
func seedSkill(t *testing.T, themoryDSN, agentID, hash, description, code string) {
	t.Helper()
	db, err := sql.Open("pgx", themoryDSN)
	if err != nil {
		t.Fatalf("open themory pg: %v", err)
	}
	defer db.Close()
	_, err = db.Exec(
		`INSERT INTO memories (text, hash, embedding, payload, agent_id, workspace_id, kind, code, description, code_language)
		 VALUES ($1, $2, $3::vector, '{}'::jsonb, $4, 'default', 'skill', $5, $6, 'typescript')`,
		description, hash, zeroVector1536(), agentID, code, description,
	)
	if err != nil {
		t.Fatalf("seed skill (agent_id=%s): %v", agentID, err)
	}
}

// TestMemoryE2E_SkillsBrowse proves the read-only skills browse path end-to-end
// through the gateway → TheMemory, including the D3 per-customer repo namespacing
// + cross-customer isolation. dashboard-phase2b-skills-browse T5.1.
func TestMemoryE2E_SkillsBrowse(t *testing.T) {
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://theocloud:theocloud@localhost:55432/theocloud?sslmode=disable")
	themoryDSN := env(t, "E2E_PG_THEMORY_DSN", "postgres://themem:themem@localhost:55433/themem?sslmode=disable")

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
	seedSkill(t, themoryDSN, alpha+":"+repoID, "e2e-skill-hash-1", "deploy the alpha service", "kubectl apply -f alpha")

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
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://theocloud:theocloud@localhost:55432/theocloud?sslmode=disable")
	themoryDSN := env(t, "E2E_PG_THEMORY_DSN", "postgres://themem:themem@localhost:55433/themem?sslmode=disable")

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
	seedSkill(t, themoryDSN, alpha+":repo-a", "e2e-skillsall-hash-a", "alpha parser util", "parse(x)")
	seedSkill(t, themoryDSN, alpha+":repo-b", "e2e-skillsall-hash-b", "beta csv loader", "loadCsv(p)")

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
	cloudURL := env(t, "E2E_CLOUD_URL", "http://localhost:13002")
	dsn := env(t, "E2E_PG_CLOUD_DSN", "postgres://theocloud:theocloud@localhost:55432/theocloud?sslmode=disable")

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
