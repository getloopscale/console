//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package e2e

// fullchain_e2e_test.go — M6 (full-chain-e2e, the real user journey).
//
// The FIRST automated test that drives the REAL ecosystem chain end-to-end with
// ZERO mocks and ZERO synthetic seeds:
//
//   real Kratos login (pre-verified identity, headless API flow)
//     -> POST /v1/auth/session/token (Kratos cookie -> theo_session_* JWT)
//       -> POST /v1/dashboard/memory/{remember,recall} (session-JWT chain)
//         -> the REAL Model-B broker mints a per-tenant key
//           -> REAL themory stores/returns the memory
//
// This replaces the captureMinter STUB the M1/M3 isolation e2e used: tenancy
// isolation is proven here on the fully-real broker -> themory path.
//
//   make e2e   (or, against a KEEP_UP=1 stack:)
//   E2E_CLOUD_URL=... E2E_KRATOS_PUBLIC_URL=... E2E_KRATOS_ADMIN_URL=... \
//     go test -tags e2e -run TestFullChainE2E -race ./tests/e2e/

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strconv"
	"strings"
	"testing"
	"time"
)

const fcPassword = "Full-Chain-E2E-Pw-2026-a8s7df" // pre-verified test identity password

// fcNonce makes every test-run's identities unique so re-runs never collide on
// the orphan `users.email` UNIQUE constraint left by a prior run (the Kratos
// identity is deleted at teardown but the pg user row persists). A CI stack is
// fresh each time; this keeps LOCAL re-runs (KEEP_UP) idempotent.
var fcNonce = strconv.FormatInt(time.Now().UnixNano(), 36)

func fcEmail(local string) string { return local + "-" + fcNonce + "@e2e.test" }

// is2xx reports whether the HTTP status is a success (memory writes return 201).
func is2xx(status int) bool { return status >= 200 && status <= 299 }

// fcSkip returns the chain endpoints or skips if the stack is not up.
func fcSkip(t *testing.T) (cloudURL, kratosPublic, kratosAdmin string) {
	t.Helper()
	cloudURL = env(t, "E2E_CLOUD_URL", "")
	kratosPublic = env(t, "E2E_KRATOS_PUBLIC_URL", "")
	kratosAdmin = env(t, "E2E_KRATOS_ADMIN_URL", "")
	if cloudURL == "" || kratosPublic == "" || kratosAdmin == "" {
		t.Skip("E2E_CLOUD_URL / E2E_KRATOS_PUBLIC_URL / E2E_KRATOS_ADMIN_URL not set — skipping full-chain e2e")
	}
	return cloudURL, kratosPublic, kratosAdmin
}

// provisionIdentity creates (or reuses) a PRE-VERIFIED Kratos identity with a
// password credential via the admin API, so a real login works without the email
// loop. Registers a teardown that deletes it (idempotent across re-runs).
func provisionIdentity(t *testing.T, adminURL, email string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"schema_id": "default",
		"traits":    map[string]any{"email": email, "name": "Full Chain Test"},
		"verifiable_addresses": []map[string]any{
			{"value": email, "verified": true, "via": "email", "status": "completed"},
		},
		"credentials": map[string]any{
			"password": map[string]any{"config": map[string]any{"password": fcPassword}},
		},
	})
	req, _ := http.NewRequest(http.MethodPost, adminURL+"/admin/identities", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()

	var id string
	switch resp.StatusCode {
	case http.StatusCreated, http.StatusOK:
		var created struct {
			ID string `json:"id"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&created)
		id = created.ID
	case http.StatusConflict:
		id = lookupIdentityID(t, adminURL, email) // left over from a prior run — reuse
	default:
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("provision identity %q: HTTP %d: %s", email, resp.StatusCode, raw)
	}
	if id == "" {
		t.Fatalf("provision identity %q: empty id", email)
	}
	t.Cleanup(func() { deleteIdentity(t, adminURL, id) })
}

func lookupIdentityID(t *testing.T, adminURL, email string) string {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, adminURL+"/admin/identities?credentials_identifier="+email, nil)
	resp := mustDo(t, req)
	defer resp.Body.Close()
	var ids []struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&ids)
	if len(ids) == 0 {
		return ""
	}
	return ids[0].ID
}

func deleteIdentity(t *testing.T, adminURL, id string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, adminURL+"/admin/identities/"+id, nil)
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

// loginViaKratos drives the REAL headless Kratos browser-API login flow (cookie
// jar + CSRF), returning the ory_kratos_session cookie value. This is the exact
// flow the dashboard performs, minus the browser (ported from the canonical bash
// recipe theo/infra/tests/e2e/dashboard-engine-proxy_test.sh).
func loginViaKratos(t *testing.T, kratosPublic, email string) string {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 30 * time.Second}

	// 1) init the login flow (Accept: json) — sets the CSRF cookie in the jar.
	req, _ := http.NewRequest(http.MethodGet, kratosPublic+"/self-service/login/browser", nil)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("kratos login init: %v", err)
	}
	var flow struct {
		UI struct {
			Action string `json:"action"`
			Nodes  []struct {
				Attributes struct {
					Name  string `json:"name"`
					Value any    `json:"value"`
				} `json:"attributes"`
			} `json:"nodes"`
		} `json:"ui"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&flow); err != nil {
		_ = resp.Body.Close()
		t.Fatalf("kratos flow decode: %v", err)
	}
	_ = resp.Body.Close()
	csrf := ""
	for _, n := range flow.UI.Nodes {
		if n.Attributes.Name == "csrf_token" {
			csrf, _ = n.Attributes.Value.(string)
		}
	}
	if flow.UI.Action == "" {
		t.Fatalf("kratos flow: empty action URL (check SERVE_PUBLIC_BASE_URL)")
	}

	// 2) submit credentials to the flow action (jar carries the CSRF cookie).
	payload, _ := json.Marshal(map[string]any{
		"csrf_token": csrf,
		"identifier": email,
		"method":     "password",
		"password":   fcPassword,
	})
	req2, _ := http.NewRequest(http.MethodPost, flow.UI.Action, bytes.NewReader(payload))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Accept", "application/json")
	resp2, err := client.Do(req2)
	if err != nil {
		t.Fatalf("kratos login submit: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp2.Body)
		t.Fatalf("kratos login submit for %q: HTTP %d: %s", email, resp2.StatusCode, raw)
	}

	// 3) the session cookie is now in the jar — extract it for the BFF exchange.
	for _, c := range jar.Cookies(req2.URL) {
		if c.Name == "ory_kratos_session" {
			return c.Value
		}
	}
	t.Fatalf("kratos login for %q: no ory_kratos_session cookie set", email)
	return ""
}

// exchangeForJWT calls POST /v1/auth/session/token with the Kratos session cookie
// and returns the theo_session_* JWT (the real seam the dashboard uses).
func exchangeForJWT(t *testing.T, cloudURL, sessionCookie string) string {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, cloudURL+"/v1/auth/session/token", nil)
	req.Header.Set("Cookie", "ory_kratos_session="+sessionCookie)
	req.Header.Set("Accept", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("session/token exchange: HTTP %d: %s", resp.StatusCode, raw)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("session/token decode: %v", err)
	}
	if out.AccessToken == "" {
		t.Fatal("session/token: empty access_token")
	}
	return out.AccessToken
}

// realLogin runs the full provision+login+exchange for an email and returns the JWT.
func realLogin(t *testing.T, cloudURL, kratosPublic, kratosAdmin, email string) string {
	t.Helper()
	provisionIdentity(t, kratosAdmin, email)
	cookie := loginViaKratos(t, kratosPublic, email)
	return exchangeForJWT(t, cloudURL, cookie)
}

// dashboardMemory POSTs to /v1/dashboard/memory/{verb} with the session JWT and
// returns (status, body).
func dashboardMemory(t *testing.T, cloudURL, jwt, verb string, payload map[string]any) (int, string) {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, cloudURL+"/v1/dashboard/memory/"+verb, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Content-Type", "application/json")
	resp := mustDo(t, req)
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

// T2.1 — the full chain happy path: real login -> JWT -> BFF memory write+read
// -> real broker -> real themory -> the written content comes back.
func TestFullChainE2E_RealLoginToMemory(t *testing.T) {
	cloudURL, kratosPublic, kratosAdmin := fcSkip(t)
	email := fcEmail("fullchain-solo")

	jwt := realLogin(t, cloudURL, kratosPublic, kratosAdmin, email) // FIRST assertion: a 401/502 here fails the test
	if jwt == "" {
		t.Fatal("real login yielded an empty JWT")
	}

	const marker = "fullchain canary alpha-7731 quantum ledger"
	if st, body := dashboardMemory(t, cloudURL, jwt, "remember", map[string]any{"text": marker}); !is2xx(st) {
		t.Fatalf("remember via real session JWT: HTTP %d: %s", st, body)
	}

	// Recall the same text; the real themory (via the broker-minted per-tenant key)
	// returns it. Retry briefly to absorb async indexing.
	var lastBody string
	for i := 0; i < 10; i++ {
		st, body := dashboardMemory(t, cloudURL, jwt, "recall", map[string]any{"query": marker, "topK": 10, "threshold": 0})
		if !is2xx(st) {
			t.Fatalf("recall: HTTP %d: %s", st, body)
		}
		lastBody = body
		if strings.Contains(body, "alpha-7731") {
			return // full chain proven end-to-end
		}
		time.Sleep(300 * time.Millisecond)
	}
	t.Fatalf("recall never returned the remembered marker through the real chain; last body: %s", lastBody)
}

// T2.2 — cross-tenant isolation on the REAL chain (real broker, NOT captureMinter):
// tenant-A's real session cannot read tenant-B's memory, and each reads its own.
func TestFullChainE2E_CrossTenantIsolationRealChain(t *testing.T) {
	cloudURL, kratosPublic, kratosAdmin := fcSkip(t)
	emailA, emailB := fcEmail("fullchain-alice"), fcEmail("fullchain-bob")

	jwtA := realLogin(t, cloudURL, kratosPublic, kratosAdmin, emailA)
	jwtB := realLogin(t, cloudURL, kratosPublic, kratosAdmin, emailB)

	const secretA = "alice private memory secret-zeta-9914"
	if st, body := dashboardMemory(t, cloudURL, jwtA, "remember", map[string]any{"text": secretA}); !is2xx(st) {
		t.Fatalf("A remember: HTTP %d: %s", st, body)
	}

	// Positive boundary: A recalls its own memory through the real chain.
	gotOwn := false
	for i := 0; i < 10; i++ {
		st, body := dashboardMemory(t, cloudURL, jwtA, "recall", map[string]any{"query": secretA, "topK": 10, "threshold": 0})
		if !is2xx(st) {
			t.Fatalf("A recall: HTTP %d: %s", st, body)
		}
		if strings.Contains(body, "secret-zeta-9914") {
			gotOwn = true
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if !gotOwn {
		t.Fatal("A could not recall its OWN memory through the real chain (positive boundary failed)")
	}

	// B's positive boundary: B writes its OWN secret and reads it back. This proves
	// B's real session + per-tenant mint genuinely store + return data — so B's
	// negative check below cannot pass vacuously (B's path is alive, not silently
	// empty/broken).
	const secretB = "bob private memory secret-omega-3382"
	if st, body := dashboardMemory(t, cloudURL, jwtB, "remember", map[string]any{"text": secretB}); !is2xx(st) {
		t.Fatalf("B remember: HTTP %d: %s", st, body)
	}
	gotOwnB := false
	for i := 0; i < 10; i++ {
		st, body := dashboardMemory(t, cloudURL, jwtB, "recall", map[string]any{"query": secretB, "topK": 10, "threshold": 0})
		if !is2xx(st) {
			t.Fatalf("B recall own: HTTP %d: %s", st, body)
		}
		if strings.Contains(body, "secret-omega-3382") {
			gotOwnB = true
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if !gotOwnB {
		t.Fatal("B could not recall its OWN memory through the real chain (B's path is not alive — negative would be vacuous)")
	}

	// Negative case: B (a DIFFERENT real session / tenant) must NOT see A's secret,
	// AND A must NOT see B's secret. Poll so a transient empty result can't mask a leak.
	for i := 0; i < 5; i++ {
		_, bBody := dashboardMemory(t, cloudURL, jwtB, "recall", map[string]any{"query": secretA, "topK": 20, "threshold": 0})
		if strings.Contains(bBody, "secret-zeta-9914") {
			t.Fatalf("ISOLATION BREACH: tenant B read tenant A's memory through the real chain: %s", bBody)
		}
		_, aBody := dashboardMemory(t, cloudURL, jwtA, "recall", map[string]any{"query": secretB, "topK": 20, "threshold": 0})
		if strings.Contains(aBody, "secret-omega-3382") {
			t.Fatalf("ISOLATION BREACH: tenant A read tenant B's memory through the real chain: %s", aBody)
		}
		time.Sleep(200 * time.Millisecond)
	}
}
