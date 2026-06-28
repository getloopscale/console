// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package consent

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// Red Team theo-cloud#117 closure — friendly "login link expired" page
// rendered on Hydra 404 instead of the previous silent empty-redirect →
// browser → /auth/login/ → 404 "Page not found".
//
// These tests pin the wiring contract: the consent.Handler MUST translate
// auth.ErrChallengeNotFound into a 410 Gone + canonical HTML body. The
// underlying typed error is set in internal/auth/hydra.go and pinned by
// the four `TestXxx_HydraReturns404_ReturnsError` tests in that package.

func newHandlerWithMockHydra(t *testing.T, hydraServerURL string) *Handler {
	t.Helper()
	h := NewHandler(
		auth.NewHydraClient(hydraServerURL, hydraServerURL, "theo-cli"),
		nil, // tenantProvisioner — unused on the expired-link path
		"http://kratos.example",
		"http://kratos.example",
		"http://kratos.example",
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	return h
}

func mockHydra404(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status_code":404,"message":"Not Found"}`))
	}))
}

func assertExpiredLinkResponse(t *testing.T, rec *httptest.ResponseRecorder, label string) {
	t.Helper()
	if rec.Code != http.StatusGone {
		t.Errorf("%s: status = %d, want 410 Gone", label, rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/html") {
		t.Errorf("%s: Content-Type = %q, want text/html prefix", label, ct)
	}
	body := rec.Body.String()
	// Canonical user-facing copy assertions.
	for _, want := range []string{
		"Your login link has expired",
		"<code>theo login</code>",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("%s: body missing %q\n--- body ---\n%s", label, want, body)
		}
	}
	// CR-9 compliance — no internal terms must leak into the user-facing page.
	for _, forbidden := range []string{"Hydra", "Kratos", "OAuth", "challenge_not_found"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("%s: body contains forbidden internal term %q", label, forbidden)
		}
	}
}

// 1) Login (GET /auth/login?login_challenge=...) — GetLoginRequest returns 404 from Hydra.
func TestLogin_ExpiredChallenge_RendersFriendlyPage_RedTeam117(t *testing.T) {
	srv := mockHydra404(t)
	defer srv.Close()

	h := newHandlerWithMockHydra(t, srv.URL)
	req := httptest.NewRequest("GET", "/auth/login?login_challenge=expired-or-replayed", nil)
	rec := httptest.NewRecorder()

	h.Login(rec, req)
	assertExpiredLinkResponse(t, rec, "Login")
}

// 2) LoginComplete (GET /auth/login/complete?login_challenge=...) — this is
//    THE canonical hit-path that surfaced the original CTO bug. Kratos
//    session present, but AcceptLogin returns 404 because the Hydra
//    challenge has already been consumed/expired.
func TestLoginComplete_ExpiredChallenge_RendersFriendlyPage_RedTeam117(t *testing.T) {
	// Two mock servers — one for Hydra (returns 404), one for Kratos
	// /sessions/whoami (returns an active session so we reach AcceptLogin).
	hydra := mockHydra404(t)
	defer hydra.Close()

	kratos := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/sessions/whoami") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"active":   true,
				"identity": map[string]interface{}{"id": "subject-1"},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer kratos.Close()

	h := NewHandler(
		auth.NewHydraClient(hydra.URL, hydra.URL, "theo-cli"),
		nil,
		kratos.URL,
		kratos.URL,
		kratos.URL,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	req := httptest.NewRequest("GET", "/auth/login/complete?login_challenge=expired-or-replayed", nil)
	rec := httptest.NewRecorder()

	h.LoginComplete(rec, req)
	assertExpiredLinkResponse(t, rec, "LoginComplete")
}

// 3) Consent (GET /auth/consent?consent_challenge=...) — GetConsentRequest returns 404.
func TestConsent_ExpiredChallenge_RendersFriendlyPage_RedTeam117(t *testing.T) {
	srv := mockHydra404(t)
	defer srv.Close()

	h := newHandlerWithMockHydra(t, srv.URL)
	req := httptest.NewRequest("GET", "/auth/consent?consent_challenge=expired-or-replayed", nil)
	rec := httptest.NewRecorder()

	h.Consent(rec, req)
	assertExpiredLinkResponse(t, rec, "Consent")
}

// Negative regression-protector: Hydra returns 500 (real outage), the handler
// MUST NOT render the friendly "link expired" page (would be misleading);
// it should keep returning 502 Bad Gateway like before.
func TestLogin_HydraInternalError_KeepsBadGatewayBehavior(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"status_code":500,"message":"internal error"}`))
	}))
	defer srv.Close()

	h := newHandlerWithMockHydra(t, srv.URL)
	req := httptest.NewRequest("GET", "/auth/login?login_challenge=irrelevant", nil)
	rec := httptest.NewRecorder()

	h.Login(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 Bad Gateway (real outage; NOT the expired-link path)", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "Your login link has expired") {
		t.Errorf("body falsely rendered expired-link page on Hydra 500")
	}
}
