// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	loopscalejwt "github.com/getloopscale/contracts/jwt"

	"github.com/getloopscale/loop-console/internal/auth"
)

// getloopscale/loopscale#477 step 3: the dashboard holds no token. loop-console is its
// Backend for Frontend and authenticates each browser request from the Kratos
// session cookie, server-side. These cases pin the negative half of that
// contract, one behaviour each.

type tenantByIdentity map[string]string

func (m tenantByIdentity) EnsureTenant(_ context.Context, identityID, _ string) (string, string, string, error) {
	tid, ok := m[identityID]
	if !ok {
		return "", "", "", errors.New("identity has no tenant")
	}
	return tid, "acct-" + tid, "owner", nil
}

// fakeKratos answers /sessions/whoami for the session cookie values it knows.
type fakeKratos struct {
	srv   *httptest.Server
	calls atomic.Int32
}

func newFakeKratos(t *testing.T, sessions map[string]string) *fakeKratos {
	t.Helper()
	fk := &fakeKratos{}
	fk.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fk.calls.Add(1)
		c, err := r.Cookie("ory_kratos_session")
		identity, known := "", false
		if err == nil {
			identity, known = sessions[c.Value]
		}
		if !known {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"active":true,"identity":{"id":%q,"traits":{"email":"%s@example.com","name":"User %s"}}}`, identity, identity, identity)
	}))
	t.Cleanup(fk.srv.Close)
	return fk
}

type reached struct {
	called bool
	user   *auth.UserContext
}

func chain(t *testing.T, kratosURL string, sess *loopscalejwt.SessionTokenIssuer) (http.Handler, *reached) {
	t.Helper()
	state := &reached{}
	sentinel := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state.called = true
		state.user = auth.GetUser(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	sessions := auth.NewKratosSessionAuthenticator(kratosURL, tenantByIdentity{"id-a": "tenant-a", "id-b": "tenant-b"})
	return auth.RequireCaller(nil, sess, sessions)(sentinel), state
}

func withSession(req *http.Request, value string) *http.Request {
	req.AddCookie(&http.Cookie{Name: "ory_kratos_session", Value: value})
	return req
}

func TestRequireCaller_RejectsRequestWithoutCookieOrBearer(t *testing.T) {
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/dashboard/storage/usage", nil))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if state.called {
		t.Fatal("handler reached without any credential")
	}
	if kratos.calls.Load() != 0 {
		t.Errorf("identity provider called %d times for a request carrying no cookie", kratos.calls.Load())
	}
}

func TestRequireCaller_AuthenticatesTheTenantOfTheSessionCookie(t *testing.T) {
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, withSession(httptest.NewRequest(http.MethodGet, "/v1/dashboard/storage/usage", nil), "sess-a"))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", w.Code, w.Body.String())
	}
	if state.user == nil || state.user.Subject != "id-a" || state.user.TenantID != "tenant-a" || state.user.AccountID != "acct-tenant-a" {
		t.Fatalf("user context = %+v, want subject id-a in tenant-a", state.user)
	}
}

func TestRequireCaller_RejectsAnUnknownSessionCookie(t *testing.T) {
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, withSession(httptest.NewRequest(http.MethodGet, "/x", nil), "forged"))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if state.called {
		t.Fatal("handler reached with a session the identity provider refused")
	}
}

func TestRequireCaller_ReportsAnUnreachableIdentityProviderAsBadGatewayNotAsLogout(t *testing.T) {
	// A 401 tells the dashboard the session ENDED and sends the person to /login.
	// An outage must not say that.
	h, state := chain(t, "http://192.0.2.1:1", nil) // TEST-NET-1, unroutable

	w := httptest.NewRecorder()
	h.ServeHTTP(w, withSession(httptest.NewRequest(http.MethodGet, "/x", nil), "sess-a"))

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
	if state.called {
		t.Fatal("handler reached while the session could not be checked")
	}
}

func TestRequireCaller_IgnoresATokenInTheQueryString(t *testing.T) {
	issuer := loopscalejwt.NewSessionTokenIssuer("test-secret-at-least-32-bytes-long-ok!", "loop-console", "loop-console", time.Hour)
	token, _, err := issuer.Issue("id-a", "a@example.com", "A", "tenant-a", "")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	kratos := newFakeKratos(t, map[string]string{})
	h, state := chain(t, kratos.srv.URL, issuer)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/engine/api/v1/builds/b1/logs/stream?token="+token, nil))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — a credential in a URL must not authenticate", w.Code)
	}
	if state.called {
		t.Fatal("handler reached on a query-string token")
	}
}

func TestRequireCaller_RefusesACrossSitePostCarryingTheSessionCookie(t *testing.T) {
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	req := withSession(httptest.NewRequest(http.MethodPost, "https://app.example.com/v1/api-keys/", strings.NewReader(`{}`)), "sess-a")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Origin", "https://attacker.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if state.called {
		t.Fatal("a cross-site request mutated state with the victim's cookie")
	}
}

func TestRequireCaller_RefusesACrossOriginPostFromABrowserWithoutFetchMetadata(t *testing.T) {
	// Older browsers send Origin but not Sec-Fetch-Site; the Origin fallback applies.
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	req := withSession(httptest.NewRequest(http.MethodDelete, "https://app.example.com/v1/api-keys/k1", nil), "sess-a")
	req.Header.Set("Origin", "https://attacker.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if state.called {
		t.Fatal("a cross-origin request mutated state with the victim's cookie")
	}
}

func TestRequireCaller_RefusesASameSiteSiblingOriginPost(t *testing.T) {
	// The Kratos cookie is scoped to the parent domain, so SameSite alone lets a
	// sibling subdomain send it. Same-origin, not same-site, is the bar.
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	req := withSession(httptest.NewRequest(http.MethodPost, "https://app.example.com/v1/billing/checkout", nil), "sess-a")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	req.Header.Set("Origin", "https://docs.example.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if state.called {
		t.Fatal("a sibling-subdomain request mutated state with the session cookie")
	}
}

func TestRequireCaller_AcceptsASameOriginPostCarryingTheSessionCookie(t *testing.T) {
	kratos := newFakeKratos(t, map[string]string{"sess-a": "id-a"})
	h, state := chain(t, kratos.srv.URL, nil)

	req := withSession(httptest.NewRequest(http.MethodPost, "https://app.example.com/v1/api-keys/", strings.NewReader(`{}`)), "sess-a")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Origin", "https://app.example.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", w.Code, w.Body.String())
	}
	if !state.called {
		t.Fatal("the dashboard's own POST was refused")
	}
}

func TestRequireCaller_IgnoresTenantHintsSuppliedByTheClient(t *testing.T) {
	kratos := newFakeKratos(t, map[string]string{"sess-b": "id-b"})
	h, state := chain(t, kratos.srv.URL, nil)

	req := withSession(httptest.NewRequest(http.MethodGet, "/engine/api/v1/projects?tenant_id=tenant-a", nil), "sess-b")
	req.Header.Set("X-Theo-Tenant", "tenant-a")
	req.Header.Set("X-Theo-User-ID", "id-a")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if state.user == nil || state.user.TenantID != "tenant-b" || state.user.Subject != "id-b" {
		t.Fatalf("user context = %+v, want id-b in tenant-b — the cookie decides, not the request", state.user)
	}
}

func TestRequireCaller_KeepsAcceptingABearerToken(t *testing.T) {
	// The CLI and the remaining scripts send a Bearer; step 4 removes the HS256 half.
	issuer := loopscalejwt.NewSessionTokenIssuer("test-secret-at-least-32-bytes-long-ok!", "loop-console", "loop-console", time.Hour)
	token, _, err := issuer.Issue("id-cli", "cli@example.com", "CLI", "tenant-cli", "")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	kratos := newFakeKratos(t, map[string]string{})
	h, state := chain(t, kratos.srv.URL, issuer)

	req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK || state.user == nil || state.user.TenantID != "tenant-cli" {
		t.Fatalf("status = %d user = %+v, want 200 in tenant-cli", w.Code, state.user)
	}
	if kratos.calls.Load() != 0 {
		t.Errorf("a Bearer request consulted the identity provider %d times", kratos.calls.Load())
	}
}
