// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/auth"
)

const (
	ghTestDashboardURL = "https://app.example.test"
	ghTestCallbackURL  = "https://app.example.test/v1/integrations/github/callback"
	ghTestLoginURL     = "https://auth.example.test/login"
	ghTestClientID     = "Iv1.testclientid"
	ghTestAppSlug      = "loopscale-test"
	// ghTestOAuthCode stands for the one-time code GitHub hands the callback. The
	// tests search the logs and every redirect for it.
	ghTestOAuthCode = "gho-code-5f1c9e7a"
)

var ghTestUser = &auth.UserContext{Subject: "user-1", Email: "dev@example.test", TenantID: "tenant-1"}

type fakeSessions struct {
	user *auth.UserContext
	err  error
}

func (f fakeSessions) Authenticate(*http.Request) (*auth.UserContext, error) {
	return f.user, f.err
}

type claimCall struct {
	user *auth.UserContext
	code string
}

type fakeClaimer struct {
	installations int
	err           error
	calls         []claimCall
}

func (f *fakeClaimer) ClaimInstallations(_ context.Context, user *auth.UserContext, code string) (int, error) {
	f.calls = append(f.calls, claimCall{user: user, code: code})
	return f.installations, f.err
}

func newHandler(t *testing.T, sessions auth.SessionAuthenticator, claimer GitHubInstallationClaimer) *GitHubIntegrationsHandler {
	t.Helper()
	if sessions == nil {
		sessions = fakeSessions{user: ghTestUser}
	}
	if claimer == nil {
		claimer = &fakeClaimer{}
	}
	return NewGitHubIntegrationsHandler(GitHubIntegrationsConfig{
		AppSlug:      ghTestAppSlug,
		AppClientID:  ghTestClientID,
		DashboardURL: ghTestDashboardURL,
		CallbackURL:  ghTestCallbackURL,
		LoginURL:     ghTestLoginURL,
		Sessions:     sessions,
		Claimer:      claimer,
	}).WithInsecureCookieForTests()
}

// startInstall runs InitiateInstall and returns the state it set.
func startInstall(t *testing.T, h *GitHubIntegrationsHandler, returnTo string) (state string, w *httptest.ResponseRecorder) {
	t.Helper()
	target := "/v1/integrations/github/install"
	if returnTo != "" {
		target += "?return_to=" + url.QueryEscape(returnTo)
	}
	w = httptest.NewRecorder()
	h.InitiateInstall(w, httptest.NewRequest(http.MethodGet, target, nil))
	if w.Code != http.StatusFound {
		t.Fatalf("InitiateInstall: status = %d, want 302", w.Code)
	}
	state = cookieValue(w, stateCookieName)
	if state == "" {
		t.Fatalf("InitiateInstall did not set the %s cookie", stateCookieName)
	}
	return state, w
}

func cookieValue(w *httptest.ResponseRecorder, name string) string {
	value := ""
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			value = c.Value
		}
	}
	return value
}

// callback sends the GitHub return with the state cookies of a started flow.
func callback(h *GitHubIntegrationsHandler, query url.Values, cookieState, returnTo string, extra ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/v1/integrations/github/callback?"+query.Encode(), nil)
	if cookieState != "" {
		req.AddCookie(&http.Cookie{Name: stateCookieName, Value: cookieState})
	}
	if returnTo != "" {
		req.AddCookie(&http.Cookie{Name: returnToCookieName, Value: returnTo})
	}
	for _, c := range extra {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.Callback(w, req)
	return w
}

func mustLocation(t *testing.T, w *httptest.ResponseRecorder) *url.URL {
	t.Helper()
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body = %s", w.Code, w.Body.String())
	}
	loc, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatalf("Location does not parse: %v", err)
	}
	return loc
}

func mustDecodeError(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	return body
}

// captureLogs routes the default logger to a buffer for the duration of a test.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &buf
}

func TestInitiateInstall_RedirectsToUserAuthorizationWithStateAndClientID(t *testing.T) {
	h := newHandler(t, nil, nil)
	state, w := startInstall(t, h, "/projects/demo/connect")

	if len(state) != 64 {
		t.Fatalf("state token length = %d, want 64 (32 bytes, hex)", len(state))
	}
	if got := cookieValue(w, returnToCookieName); got != "/projects/demo/connect" {
		t.Fatalf("return_to cookie = %q, want /projects/demo/connect", got)
	}
	loc := mustLocation(t, w)
	if got := loc.Scheme + "://" + loc.Host + loc.Path; got != "https://github.com/login/oauth/authorize" {
		t.Fatalf("Location = %q, want the GitHub authorize page", got)
	}
	q := loc.Query()
	if q.Get("client_id") != ghTestClientID {
		t.Fatalf("client_id = %q, want %q", q.Get("client_id"), ghTestClientID)
	}
	if q.Get("state") != state {
		t.Fatalf("state = %q, want the cookie's %q", q.Get("state"), state)
	}
	if q.Get("redirect_uri") != ghTestCallbackURL {
		t.Fatalf("redirect_uri = %q, want %q", q.Get("redirect_uri"), ghTestCallbackURL)
	}
}

func TestInitiateInstall_UsesTheConfiguredGitHubWebBase(t *testing.T) {
	h := NewGitHubIntegrationsHandler(GitHubIntegrationsConfig{
		AppSlug: ghTestAppSlug, AppClientID: ghTestClientID, GitHubWebBaseURL: "https://github.internal.test/",
		DashboardURL: ghTestDashboardURL, CallbackURL: ghTestCallbackURL, LoginURL: ghTestLoginURL,
	})
	_, w := startInstall(t, h, "")
	if loc := w.Header().Get("Location"); !strings.HasPrefix(loc, "https://github.internal.test/login/oauth/authorize?") {
		t.Fatalf("Location = %q, want the configured web base", loc)
	}
}

func TestInitiateInstall_WithoutClientID_ReturnsToDashboardWithError(t *testing.T) {
	h := NewGitHubIntegrationsHandler(GitHubIntegrationsConfig{
		AppSlug: ghTestAppSlug, DashboardURL: ghTestDashboardURL, CallbackURL: ghTestCallbackURL, LoginURL: ghTestLoginURL,
	})
	w := httptest.NewRecorder()
	h.InitiateInstall(w, httptest.NewRequest(http.MethodGet, "/v1/integrations/github/install?return_to=%2Fprojects%2Fdemo%2Fconnect", nil))
	loc := mustLocation(t, w)
	if loc.Host != "app.example.test" || loc.Path != "/projects/demo/connect" {
		t.Fatalf("Location = %q, want the dashboard connect page", loc)
	}
	if got := loc.Query().Get("github_error"); got != "GITHUB_OAUTH_NOT_CONFIGURED" {
		t.Fatalf("github_error = %q, want GITHUB_OAUTH_NOT_CONFIGURED", got)
	}
}

func TestInitiateInstall_DefaultReturnToWhenAbsent(t *testing.T) {
	h := newHandler(t, nil, nil)
	_, w := startInstall(t, h, "")
	if got := cookieValue(w, returnToCookieName); got != "/projects" {
		t.Fatalf("return_to fallback = %q, want /projects", got)
	}
}

func TestInitiateInstall_EachStartGetsItsOwnState(t *testing.T) {
	h := newHandler(t, nil, nil)
	state1, _ := startInstall(t, h, "")
	state2, _ := startInstall(t, h, "")
	if state1 == state2 {
		t.Fatalf("expected distinct tokens, got the same: %q", state1)
	}
}

func TestInitiateInstall_StateCookieAttributesAreSafe(t *testing.T) {
	// Built without WithInsecureCookieForTests: this is the production shape.
	h := NewGitHubIntegrationsHandler(GitHubIntegrationsConfig{
		AppSlug: ghTestAppSlug, AppClientID: ghTestClientID,
		DashboardURL: ghTestDashboardURL, CallbackURL: ghTestCallbackURL, LoginURL: ghTestLoginURL,
	})
	w := httptest.NewRecorder()
	h.InitiateInstall(w, httptest.NewRequest(http.MethodGet, "/v1/integrations/github/install", nil))
	seen := false
	for _, c := range w.Result().Cookies() {
		if c.Name != stateCookieName {
			continue
		}
		seen = true
		if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.MaxAge != stateCookieTTL {
			t.Fatalf("state cookie = %+v, want HttpOnly, Secure, SameSite=Lax, MaxAge=%d", c, stateCookieTTL)
		}
	}
	if !seen {
		t.Fatal("no state cookie set")
	}
}

func TestCallback_StateMismatch_RefusedWithoutClaim(t *testing.T) {
	claimer := &fakeClaimer{installations: 1}
	h := newHandler(t, nil, claimer)
	state, _ := startInstall(t, h, "")

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {"another-state"}}, state, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if code, _ := mustDecodeError(t, w)["code"].(string); code != "STATE_MISMATCH" {
		t.Fatalf("code = %q, want STATE_MISMATCH", code)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) on a state mismatch, want 0", len(claimer.calls))
	}
}

func TestCallback_StateWithoutCookie_RefusedWithoutClaim(t *testing.T) {
	claimer := &fakeClaimer{installations: 1}
	h := newHandler(t, nil, claimer)

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {"forged"}}, "", "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) without a state cookie, want 0", len(claimer.calls))
	}
}

func TestCallback_WithoutState_RestartsAuthorizationAndDropsTheCode(t *testing.T) {
	// GitHub returns here without state when the App is installed from
	// github.com. That code has no state to check, so it is not used.
	claimer := &fakeClaimer{installations: 1}
	h := newHandler(t, nil, claimer)

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "installation_id": {"42"}, "setup_action": {"install"}}, "", "")
	loc := mustLocation(t, w)
	if loc.Host != "github.com" || loc.Path != "/login/oauth/authorize" {
		t.Fatalf("Location = %q, want the GitHub authorize page", loc)
	}
	if state := cookieValue(w, stateCookieName); state == "" || loc.Query().Get("state") != state {
		t.Fatalf("authorize state %q does not match the new cookie %q", loc.Query().Get("state"), state)
	}
	if strings.Contains(loc.String(), ghTestOAuthCode) {
		t.Fatalf("Location = %q carries the code", loc)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) with no state, want 0", len(claimer.calls))
	}
}

func TestCallback_UnknownSetupAction_400(t *testing.T) {
	h := newHandler(t, nil, nil)
	state, _ := startInstall(t, h, "")
	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}, "setup_action": {"bogus"}}, state, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if code, _ := mustDecodeError(t, w)["code"].(string); code != "UNKNOWN_SETUP_ACTION" {
		t.Fatalf("code = %q, want UNKNOWN_SETUP_ACTION", code)
	}
}

func TestCallback_CodeIsClaimedAsTheSignedInUser(t *testing.T) {
	claimer := &fakeClaimer{installations: 2}
	h := newHandler(t, fakeSessions{user: ghTestUser}, claimer)
	state, _ := startInstall(t, h, "/projects/demo/connect")

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}}, state, "/projects/demo/connect")

	if len(claimer.calls) != 1 {
		t.Fatalf("claim ran %d time(s), want 1", len(claimer.calls))
	}
	call := claimer.calls[0]
	if call.code != ghTestOAuthCode {
		t.Fatalf("claimed code = %q, want the callback's code", call.code)
	}
	if call.user == nil || call.user.Subject != "user-1" || call.user.TenantID != "tenant-1" {
		t.Fatalf("claim identity = %+v, want user-1 of tenant-1", call.user)
	}
	loc := mustLocation(t, w)
	if loc.String() != ghTestDashboardURL+"/projects/demo/connect" {
		t.Fatalf("Location = %q, want the connect page with no extra query", loc)
	}
	for _, name := range []string{stateCookieName, returnToCookieName, afterInstallCookieName} {
		cleared := false
		for _, c := range w.Result().Cookies() {
			if c.Name == name && c.MaxAge < 0 {
				cleared = true
			}
		}
		if !cleared {
			t.Fatalf("cookie %s was not cleared after the claim", name)
		}
	}
}

func TestCallback_AccessUpdate_ReturnsWithUpdatedFlag(t *testing.T) {
	h := newHandler(t, nil, &fakeClaimer{installations: 1})
	state, _ := startInstall(t, h, "")
	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}, "installation_id": {"42"}, "setup_action": {"update"}}, state, "/projects/demo/connect")
	loc := mustLocation(t, w)
	if loc.Path != "/projects/demo/connect" || loc.Query().Get("updated") != "1" {
		t.Fatalf("Location = %q, want the connect page with updated=1", loc)
	}
	if loc.Query().Has("installation_id") {
		t.Fatalf("Location = %q must not carry installation_id", loc)
	}
}

func TestCallback_EmptyClaim_SendsTheUserToTheAppInstallPage(t *testing.T) {
	h := newHandler(t, nil, &fakeClaimer{installations: 0})
	state, _ := startInstall(t, h, "/projects/demo/connect")

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}}, state, "/projects/demo/connect")

	loc := mustLocation(t, w)
	if got := loc.Scheme + "://" + loc.Host + loc.Path; got != "https://github.com/apps/"+ghTestAppSlug+"/installations/new" {
		t.Fatalf("Location = %q, want the App install page", got)
	}
	newState := cookieValue(w, stateCookieName)
	if newState == "" || loc.Query().Get("state") != newState {
		t.Fatalf("install page state %q does not match the cookie %q", loc.Query().Get("state"), newState)
	}
	if got := cookieValue(w, returnToCookieName); got != "/projects/demo/connect" {
		t.Fatalf("return_to cookie = %q, want it kept for the way back", got)
	}
}

func TestCallback_EmptyClaimAfterInstall_ReturnsToDashboardWithErrorAndNoLoop(t *testing.T) {
	h := newHandler(t, nil, &fakeClaimer{installations: 0})
	state, _ := startInstall(t, h, "")

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}, "installation_id": {"42"}, "setup_action": {"install"}}, state, "/projects/demo/connect")

	loc := mustLocation(t, w)
	if loc.Host != "app.example.test" || loc.Path != "/projects/demo/connect" {
		t.Fatalf("Location = %q, want the dashboard, not GitHub again", loc)
	}
	if got := loc.Query().Get("github_error"); got != "NO_INSTALLATION" {
		t.Fatalf("github_error = %q, want NO_INSTALLATION", got)
	}
}

func TestCallback_InstallWithoutCode_AuthorizesOnceThenStopsOnEmptyClaim(t *testing.T) {
	// An App that does not request authorization during installation returns
	// from the install with no code. The callback asks for the authorization
	// and remembers the install, so a second empty claim ends the flow.
	claimer := &fakeClaimer{installations: 0}
	h := newHandler(t, nil, claimer)
	state, _ := startInstall(t, h, "")

	first := callback(h, url.Values{"state": {state}, "installation_id": {"42"}, "setup_action": {"install"}}, state, "/projects/demo/connect")
	loc := mustLocation(t, first)
	if loc.Path != "/login/oauth/authorize" {
		t.Fatalf("Location = %q, want the GitHub authorize page", loc)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) without a code, want 0", len(claimer.calls))
	}
	marker := cookieValue(first, afterInstallCookieName)
	if marker == "" {
		t.Fatalf("the %s cookie was not set", afterInstallCookieName)
	}

	nextState := cookieValue(first, stateCookieName)
	second := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {nextState}}, nextState, "/projects/demo/connect",
		&http.Cookie{Name: afterInstallCookieName, Value: marker})
	loc = mustLocation(t, second)
	if loc.Host != "app.example.test" || loc.Query().Get("github_error") != "NO_INSTALLATION" {
		t.Fatalf("Location = %q, want the dashboard with NO_INSTALLATION", loc)
	}
}

func TestCallback_ClaimError_MapsToDashboardErrorCode(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"code rejected", &GitHubClaimError{Code: "GITHUB_CODE_REJECTED"}, "GITHUB_CODE_REJECTED"},
		{"member role", &GitHubClaimError{Code: "INSUFFICIENT_ROLE"}, "INSUFFICIENT_ROLE"},
		{"rate limited", &GitHubClaimError{Code: "RATE_LIMITED"}, "RATE_LIMITED"},
		{"github down", &GitHubClaimError{Code: "GITHUB_UNAVAILABLE"}, "GITHUB_UNAVAILABLE"},
		{"not configured", &GitHubClaimError{Code: "GITHUB_OAUTH_NOT_CONFIGURED"}, "GITHUB_OAUTH_NOT_CONFIGURED"},
		{"engine unreachable", &GitHubClaimError{Code: "SERVICE_UNAVAILABLE"}, "SERVICE_UNAVAILABLE"},
		{"unknown code is not echoed", &GitHubClaimError{Code: "<script>alert(1)</script>"}, "INTERNAL_ERROR"},
		{"untyped error", errors.New("boom " + ghTestOAuthCode), "INTERNAL_ERROR"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandler(t, nil, &fakeClaimer{err: tc.err})
			state, _ := startInstall(t, h, "")
			w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}}, state, "/projects/demo/connect")
			loc := mustLocation(t, w)
			if loc.Host != "app.example.test" || loc.Path != "/projects/demo/connect" {
				t.Fatalf("Location = %q, want the dashboard connect page", loc)
			}
			if got := loc.Query().Get("github_error"); got != tc.want {
				t.Fatalf("github_error = %q, want %q", got, tc.want)
			}
			if len(loc.Query()) != 1 {
				t.Fatalf("Location = %q, want github_error as the only parameter", loc)
			}
		})
	}
}

func TestCallback_AuthorizationDenied_ReturnsToDashboardWithError(t *testing.T) {
	claimer := &fakeClaimer{}
	h := newHandler(t, nil, claimer)
	state, _ := startInstall(t, h, "")
	w := callback(h, url.Values{"error": {"access_denied"}, "error_description": {"The user denied"}, "state": {state}}, state, "/projects/demo/connect")
	loc := mustLocation(t, w)
	if got := loc.Query().Get("github_error"); got != "AUTHORIZATION_DENIED" {
		t.Fatalf("github_error = %q, want AUTHORIZATION_DENIED", got)
	}
	if strings.Contains(loc.String(), "denied") && !strings.Contains(loc.String(), "AUTHORIZATION_DENIED") {
		t.Fatalf("Location = %q echoes GitHub's text", loc)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) after a denial, want 0", len(claimer.calls))
	}
}

func TestCallback_NeitherCodeNorInstall_400(t *testing.T) {
	h := newHandler(t, nil, nil)
	state, _ := startInstall(t, h, "")
	w := callback(h, url.Values{"state": {state}}, state, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if code, _ := mustDecodeError(t, w)["code"].(string); code != "MISSING_CODE" {
		t.Fatalf("code = %q, want MISSING_CODE", code)
	}
}

func TestCallback_SessionExpired_RedirectsToLoginWithoutTheCode(t *testing.T) {
	claimer := &fakeClaimer{installations: 1}
	h := newHandler(t, fakeSessions{err: auth.ErrNoSession}, claimer)
	state, _ := startInstall(t, h, "")

	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}}, state, "/projects/demo/connect")

	loc := mustLocation(t, w)
	if !strings.HasPrefix(loc.String(), ghTestLoginURL+"?return_to=") {
		t.Fatalf("Location = %q, want the login page", loc)
	}
	if got := loc.Query().Get("return_to"); got != ghTestDashboardURL+"/projects/demo/connect" {
		t.Fatalf("return_to = %q, want the connect page", got)
	}
	if strings.Contains(loc.String(), ghTestOAuthCode) {
		t.Fatalf("Location = %q carries the code", loc)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) with no session, want 0", len(claimer.calls))
	}
}

func TestCallback_SessionCheckFailure_ReturnsToDashboardWithError(t *testing.T) {
	claimer := &fakeClaimer{installations: 1}
	h := newHandler(t, fakeSessions{err: auth.ErrIdentityProviderUnavailable}, claimer)
	state, _ := startInstall(t, h, "")
	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}}, state, "/projects/demo/connect")
	if got := mustLocation(t, w).Query().Get("github_error"); got != "SERVICE_UNAVAILABLE" {
		t.Fatalf("github_error = %q, want SERVICE_UNAVAILABLE", got)
	}
	if len(claimer.calls) != 0 {
		t.Fatalf("claim ran %d time(s) with an unchecked session, want 0", len(claimer.calls))
	}
}

func TestCallback_CodeNeverReachesLogsOrRedirects(t *testing.T) {
	outcomes := map[string]*fakeClaimer{
		"claimed":     {installations: 1},
		"empty":       {installations: 0},
		"claim error": {err: &GitHubClaimError{Code: "GITHUB_UNAVAILABLE", Err: errors.New("engine answered 502")}},
		"untyped":     {err: errors.New("unexpected")},
	}
	for name, claimer := range outcomes {
		t.Run(name, func(t *testing.T) {
			logs := captureLogs(t)
			h := newHandler(t, nil, claimer)
			state, _ := startInstall(t, h, "")
			for _, query := range []url.Values{
				{"code": {ghTestOAuthCode}, "state": {state}},
				{"code": {ghTestOAuthCode}, "state": {state}, "installation_id": {"42"}, "setup_action": {"install"}},
			} {
				w := callback(h, query, state, "/projects/demo/connect")
				if loc := w.Header().Get("Location"); strings.Contains(loc, ghTestOAuthCode) {
					t.Fatalf("Location = %q carries the code", loc)
				}
				if strings.Contains(w.Body.String(), ghTestOAuthCode) {
					t.Fatalf("response body carries the code: %s", w.Body.String())
				}
				for _, c := range w.Result().Cookies() {
					if strings.Contains(c.Value, ghTestOAuthCode) {
						t.Fatalf("cookie %s carries the code", c.Name)
					}
				}
			}
			if strings.Contains(logs.String(), ghTestOAuthCode) {
				t.Fatalf("logs carry the code:\n%s", logs.String())
			}
		})
	}
}

func TestCallback_ReturnToCookie_DefendsAgainstOpenRedirect(t *testing.T) {
	h := newHandler(t, nil, &fakeClaimer{installations: 1})
	state, _ := startInstall(t, h, "")
	w := callback(h, url.Values{"code": {ghTestOAuthCode}, "state": {state}}, state, "https://evil.example/x")
	loc := w.Header().Get("Location")
	if !strings.HasPrefix(loc, ghTestDashboardURL+"/") {
		t.Fatalf("Location = %q, want it anchored to the dashboard origin", loc)
	}
	if strings.Contains(loc, "evil.example") {
		t.Fatalf("Location = %q leaks the hostile host", loc)
	}
}
