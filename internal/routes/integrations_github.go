// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/getloopscale/loop-console/internal/auth"
	cloudmetrics "github.com/getloopscale/loop-console/internal/metrics"
)

// GitHubInstallationClaimer asks the engine to bind to the user's tenant the
// App installations GitHub confirms that user can access. It returns how many
// installations the tenant has after the claim.
type GitHubInstallationClaimer interface {
	ClaimInstallations(ctx context.Context, user *auth.UserContext, code string) (int, error)
}

// GitHubIntegrationsConfig holds what the connect handshake needs.
type GitHubIntegrationsConfig struct {
	// AppSlug names the App's install page: <web base>/apps/<slug>/installations/new.
	AppSlug string
	// AppClientID is the App's OAuth client id. Empty disables the handshake.
	AppClientID string
	// GitHubWebBaseURL is the GitHub web root. Empty means https://github.com.
	GitHubWebBaseURL string
	// DashboardURL is the dashboard origin the browser returns to.
	DashboardURL string
	// CallbackURL is the public URL of Callback, registered on the App as a
	// user authorization callback URL.
	CallbackURL string
	// LoginURL receives the browser when the session ended during the flow.
	LoginURL string
	// CookieDomain is the Domain attribute of the flow cookies. Empty is host-only.
	CookieDomain string
	Sessions     auth.SessionAuthenticator
	Claimer      GitHubInstallationClaimer
}

// GitHubIntegrationsHandler implements the GitHub connect handshake:
//
//	(1) GET /v1/integrations/github/install?return_to=...
//	    Sets a CSRF state cookie and sends the browser to GitHub's user
//	    authorization page for the App.
//	(2) GET /v1/integrations/github/callback?code=...&state=...
//	    Checks the state, then hands the code to the engine as the signed-in
//	    user. The engine binds the installations GitHub confirms that user can
//	    access. With at least one bound the browser returns to the dashboard,
//	    which lists them. With none it goes to the App's install page once, and
//	    GitHub returns here again after the install.
//
// The code is used once, server side. It is never logged and never placed in a
// redirect, a cookie or a response body. The dashboard reads the installations
// from the engine and takes no installation id from a URL.
type GitHubIntegrationsHandler struct {
	cfg          GitHubIntegrationsConfig
	cookieSecure bool // false only in tests
}

// NewGitHubIntegrationsHandler wires the handler.
func NewGitHubIntegrationsHandler(cfg GitHubIntegrationsConfig) *GitHubIntegrationsHandler {
	cfg.GitHubWebBaseURL = strings.TrimRight(cfg.GitHubWebBaseURL, "/")
	if cfg.GitHubWebBaseURL == "" {
		cfg.GitHubWebBaseURL = "https://github.com"
	}
	return &GitHubIntegrationsHandler{cfg: cfg, cookieSecure: true}
}

// WithInsecureCookieForTests disables the Secure attribute so cookies survive
// httptest's plain HTTP. Production callers MUST NOT touch this.
func (h *GitHubIntegrationsHandler) WithInsecureCookieForTests() *GitHubIntegrationsHandler {
	h.cookieSecure = false
	return h
}

const (
	stateCookieName    = "loopscale_gh_connect_state"
	returnToCookieName = stateCookieName + "_return_to"
	// afterInstallCookieName marks a flow that already went through the App's
	// install page, so an empty claim ends it instead of sending the user to
	// install again.
	afterInstallCookieName = stateCookieName + "_after_install"
	stateCookieTTL         = 600 // seconds

	defaultReturnTo = "/projects"
)

// Values of the github_error parameter the dashboard turns into a message.
const (
	githubErrorNoInstallation      = "NO_INSTALLATION"
	githubErrorAuthorizationDenied = "AUTHORIZATION_DENIED"
	githubErrorNotConfigured       = "GITHUB_OAUTH_NOT_CONFIGURED"
	githubErrorServiceUnavailable  = "SERVICE_UNAVAILABLE"
	githubErrorInternal            = "INTERNAL_ERROR"
)

// claimErrorCodes are the claim failures the dashboard has a message for. Any
// other value becomes INTERNAL_ERROR, so nothing an upstream wrote reaches the
// redirect URL.
var claimErrorCodes = map[string]bool{
	"INVALID_REQUEST":             true,
	"GITHUB_CODE_REJECTED":        true,
	"UNAUTHORIZED":                true,
	"INSUFFICIENT_ROLE":           true,
	"RATE_LIMITED":                true,
	"GITHUB_UNAVAILABLE":          true,
	githubErrorNotConfigured:      true,
	githubErrorServiceUnavailable: true,
	githubErrorInternal:           true,
}

// InitiateInstall starts the handshake.
// GET /v1/integrations/github/install?return_to=/projects/{name}/connect
func (h *GitHubIntegrationsHandler) InitiateInstall(w http.ResponseWriter, r *http.Request) {
	returnTo := r.URL.Query().Get("return_to")
	if returnTo == "" {
		returnTo = defaultReturnTo
	}
	h.startAuthorization(w, r, returnTo, false)
}

// startAuthorization sets the flow cookies and sends the browser to GitHub's
// user authorization page.
func (h *GitHubIntegrationsHandler) startAuthorization(w http.ResponseWriter, r *http.Request, returnTo string, afterInstall bool) {
	if h.cfg.AppClientID == "" {
		slog.Error("github connect: GITHUB_APP_CLIENT_ID is not set")
		http.Redirect(w, r, h.dashboardURL(returnTo, githubErrorNotConfigured), http.StatusFound)
		return
	}
	state, ok := h.setFlowCookies(w, returnTo, afterInstall)
	if !ok {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not start the GitHub authorization. Try again.")
		return
	}
	q := url.Values{}
	q.Set("client_id", h.cfg.AppClientID)
	q.Set("state", state)
	q.Set("redirect_uri", h.cfg.CallbackURL)
	http.Redirect(w, r, h.cfg.GitHubWebBaseURL+"/login/oauth/authorize?"+q.Encode(), http.StatusFound)
}

// setFlowCookies issues a new state and (re)starts the ten minute window.
func (h *GitHubIntegrationsHandler) setFlowCookies(w http.ResponseWriter, returnTo string, afterInstall bool) (string, bool) {
	state, err := newStateToken()
	if err != nil {
		slog.Error("github connect: state token generation failed", "error", err)
		return "", false
	}
	h.setCookie(w, stateCookieName, state)
	h.setCookie(w, returnToCookieName, returnTo)
	if afterInstall {
		h.setCookie(w, afterInstallCookieName, "1")
	}
	return state, true
}

func (h *GitHubIntegrationsHandler) setCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Domain:   h.cfg.CookieDomain,
		MaxAge:   stateCookieTTL,
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *GitHubIntegrationsHandler) clearFlowCookies(w http.ResponseWriter) {
	for _, name := range []string{stateCookieName, returnToCookieName, afterInstallCookieName} {
		clearCookie(w, name, h.cfg.CookieDomain, h.cookieSecure)
	}
}

// Callback receives the browser back from GitHub, after the user authorization
// and after an App install.
// GET /v1/integrations/github/callback
func (h *GitHubIntegrationsHandler) Callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	setupAction := q.Get("setup_action")
	switch setupAction {
	case "", "install", "update", "request":
	default:
		writeError(w, http.StatusBadRequest, "UNKNOWN_SETUP_ACTION", "Unrecognised install state. Please retry.")
		return
	}
	returnTo := h.returnToPath(r)

	// GitHub returns without state when the App was installed or reconfigured
	// from github.com. A code that arrives with no state cannot be tied to
	// this browser, so it is dropped and the authorization starts here.
	queryState := q.Get("state")
	if queryState == "" {
		h.startAuthorization(w, r, returnTo, setupAction != "")
		return
	}
	stateCookie, err := r.Cookie(stateCookieName)
	if err != nil || stateCookie.Value == "" || stateCookie.Value != queryState {
		writeError(w, http.StatusBadRequest, "STATE_MISMATCH",
			"The GitHub authorization session does not match or has expired. Start again from the dashboard.")
		return
	}

	user, ok := h.signedInUser(w, r, returnTo)
	if !ok {
		return
	}

	if q.Get("error") != "" {
		h.finish(w, r, returnTo, githubErrorAuthorizationDenied)
		return
	}

	afterInstall := setupAction != ""
	if c, cErr := r.Cookie(afterInstallCookieName); cErr == nil && c.Value != "" {
		afterInstall = true
	}

	code := q.Get("code")
	if code == "" {
		if setupAction == "" {
			writeError(w, http.StatusBadRequest, "MISSING_CODE", "The GitHub authorization did not complete. Please retry.")
			return
		}
		// The App returned from its install page without a code: it does not
		// request the authorization during installation. Ask for it now.
		h.startAuthorization(w, r, returnTo, true)
		return
	}

	installations, err := h.claim(r.Context(), user, code)
	if err != nil {
		h.finish(w, r, returnTo, claimErrorCode(err))
		return
	}
	if installations > 0 {
		if setupAction == "install" || setupAction == "update" {
			cloudmetrics.IncGitHubAppInstallation(setupAction)
		}
		h.clearFlowCookies(w)
		dest := h.dashboardURL(returnTo, "")
		if setupAction == "update" {
			dest = withQueryParam(dest, "updated", "1")
		}
		http.Redirect(w, r, dest, http.StatusFound)
		return
	}
	if afterInstall {
		// The user came back from the install page and GitHub still reports no
		// installation they can access. Sending them there again would loop.
		h.finish(w, r, returnTo, githubErrorNoInstallation)
		return
	}
	state, ok := h.setFlowCookies(w, returnTo, false)
	if !ok {
		h.finish(w, r, returnTo, githubErrorInternal)
		return
	}
	installPage := h.cfg.GitHubWebBaseURL + "/apps/" + url.PathEscape(h.cfg.AppSlug) + "/installations/new?state=" + url.QueryEscape(state)
	http.Redirect(w, r, installPage, http.StatusFound)
}

// signedInUser resolves the caller from the session cookie. On failure it has
// already answered: the login page when there is no session, the dashboard
// with an error otherwise.
func (h *GitHubIntegrationsHandler) signedInUser(w http.ResponseWriter, r *http.Request, returnTo string) (*auth.UserContext, bool) {
	if h.cfg.Sessions == nil {
		slog.Error("github connect: no session authenticator configured")
		h.finish(w, r, returnTo, githubErrorInternal)
		return nil, false
	}
	user, err := h.cfg.Sessions.Authenticate(r)
	switch {
	case err == nil && user != nil:
		return user, true
	case errors.Is(err, auth.ErrNoSession):
		// The code is single use and short lived, so it is not carried through
		// the login. The user starts the authorization again from the page.
		h.clearFlowCookies(w)
		http.Redirect(w, r, h.cfg.LoginURL+"?return_to="+url.QueryEscape(h.dashboardURL(returnTo, "")), http.StatusFound)
		return nil, false
	case errors.Is(err, auth.ErrIdentityProviderUnavailable):
		slog.Warn("github connect: session could not be checked", "error", err)
		h.finish(w, r, returnTo, githubErrorServiceUnavailable)
		return nil, false
	default:
		slog.Error("github connect: caller could not be resolved", "error", err)
		h.finish(w, r, returnTo, githubErrorInternal)
		return nil, false
	}
}

func (h *GitHubIntegrationsHandler) claim(ctx context.Context, user *auth.UserContext, code string) (int, error) {
	if h.cfg.Claimer == nil {
		return 0, &GitHubClaimError{Code: githubErrorInternal, Err: errors.New("no claimer configured")}
	}
	n, err := h.cfg.Claimer.ClaimInstallations(ctx, user, code)
	if err != nil {
		// Only the mapped code is logged. The error value may quote an upstream
		// answer, and the request's query holds the code.
		slog.Warn("github connect: claim failed", "code", claimErrorCode(err), "tenant", user.TenantID)
		return 0, err
	}
	return n, nil
}

// claimErrorCode maps a claim failure to a value the dashboard knows.
func claimErrorCode(err error) string {
	var claimErr *GitHubClaimError
	if errors.As(err, &claimErr) && claimErrorCodes[claimErr.Code] {
		return claimErr.Code
	}
	return githubErrorInternal
}

// finish ends the flow on the dashboard with an error code.
func (h *GitHubIntegrationsHandler) finish(w http.ResponseWriter, r *http.Request, returnTo, githubError string) {
	h.clearFlowCookies(w)
	http.Redirect(w, r, h.dashboardURL(returnTo, githubError), http.StatusFound)
}

// returnToPath reads the dashboard path the flow returns to.
func (h *GitHubIntegrationsHandler) returnToPath(r *http.Request) string {
	if c, err := r.Cookie(returnToCookieName); err == nil && c.Value != "" {
		return c.Value
	}
	return defaultReturnTo
}

// dashboardURL anchors returnTo under the dashboard origin and, when
// githubError is set, adds it as the github_error parameter.
func (h *GitHubIntegrationsHandler) dashboardURL(returnTo, githubError string) string {
	path, ok := safeDashboardPath(returnTo)
	if !ok {
		path = defaultReturnTo
	}
	dest := h.cfg.DashboardURL + path
	if githubError != "" {
		dest = withQueryParam(dest, "github_error", githubError)
	}
	return dest
}

func withQueryParam(rawURL, key, value string) string {
	sep := "?"
	if strings.Contains(rawURL, "?") {
		sep = "&"
	}
	return rawURL + sep + url.QueryEscape(key) + "=" + url.QueryEscape(value)
}

// safeDashboardPath returns the value as a dashboard-anchored path if it is
// a plain relative path (e.g. "/projects/demo/connect"). Anything that
// could parse as a URL with scheme or host -- including protocol-relative
// URLs like "//evil.com/x" -- is rejected so the caller falls back to the
// safe default. EC-4 of plan J-09 (open-redirect defense via return_to
// cookie injection).
func safeDashboardPath(raw string) (string, bool) {
	if raw == "" {
		return "", false
	}
	// Reject anything that smells like a URL or backslash escape.
	if strings.Contains(raw, "://") || strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\x00") {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	if u.Scheme != "" || u.Host != "" {
		return "", false
	}
	path := u.RequestURI() // strips fragment/normalises
	if path == "" {
		return "", false
	}
	if path[0] != '/' {
		path = "/" + path
	}
	return path, true
}

func clearCookie(w http.ResponseWriter, name, domain string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		Domain:   domain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func newStateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
