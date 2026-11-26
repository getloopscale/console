// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/auth"
)

// fullSessionKratos answers whoami with the shape Ory really returns, including
// the fields the browser must never receive.
func fullSessionKratos(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie("ory_kratos_session"); err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"active":true,"identity":{"id":"id-1","schema_url":"https://x/schema",
			"traits":{"email":"u@example.com","name":"A User"},
			"verifiable_addresses":[{"value":"u@example.com","verified":false,"via":"email","status":"sent"}],
			"recovery_addresses":[{"value":"u@example.com","via":"email"}]},
			"authentication_methods":[{"method":"oidc","provider":"google","aal":"aal1"}],
			"devices":[{"ip_address":"177.185.23.136","user_agent":"Mozilla/5.0"}]}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func getSession(t *testing.T, h *SessionIdentityHandler, cookie bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/auth/session", nil)
	if cookie {
		req.AddCookie(&http.Cookie{Name: "ory_kratos_session", Value: "s"})
	}
	w := httptest.NewRecorder()
	h.Get(w, req)
	return w
}

func TestSessionIdentity_ReturnsTheIdentityTheDashboardReads(t *testing.T) {
	h := NewSessionIdentityHandler(auth.NewKratosSessionAuthenticator(fullSessionKratos(t).URL, nil))

	w := getSession(t, h, true)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Identity auth.SessionIdentity `json:"identity"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Identity.ID != "id-1" || body.Identity.Email != "u@example.com" || body.Identity.Name != "A User" {
		t.Fatalf("identity = %+v", body.Identity)
	}
	if len(body.Identity.AuthenticationMethods) != 1 || body.Identity.AuthenticationMethods[0].Provider != "google" {
		t.Fatalf("authentication_methods = %+v", body.Identity.AuthenticationMethods)
	}
	if len(body.Identity.VerifiableAddresses) != 1 || body.Identity.VerifiableAddresses[0].Verified {
		t.Fatalf("verifiable_addresses = %+v", body.Identity.VerifiableAddresses)
	}
}

func TestSessionIdentity_CarriesNoCredential(t *testing.T) {
	h := NewSessionIdentityHandler(auth.NewKratosSessionAuthenticator(fullSessionKratos(t).URL, nil))

	w := getSession(t, h, true)

	for _, forbidden := range []string{"access_token", "token_type", "expires_in", "ip_address", "recovery_addresses", "schema_url"} {
		if strings.Contains(w.Body.String(), forbidden) {
			t.Errorf("response carries %q: %s", forbidden, w.Body.String())
		}
	}
}

func TestSessionIdentity_WithoutACookieIs401(t *testing.T) {
	h := NewSessionIdentityHandler(auth.NewKratosSessionAuthenticator(fullSessionKratos(t).URL, nil))

	w := getSession(t, h, false)

	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "AUTH_REQUIRED") {
		t.Fatalf("status = %d body=%s, want 401 AUTH_REQUIRED", w.Code, w.Body.String())
	}
}

func TestSessionIdentity_UnreachableIdentityProviderIs502(t *testing.T) {
	h := NewSessionIdentityHandler(auth.NewKratosSessionAuthenticator("http://192.0.2.1:1", nil))

	w := getSession(t, h, true)

	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "AUTH_SERVICE_UNAVAILABLE") {
		t.Fatalf("status = %d body=%s, want 502 AUTH_SERVICE_UNAVAILABLE", w.Code, w.Body.String())
	}
}
