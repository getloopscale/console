package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// authed sets a Bearer-JWT tenant on the request context — used by ListOAuthProviders (a Bearer API
// the dashboard fetches). The authorize/callback halves use the cookie-session resolver instead.
func authed(r *http.Request) *http.Request {
	return r.WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1", AccountID: "acc1"}))
}

// --- stubs (the sandbox stand-in: the whole OAuth flow is proven without a real OAuth app) ---

type stubExchanger struct {
	refresh   string
	err       error
	gotCode   string
	gotVerify string
	gotProv   string
}

func (s *stubExchanger) Exchange(_ context.Context, provider, code, codeVerifier, _ string) (string, error) {
	s.gotProv, s.gotCode, s.gotVerify = provider, code, codeVerifier
	return s.refresh, s.err
}

type stubConnectPoster struct {
	gotProvider string
	gotBody     string
	err         error
	calls       int
}

func (s *stubConnectPoster) ConnectConnector(_ context.Context, provider string, body json.RawMessage) (json.RawMessage, error) {
	s.calls++
	s.gotProvider, s.gotBody = provider, string(body)
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"id":"conn_1"}`), nil
}

// resolveTenant stubs — the browser-session auth for authorize/callback (#199).
func okResolver(_ *http.Request) (accountID, tenantID string, ok bool) { return "acc1", "t1", true }
func noResolver(_ *http.Request) (accountID, tenantID string, ok bool) { return "", "", false }

const (
	testLoginURL     = "https://app-dev.usetheo.dev/login"
	testDashboardURL = "https://app-dev.usetheo.dev"
)

func newOAuthBroker(ex TokenExchanger, cp connectPoster) *RagConnectorsOAuthHandler {
	return newOAuthBrokerR(ex, cp, okResolver)
}

func newOAuthBrokerR(ex TokenExchanger, cp connectPoster, resolve SessionTenantResolver) *RagConnectorsOAuthHandler {
	providers := map[string]OAuthProviderConfig{
		"google-drive": {AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", ClientID: "cid-123", Scopes: "drive.readonly"},
	}
	return NewRagConnectorsOAuthHandler(providers, cp, ex, resolve,
		"https://cloud-dev.usetheo.dev/v1/rag-connect", testDashboardURL, testLoginURL, "",
		slog.New(slog.NewTextHandler(io.Discard, nil))).WithInsecureCookieForTests()
}

// M8 — Authorize sets CSRF state + PKCE + collection cookies and redirects to the provider consent.
func TestRagConnectorsOAuth_Authorize_RedirectsWithPKCEAndState(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/authorize?collection_id=col_1", nil), "google-drive")
	h.Authorize(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("want 302, got %d (%s)", w.Code, w.Body.String())
	}
	loc := w.Header().Get("Location")
	for _, want := range []string{"accounts.google.com", "client_id=cid-123", "code_challenge=", "code_challenge_method=S256", "state=", "response_type=code", "redirect_uri="} {
		if !strings.Contains(loc, want) {
			t.Fatalf("consent URL missing %q: %s", want, loc)
		}
	}
	cookies := map[string]bool{}
	for _, c := range w.Result().Cookies() {
		cookies[c.Name] = c.Value != ""
	}
	for _, n := range []string{oauthStateCookie, oauthCollectionCookie, oauthVerifierCookie} {
		if !cookies[n] {
			t.Fatalf("missing/empty cookie %q", n)
		}
	}
}

func TestRagConnectorsOAuth_Authorize_UnknownProvider_RedirectsErr(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(httptest.NewRequest(http.MethodGet, "/v1/rag-connect/github/authorize?collection_id=col_1", nil), "github") // github is non-OAuth
	h.Authorize(w, req)
	if w.Code != http.StatusFound || !strings.Contains(w.Header().Get("Location"), "connect_error=unknown_provider") {
		t.Fatalf("want 302 → connect_error=unknown_provider for a non-OAuth provider, got %d %q", w.Code, w.Header().Get("Location"))
	}
}

func TestRagConnectorsOAuth_Authorize_MissingCollection_RedirectsErr(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/authorize", nil), "google-drive")
	h.Authorize(w, req)
	if w.Code != http.StatusFound || !strings.Contains(w.Header().Get("Location"), "connect_error=missing_collection") {
		t.Fatalf("want 302 → connect_error=missing_collection, got %d %q", w.Code, w.Header().Get("Location"))
	}
}

// #199 — no session cookie → the browser is sent to sign in (NOT a 401 JSON blob it can't act on).
func TestRagConnectorsOAuth_Authorize_Unauthed_RedirectsToLogin(t *testing.T) {
	h := newOAuthBrokerR(&stubExchanger{}, &stubConnectPoster{}, noResolver)
	w := httptest.NewRecorder()
	req := withProvider(httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/authorize?collection_id=col_1", nil), "google-drive")
	h.Authorize(w, req)
	if w.Code != http.StatusFound || w.Header().Get("Location") != testLoginURL {
		t.Fatalf("want 302 → %s without a session, got %d %q", testLoginURL, w.Code, w.Header().Get("Location"))
	}
}

// M8 — Callback (sandbox): valid state → stub exchange → connect posts {collection_id, refresh_token}
// server-to-server as the COOKIE-RESOLVED tenant, then redirects to the dashboard. No real OAuth app.
func TestRagConnectorsOAuth_Callback_HappyPath_ConnectsAndRedirects(t *testing.T) {
	ex := &stubExchanger{refresh: "refresh-xyz"}
	cp := &stubConnectPoster{}
	h := newOAuthBroker(ex, cp)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/callback?code=auth-code&state=STATE", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "STATE"})
	req.AddCookie(&http.Cookie{Name: oauthCollectionCookie, Value: "col_1"})
	req.AddCookie(&http.Cookie{Name: oauthVerifierCookie, Value: "verifier-xyz"})
	req = withProvider(req, "google-drive")
	h.Callback(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("want 302, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Location"), "/rag/connectors?connected=google-drive") {
		t.Fatalf("expected redirect to the dashboard connectors page, got %q", w.Header().Get("Location"))
	}
	if ex.gotCode != "auth-code" || ex.gotVerify != "verifier-xyz" || ex.gotProv != "google-drive" {
		t.Fatalf("exchange got wrong args: prov=%q code=%q verify=%q", ex.gotProv, ex.gotCode, ex.gotVerify)
	}
	if cp.calls != 1 || cp.gotProvider != "google-drive" {
		t.Fatalf("connect not called correctly: calls=%d provider=%q", cp.calls, cp.gotProvider)
	}
	var body map[string]string
	if err := json.Unmarshal([]byte(cp.gotBody), &body); err != nil {
		t.Fatalf("connect body not json: %v", err)
	}
	if body["collection_id"] != "col_1" || body["refresh_token"] != "refresh-xyz" {
		t.Fatalf("connect body wrong: %+v", body)
	}
}

func TestRagConnectorsOAuth_Callback_CSRFMismatch_RedirectsErr(t *testing.T) {
	cp := &stubConnectPoster{}
	h := newOAuthBroker(&stubExchanger{refresh: "x"}, cp)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/callback?code=c&state=ATTACKER", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "REAL"}) // param != cookie
	req.AddCookie(&http.Cookie{Name: oauthCollectionCookie, Value: "col_1"})
	req.AddCookie(&http.Cookie{Name: oauthVerifierCookie, Value: "v"})
	req = withProvider(req, "google-drive")
	h.Callback(w, req)
	if w.Code != http.StatusFound || !strings.Contains(w.Header().Get("Location"), "connect_error=state_mismatch") {
		t.Fatalf("want 302 → connect_error=state_mismatch on CSRF mismatch, got %d %q", w.Code, w.Header().Get("Location"))
	}
	if cp.calls != 0 {
		t.Fatalf("connect MUST NOT run on a CSRF mismatch, got %d calls", cp.calls)
	}
}

func TestRagConnectorsOAuth_Callback_ExchangeFails_RedirectsErr(t *testing.T) {
	cp := &stubConnectPoster{}
	h := newOAuthBroker(&stubExchanger{err: context.DeadlineExceeded}, cp)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/callback?code=c&state=S", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "S"})
	req.AddCookie(&http.Cookie{Name: oauthCollectionCookie, Value: "col_1"})
	req.AddCookie(&http.Cookie{Name: oauthVerifierCookie, Value: "v"})
	req = withProvider(req, "google-drive")
	h.Callback(w, req)
	if w.Code != http.StatusFound || !strings.Contains(w.Header().Get("Location"), "connect_error=provider_exchange_failed") {
		t.Fatalf("want 302 → connect_error=provider_exchange_failed when the exchange fails, got %d %q", w.Code, w.Header().Get("Location"))
	}
	if cp.calls != 0 {
		t.Fatalf("connect MUST NOT run when exchange fails, got %d calls", cp.calls)
	}
}

// #199 — the exact path the missing test would have surfaced: a callback with no session cookie
// must NOT connect and must send the browser to sign in.
func TestRagConnectorsOAuth_Callback_Unauthed_RedirectsToLogin(t *testing.T) {
	cp := &stubConnectPoster{}
	h := newOAuthBrokerR(&stubExchanger{refresh: "x"}, cp, noResolver)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/rag-connect/google-drive/callback?code=c&state=S", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "S"})
	req = withProvider(req, "google-drive")
	h.Callback(w, req)
	if w.Code != http.StatusFound || w.Header().Get("Location") != testLoginURL {
		t.Fatalf("want 302 → %s without a session, got %d %q", testLoginURL, w.Code, w.Header().Get("Location"))
	}
	if cp.calls != 0 {
		t.Fatalf("connect MUST NOT run without a session, got %d calls", cp.calls)
	}
}

// M8 Slice 3 — the connectors page needs to know WHICH OAuth providers are actually connectable
// (operator-gated), so it never renders a "Connect with X" button that would dead-end. This is a
// Bearer API (the dashboard fetches it), so it keeps the JWT auth check.
func TestRagConnectorsOAuth_ListProviders_ReturnsConfiguredSorted(t *testing.T) {
	providers := map[string]OAuthProviderConfig{
		"google-drive": {ClientID: "cid-1", Scopes: "drive.readonly"},
		"dropbox":      {ClientID: "cid-2"},
		"salesforce":   {}, // no ClientID → not registered → MUST be omitted
	}
	h := NewRagConnectorsOAuthHandler(providers, &stubConnectPoster{}, &stubExchanger{}, okResolver,
		"https://cloud-dev.usetheo.dev/v1/rag-connect", testDashboardURL, testLoginURL, "",
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	w := httptest.NewRecorder()
	h.ListOAuthProviders(w, authed(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/connectors/providers", nil)))

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	var out struct {
		Providers []string `json:"providers"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("body not json: %v", err)
	}
	if len(out.Providers) != 2 || out.Providers[0] != "dropbox" || out.Providers[1] != "google-drive" {
		t.Fatalf("want [dropbox google-drive] (configured, sorted), got %v", out.Providers)
	}
}

func TestRagConnectorsOAuth_ListProviders_Unauthed_401(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	h.ListOAuthProviders(w, httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/connectors/providers", nil)) // no Bearer
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without a tenant, got %d", w.Code)
	}
}

// The provider AuthorizeURL/TokenURL are overridable from env — a legitimate testability / self-hosted-
// IdP feature: staging can point a provider at a conformant OAuth2 server (e.g. Ory Hydra) instead of
// the public default, to exercise the full consent loop without a real third-party app. Absent env,
// the well-known defaults stand.
func TestLoadOAuthConnectorsFromEnv_URLOverride(t *testing.T) {
	env := map[string]string{
		"LOOPZERO_RAG_OAUTH_GOOGLE_DRIVE_CLIENT_ID":     "cid",
		"LOOPZERO_RAG_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET": "sec",
		"LOOPZERO_RAG_OAUTH_GOOGLE_DRIVE_AUTHORIZE_URL": "https://hydra.internal/oauth2/auth",
		"LOOPZERO_RAG_OAUTH_GOOGLE_DRIVE_TOKEN_URL":     "https://hydra.internal/oauth2/token",
		"LOOPZERO_RAG_OAUTH_GOOGLE_DRIVE_SCOPES":        "offline_access",
	}
	cfgs, secrets := LoadOAuthConnectorsFromEnv(func(k string) string { return env[k] })
	c, ok := cfgs["google-drive"]
	if !ok {
		t.Fatal("google-drive should be configured")
	}
	if c.AuthorizeURL != "https://hydra.internal/oauth2/auth" || c.TokenURL != "https://hydra.internal/oauth2/token" {
		t.Fatalf("URLs not overridden: authorize=%q token=%q", c.AuthorizeURL, c.TokenURL)
	}
	if c.ClientID != "cid" || c.Scopes != "offline_access" || secrets["google-drive"] != "sec" {
		t.Fatalf("client/scope/secret wrong: %+v secret=%q", c, secrets["google-drive"])
	}
}

// Without the URL-override envs, the well-known defaults are preserved.
func TestLoadOAuthConnectorsFromEnv_DefaultsWhenNoOverride(t *testing.T) {
	env := map[string]string{"LOOPZERO_RAG_OAUTH_GOOGLE_DRIVE_CLIENT_ID": "cid"}
	cfgs, _ := LoadOAuthConnectorsFromEnv(func(k string) string { return env[k] })
	c := cfgs["google-drive"]
	if c.AuthorizeURL != "https://accounts.google.com/o/oauth2/v2/auth" || c.TokenURL != "https://oauth2.googleapis.com/token" {
		t.Fatalf("defaults not preserved: %+v", c)
	}
}
