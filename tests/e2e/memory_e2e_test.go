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

	// 1. Customer lists their memories through the gateway.
	t.Run("list returns own memories", func(t *testing.T) {
		status, body := cloudList(t, cloudURL, alphaKey)
		if status != http.StatusOK {
			t.Fatalf("list status=%d body=%s", status, body)
		}
		if !strings.Contains(body, "blue") {
			t.Fatalf("expected alpha's memory in list; got %s", body)
		}
	})

	// 2. Cross-tenant isolation: alpha must NOT see beta's data, and a list
	//    body must never carry beta's content for alpha.
	t.Run("list is scope-isolated", func(t *testing.T) {
		_, body := cloudList(t, cloudURL, alphaKey)
		if strings.Contains(body, "Lisbon") {
			t.Fatalf("isolation breach: alpha's list contains beta's memory: %s", body)
		}
	})

	// 3. IDOR: alpha tries to forget beta's memory id -> must be 404, and
	//    beta's memory must survive.
	t.Run("cross-tenant forget is denied (IDOR closed)", func(t *testing.T) {
		status := cloudForget(t, cloudURL, alphaKey, betaMemID)
		if status != http.StatusNotFound {
			t.Fatalf("expected 404 on cross-tenant forget, got %d", status)
		}
		s, body := cloudList(t, cloudURL, betaKey)
		if s != http.StatusOK || !strings.Contains(body, "Lisbon") {
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
}
