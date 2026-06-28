// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Plan J-05 iter 5 (2026-06-05) — pin the Hydra v2 nested-client_id
// contract for both login and consent challenge responses. Catches the
// LIVE regression where Hydra emitted {"client":{"client_id":"theo-cli"}}
// and our struct decoded the flat `client_id` to an empty string,
// causing consent handler to reject "Unauthorized client".

func TestGetConsentRequest_ParsesNestedClientID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge": "abc",
			"client": map[string]interface{}{
				"client_id":   "theo-cli",
				"client_name": "Theo CLI",
			},
			"subject":                          "user-1",
			"requested_scope":                  []string{"openid"},
			"requested_access_token_audience":  []string{"theo-cloud"},
		})
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	got, err := c.GetConsentRequest("abc")
	if err != nil {
		t.Fatalf("GetConsentRequest: %v", err)
	}
	if got.ClientID != "theo-cli" {
		t.Fatalf("ClientID = %q, want %q", got.ClientID, "theo-cli")
	}
}

func TestGetConsentRequest_FlatClientIDStillWorks(t *testing.T) {
	// Backwards-compat — if any Hydra build still emits flat client_id,
	// we must NOT regress and return empty.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge": "abc",
			"client_id": "theo-cli",
			"subject":   "user-1",
		})
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	got, err := c.GetConsentRequest("abc")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got.ClientID != "theo-cli" {
		t.Fatalf("flat client_id lost: got %q", got.ClientID)
	}
}

func TestGetLoginRequest_ParsesNestedClientID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge": "abc",
			"client": map[string]interface{}{
				"client_id": "theo-cli",
			},
			"subject": "user-1",
			"skip":    false,
		})
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	got, err := c.GetLoginRequest("abc")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got.ClientID != "theo-cli" {
		t.Fatalf("ClientID = %q, want theo-cli", got.ClientID)
	}
}

func TestGetLoginRequest_FlatPreferredWhenBothPresent(t *testing.T) {
	// If both flat and nested are present, the flat value wins (existing
	// behavior — only promote nested when flat is empty).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge": "abc",
			"client_id": "from-flat",
			"client": map[string]interface{}{
				"client_id": "from-nested",
			},
			"subject": "u",
		})
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	got, _ := c.GetLoginRequest("abc")
	if got.ClientID != "from-flat" {
		t.Fatalf("flat should win when both present: got %q", got.ClientID)
	}
}

func TestRegisterClient_IncludesAudienceWhitelist(t *testing.T) {
	// Plan J-05 iter 6 — F-03 LIVE bug: without audience on the registration
	// payload, refresh_token grants fail with "Requested audience 'theo-cloud'
	// has not been whitelisted by the OAuth 2.0 Client" because the original
	// device-flow consent set aud=[theo-cloud,theo-engine] and Hydra
	// re-validates against the client registration on every refresh.
	var captured map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" && strings.Contains(r.URL.Path, "/admin/clients/theo-cli") {
			_ = json.NewDecoder(r.Body).Decode(&captured)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"client_id":"theo-cli"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	if err := c.RegisterClient([]string{"http://localhost:9876/auth"}); err != nil {
		t.Fatalf("RegisterClient: %v", err)
	}

	aud, ok := captured["audience"].([]interface{})
	if !ok {
		t.Fatalf("audience field missing or wrong type: %T %v", captured["audience"], captured["audience"])
	}
	got := make([]string, len(aud))
	for i, v := range aud {
		got[i], _ = v.(string)
	}

	for _, want := range []string{"theo-cloud", "theo-engine"} {
		found := false
		for _, g := range got {
			if g == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("audience missing %q (got %v)", want, got)
		}
	}
}

func TestGetConsentRequest_NeitherFlatNorNested_StaysEmpty(t *testing.T) {
	// When Hydra emits neither key, ClientID stays empty — consent
	// handler will (correctly) reject. This pins the failure mode.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"challenge":"abc","subject":"u"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	got, _ := c.GetConsentRequest("abc")
	if got.ClientID != "" {
		t.Fatalf("expected empty ClientID, got %q", got.ClientID)
	}
	if !strings.HasPrefix(got.Challenge, "abc") {
		t.Fatalf("challenge stamp lost: %q", got.Challenge)
	}
}

// Red Team theo-cloud#117 closure — silent error swallow.
//
// Hydra returns 404 when a login/consent challenge is expired, replayed, or
// otherwise unknown (canonical body: {"status_code":404,"message":"Not Found"}).
// All four challenge-API wrappers used to call json.Decode straight on the
// response body without checking resp.StatusCode — the decoder returned
// `RedirectTo: ""` (no field match) with `err == nil`, so callers issued
// `http.Redirect(w, r, "", 302)` which the browser interpreted as relative
// empty → navigated to `/auth/login/` (trailing slash) → 404 "Page not found".
//
// The CTO hit this LIVE on 2026-06-28 after his actual login already
// succeeded (logs show consent auto-approved); the misleading 404 made him
// believe the login_challenge surface was broken when really the silent
// swallow turned an EXPIRED-CHALLENGE error into "Page not found".
//
// These tests pin the contract: every Hydra challenge-API function MUST
// return a non-nil error when Hydra responds with 4xx/5xx. The fix path
// is a single `if resp.StatusCode >= 400 { return ..., fmt.Errorf(...) }`
// sentinel BEFORE the JSON decode.

func TestGetLoginRequest_HydraReturns404_ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status_code":404,"message":"Not Found"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	_, err := c.GetLoginRequest("expired-or-replayed")
	if err == nil {
		t.Fatal("GetLoginRequest returned nil error on Hydra 404 — silent swallow regression (#117)")
	}
}

func TestAcceptLogin_HydraReturns404_ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status_code":404,"message":"Not Found"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	redirectTo, err := c.AcceptLogin("expired-or-replayed", "subject-1")
	if err == nil {
		t.Fatalf("AcceptLogin returned nil error on Hydra 404 (redirectTo=%q) — silent swallow regression (#117)", redirectTo)
	}
	if redirectTo != "" {
		// Defensive: callers must NOT navigate to anything when err != nil,
		// but if the fix later starts returning a non-empty value alongside
		// the error, downstream Redirect call could leak it. Belt + braces.
		t.Errorf("AcceptLogin returned non-empty redirectTo (%q) alongside error — caller may still navigate", redirectTo)
	}
}

func TestGetConsentRequest_HydraReturns404_ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status_code":404,"message":"Not Found"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	_, err := c.GetConsentRequest("expired-consent-challenge")
	if err == nil {
		t.Fatal("GetConsentRequest returned nil error on Hydra 404 — silent swallow regression (#117)")
	}
}

func TestAcceptConsent_HydraReturns404_ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status_code":404,"message":"Not Found"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	redirectTo, err := c.AcceptConsent("expired-consent-challenge", []string{"openid"}, nil, nil)
	if err == nil {
		t.Fatalf("AcceptConsent returned nil error on Hydra 404 (redirectTo=%q) — silent swallow regression (#117)", redirectTo)
	}
	if redirectTo != "" {
		t.Errorf("AcceptConsent returned non-empty redirectTo (%q) alongside error — caller may still navigate", redirectTo)
	}
}

// Negative-case sanity: when Hydra responds 200 with the canonical
// {redirect_to:"..."} body, AcceptLogin / AcceptConsent MUST return the
// URL and err == nil. Guards against an over-zealous fix that rejects
// the happy path.

func TestAcceptLogin_HydraReturns200WithRedirectTo_ReturnsURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"redirect_to":"https://hydra.example/oauth2/auth?login_verifier=xyz"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	redirectTo, err := c.AcceptLogin("valid-challenge", "subject-1")
	if err != nil {
		t.Fatalf("happy-path AcceptLogin returned error: %v", err)
	}
	if !strings.HasPrefix(redirectTo, "https://hydra.example/") {
		t.Fatalf("happy-path redirectTo lost: got %q", redirectTo)
	}
}

func TestAcceptConsent_HydraReturns200WithRedirectTo_ReturnsURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"redirect_to":"https://hydra.example/oauth2/auth?consent_verifier=xyz"}`))
	}))
	defer srv.Close()

	c := NewHydraClient(srv.URL, srv.URL, "theo-cli")
	redirectTo, err := c.AcceptConsent("valid-challenge", []string{"openid"}, nil, nil)
	if err != nil {
		t.Fatalf("happy-path AcceptConsent returned error: %v", err)
	}
	if !strings.HasPrefix(redirectTo, "https://hydra.example/") {
		t.Fatalf("happy-path redirectTo lost: got %q", redirectTo)
	}
}
