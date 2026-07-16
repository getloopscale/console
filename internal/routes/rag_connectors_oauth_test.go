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

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// --- stubs (the sandbox stand-in: the whole OAuth flow is proven without a real OAuth app) ---

type stubExchanger struct {
	refresh    string
	err        error
	gotCode    string
	gotVerify  string
	gotProv    string
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

func newOAuthBroker(ex TokenExchanger, cp connectPoster) *RagConnectorsOAuthHandler {
	providers := map[string]OAuthProviderConfig{
		"google-drive": {AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", ClientID: "cid-123", Scopes: "drive.readonly"},
	}
	return NewRagConnectorsOAuthHandler(providers, cp, ex,
		"https://cloud-dev.usetheo.dev/v1/dashboard/rag/connectors", "https://app-dev.usetheo.dev", "",
		slog.New(slog.NewTextHandler(io.Discard, nil))).WithInsecureCookieForTests()
}

func authed(r *http.Request) *http.Request {
	return r.WithContext(auth.WithUser(context.Background(), &auth.UserContext{TenantID: "t1"}))
}

// M8 — Authorize sets CSRF state + PKCE + collection cookies and redirects to the provider consent.
func TestRagConnectorsOAuth_Authorize_RedirectsWithPKCEAndState(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(authed(httptest.NewRequest(http.MethodGet, "/v1/dashboard/rag/connectors/google-drive/authorize?collection_id=col_1", nil)), "google-drive")
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

func TestRagConnectorsOAuth_Authorize_UnknownProvider_422(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(authed(httptest.NewRequest(http.MethodGet, "/x/github/authorize?collection_id=col_1", nil)), "github") // github is non-OAuth
	h.Authorize(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for a non-OAuth provider, got %d", w.Code)
	}
}

func TestRagConnectorsOAuth_Authorize_MissingCollection_422(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(authed(httptest.NewRequest(http.MethodGet, "/x/google-drive/authorize", nil)), "google-drive")
	h.Authorize(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for missing collection_id, got %d", w.Code)
	}
}

func TestRagConnectorsOAuth_Authorize_Unauthed_401(t *testing.T) {
	h := newOAuthBroker(&stubExchanger{}, &stubConnectPoster{})
	w := httptest.NewRecorder()
	req := withProvider(httptest.NewRequest(http.MethodGet, "/x/google-drive/authorize?collection_id=col_1", nil), "google-drive") // no auth
	h.Authorize(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without a tenant, got %d", w.Code)
	}
}

// M8 — Callback (sandbox): valid state → stub exchange → connect posts {collection_id, refresh_token}
// server-to-server, then redirects to the dashboard. Proves the whole flow with NO real OAuth app.
func TestRagConnectorsOAuth_Callback_HappyPath_ConnectsAndRedirects(t *testing.T) {
	ex := &stubExchanger{refresh: "refresh-xyz"}
	cp := &stubConnectPoster{}
	h := newOAuthBroker(ex, cp)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x/google-drive/callback?code=auth-code&state=STATE", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "STATE"})
	req.AddCookie(&http.Cookie{Name: oauthCollectionCookie, Value: "col_1"})
	req.AddCookie(&http.Cookie{Name: oauthVerifierCookie, Value: "verifier-xyz"})
	req = withProvider(authed(req), "google-drive")
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

func TestRagConnectorsOAuth_Callback_CSRFMismatch_403(t *testing.T) {
	cp := &stubConnectPoster{}
	h := newOAuthBroker(&stubExchanger{refresh: "x"}, cp)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x/google-drive/callback?code=c&state=ATTACKER", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "REAL"}) // param != cookie
	req.AddCookie(&http.Cookie{Name: oauthCollectionCookie, Value: "col_1"})
	req.AddCookie(&http.Cookie{Name: oauthVerifierCookie, Value: "v"})
	req = withProvider(authed(req), "google-drive")
	h.Callback(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403 on state mismatch (CSRF), got %d", w.Code)
	}
	if cp.calls != 0 {
		t.Fatalf("connect MUST NOT run on a CSRF mismatch, got %d calls", cp.calls)
	}
}

func TestRagConnectorsOAuth_Callback_ExchangeFails_502(t *testing.T) {
	cp := &stubConnectPoster{}
	h := newOAuthBroker(&stubExchanger{err: context.DeadlineExceeded}, cp)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x/google-drive/callback?code=c&state=S", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "S"})
	req.AddCookie(&http.Cookie{Name: oauthCollectionCookie, Value: "col_1"})
	req.AddCookie(&http.Cookie{Name: oauthVerifierCookie, Value: "v"})
	req = withProvider(authed(req), "google-drive")
	h.Callback(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("want 502 when the provider token exchange fails, got %d", w.Code)
	}
	if cp.calls != 0 {
		t.Fatalf("connect MUST NOT run when exchange fails, got %d calls", cp.calls)
	}
}
