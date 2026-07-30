package routes

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// M8 — OAuth authorization broker for the RAG connectors.
//
// theo-rag's connect handler accepts ONLY a pre-obtained refresh_token by design ("the app
// secret + browser redirect live at the edge"). This broker is that edge: it runs the OAuth
// authorization-code flow ("Connect with X" → provider consent → callback → code→refresh_token
// exchange) and hands theo-rag the resulting refresh_token via the M8 connect proxy — so a real
// user can connect an OAuth data source from the dashboard, never hand-crafting a token.
//
// Security: the app `client_secret` lives ONLY in the injected TokenExchanger (never in the
// handler struct, never logged); the `refresh_token` never reaches the browser (server-to-server
// in Callback); CSRF is a signed, single-use, tenant-bound `state` cookie matched against the
// state query param (mirrors internal/routes/integrations_github.go); PKCE (S256) defends the
// code exchange. The token exchange is behind a seam so the whole flow is proven end-to-end in
// tests against a stub provider (the DoD's documented sandbox stand-in) with no real OAuth app.

// OAuthProviderConfig is the non-secret descriptor for one OAuth-refresh provider. `ClientID` is
// public (safe here); the `client_secret` is held by the TokenExchanger, never in this struct.
type OAuthProviderConfig struct {
	AuthorizeURL string // provider consent endpoint
	TokenURL     string // provider token endpoint (used by the default exchanger)
	ClientID     string // OAuth app client id (public)
	Scopes       string // space-separated scopes
}

// defaultOAuthProviders are theo-rag's OAuth-refresh providers with their well-known endpoints.
// ClientID/Scopes are filled from edge config (env) at wiring time — empty until the operator
// registers each OAuth app (the documented M8 operator gate). Non-OAuth providers (github/notion/
// slack/s3/web/zendesk) are NOT here — they use the paste-credential connect proxy directly.
func defaultOAuthProviders() map[string]OAuthProviderConfig {
	return map[string]OAuthProviderConfig{
		"google-drive":  {AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"},
		"gmail":         {AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"},
		"dropbox":       {AuthorizeURL: "https://www.dropbox.com/oauth2/authorize", TokenURL: "https://api.dropboxapi.com/oauth2/token"},
		"box":           {AuthorizeURL: "https://account.box.com/api/oauth2/authorize", TokenURL: "https://api.box.com/oauth2/token"},
		"microsoft-365": {AuthorizeURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", TokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token"},
		"salesforce":    {AuthorizeURL: "https://login.salesforce.com/services/oauth2/authorize", TokenURL: "https://login.salesforce.com/services/oauth2/token"},
		"confluence":    {AuthorizeURL: "https://auth.atlassian.com/authorize", TokenURL: "https://auth.atlassian.com/oauth/token"},
		"jira":          {AuthorizeURL: "https://auth.atlassian.com/authorize", TokenURL: "https://auth.atlassian.com/oauth/token"},
	}
}

// TokenExchanger swaps an authorization `code` for a long-lived `refresh_token` at the provider's
// token endpoint. Injected so the broker is proven end-to-end against a stub (sandbox stand-in);
// the default impl holds the client_secret and does the real HTTPS POST.
type TokenExchanger interface {
	Exchange(ctx context.Context, provider, code, codeVerifier, redirectURI string) (refreshToken string, err error)
}

// connectPoster is the minimal slice of the RAG DataClient the broker needs (POST connect).
type connectPoster interface {
	ConnectConnector(ctx context.Context, provider string, body json.RawMessage) (json.RawMessage, error)
}

// SessionTenantResolver resolves the tenant of the browser's session (Kratos cookie → whoami →
// tenant), used on the broker's browser-redirect endpoints which cannot carry a Bearer JWT.
// Returns ok=false when there is no valid session — the caller then redirects to login. Production
// wires this to KratosSessionTenantResolver.Resolve; tests stub it.
type SessionTenantResolver func(r *http.Request) (accountID, tenantID string, ok bool)

// RagConnectorsOAuthHandler runs the authorize + callback halves of the broker.
type RagConnectorsOAuthHandler struct {
	providers     map[string]OAuthProviderConfig
	client        connectPoster
	exchange      TokenExchanger
	resolveTenant SessionTenantResolver
	redirectBase  string // BFF origin + /v1/rag-connect (where the callback is mounted)
	dashboardURL  string // e.g. https://app-dev.usetheo.dev (the SPA — final redirect target)
	loginURL      string // where an unauthenticated browser is sent to sign in
	cookieDomain  string
	cookieSecure  bool
	logger        *slog.Logger
}

// NewRagConnectorsOAuthHandler wires the broker. `providers` carries the per-provider ClientID +
// Scopes from edge config; `exchange` holds the client_secrets; `resolveTenant` authenticates the
// browser session (the authorize/callback endpoints are top-level navigations, NOT Bearer APIs).
func NewRagConnectorsOAuthHandler(providers map[string]OAuthProviderConfig, client connectPoster, exchange TokenExchanger, resolveTenant SessionTenantResolver, redirectBase, dashboardURL, loginURL, cookieDomain string, logger *slog.Logger) *RagConnectorsOAuthHandler {
	return &RagConnectorsOAuthHandler{
		providers:     providers,
		client:        client,
		exchange:      exchange,
		resolveTenant: resolveTenant,
		redirectBase:  strings.TrimRight(redirectBase, "/"),
		dashboardURL:  strings.TrimRight(dashboardURL, "/"),
		loginURL:      loginURL,
		cookieDomain:  cookieDomain,
		cookieSecure:  true,
		logger:        logger,
	}
}

// WithInsecureCookieForTests disables Secure so cookies survive httptest's plain HTTP. Never in prod.
func (h *RagConnectorsOAuthHandler) WithInsecureCookieForTests() *RagConnectorsOAuthHandler {
	h.cookieSecure = false
	return h
}

// ListOAuthProviders serves GET /v1/dashboard/rag/connectors/providers — the sorted list of OAuth
// providers actually registered (ClientID present, the operator gate). The connectors page renders
// a "Connect with X" button only for these, so it never dead-ends on an unconfigured provider (422).
func (h *RagConnectorsOAuthHandler) ListOAuthProviders(w http.ResponseWriter, r *http.Request) {
	if !isAuthed(r) {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	out := make([]string, 0, len(h.providers))
	for name, cfg := range h.providers {
		if cfg.ClientID != "" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	writeJSON(w, http.StatusOK, map[string]any{"providers": out})
}

const (
	oauthStateCookie      = "theo_rag_oauth_state"
	oauthCollectionCookie = "theo_rag_oauth_collection"
	oauthVerifierCookie   = "theo_rag_oauth_verifier"
	oauthCookieTTL        = 600               // 10-minute consent window
	oauthCookiePath       = "/v1/rag-connect" // scope the CSRF/PKCE cookies to the broker path only
)

// newPKCE returns a high-entropy verifier + its S256 challenge (RFC 7636).
func newPKCE() (verifier, challenge string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func (h *RagConnectorsOAuthHandler) setCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: oauthCookiePath, Domain: h.cookieDomain,
		MaxAge: oauthCookieTTL, HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func (h *RagConnectorsOAuthHandler) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: oauthCookiePath, Domain: h.cookieDomain,
		MaxAge: -1, HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// redirectConnectErr sends the browser back to the dashboard connectors page with a typed
// connect_error (the page mirrors the ?connected= banner) — never a raw JSON blob on a navigation.
func (h *RagConnectorsOAuthHandler) redirectConnectErr(w http.ResponseWriter, r *http.Request, reason string) {
	http.Redirect(w, r, h.dashboardURL+"/rag/connectors?connect_error="+url.QueryEscape(reason), http.StatusFound)
}

// registered reports whether the provider is both known AND has a ClientID (operator-registered).
// The write path (authorize/callback) MUST match the advertised list (ListOAuthProviders).
func (h *RagConnectorsOAuthHandler) registered(provider string) (OAuthProviderConfig, bool) {
	cfg, ok := h.providers[provider]
	if !ok || cfg.ClientID == "" {
		return OAuthProviderConfig{}, false
	}
	return cfg, true
}

// Authorize serves GET /v1/rag-connect/{provider}/authorize?collection_id=X — a BROWSER top-level
// navigation authenticated by the Kratos SESSION COOKIE (not a Bearer JWT). It sets a CSRF state +
// PKCE + collection cookie and 302-redirects to the provider's consent screen.
func (h *RagConnectorsOAuthHandler) Authorize(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.resolveTenant(r); !ok {
		http.Redirect(w, r, h.loginURL, http.StatusFound) // no session → sign in, then retry
		return
	}
	provider := chi.URLParam(r, "provider")
	cfg, ok := h.registered(provider)
	if !ok {
		h.redirectConnectErr(w, r, "unknown_provider")
		return
	}
	collectionID := r.URL.Query().Get("collection_id")
	if collectionID == "" {
		h.redirectConnectErr(w, r, "missing_collection")
		return
	}
	state, err := newStateToken()
	if err != nil {
		h.redirectConnectErr(w, r, "internal")
		return
	}
	verifier, challenge, err := newPKCE()
	if err != nil {
		h.redirectConnectErr(w, r, "internal")
		return
	}
	h.setCookie(w, oauthStateCookie, state)
	h.setCookie(w, oauthCollectionCookie, collectionID)
	h.setCookie(w, oauthVerifierCookie, verifier)

	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", h.redirectBase+"/"+provider+"/callback")
	q.Set("response_type", "code")
	q.Set("scope", cfg.Scopes)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	q.Set("access_type", "offline") // Google/others: force a refresh_token
	q.Set("prompt", "consent")
	http.Redirect(w, r, cfg.AuthorizeURL+"?"+q.Encode(), http.StatusFound)
}

// Callback serves GET /v1/rag-connect/{provider}/callback?code=X&state=Y — a BROWSER redirect from
// the provider, authenticated by the Kratos SESSION COOKIE. It validates the CSRF state, exchanges
// code→refresh_token, then runs the connect AS THE COOKIE-RESOLVED TENANT (auth.WithUser, so the
// existing per-tenant key resolver applies) — never trusting a tenant carried in the browser.
func (h *RagConnectorsOAuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	accountID, tenantID, ok := h.resolveTenant(r)
	if !ok {
		http.Redirect(w, r, h.loginURL, http.StatusFound)
		return
	}
	provider := chi.URLParam(r, "provider")
	if _, ok := h.registered(provider); !ok {
		h.redirectConnectErr(w, r, "unknown_provider")
		return
	}
	// CSRF — the state query param MUST equal the state cookie (single-use, constant-time compare).
	stateParam := r.URL.Query().Get("state")
	stateCookie, _ := r.Cookie(oauthStateCookie)
	if stateParam == "" || stateCookie == nil || subtle.ConstantTimeCompare([]byte(stateParam), []byte(stateCookie.Value)) != 1 {
		h.redirectConnectErr(w, r, "state_mismatch")
		return
	}
	code := r.URL.Query().Get("code")
	collectionCookie, _ := r.Cookie(oauthCollectionCookie)
	verifierCookie, _ := r.Cookie(oauthVerifierCookie)
	if code == "" || collectionCookie == nil || collectionCookie.Value == "" || verifierCookie == nil || verifierCookie.Value == "" {
		h.redirectConnectErr(w, r, "context_expired")
		return
	}
	// Consume the single-use cookies immediately (on every terminal path from here).
	h.clearCookie(w, oauthStateCookie)
	h.clearCookie(w, oauthCollectionCookie)
	h.clearCookie(w, oauthVerifierCookie)

	refreshToken, err := h.exchange.Exchange(r.Context(), provider, code, verifierCookie.Value, h.redirectBase+"/"+provider+"/callback")
	if err != nil {
		h.logger.Warn("rag connectors oauth: token exchange failed", "provider", provider, "error", err)
		h.redirectConnectErr(w, r, "provider_exchange_failed")
		return
	}
	// Run the connect AS the cookie-resolved tenant: wrapping the context lets the existing
	// per-tenant key resolver mint the right key (the refresh_token is server-to-server, never
	// reaches the browser). The tenant comes from the session, NOT from any browser-supplied value.
	ctx := auth.WithUser(r.Context(), &auth.UserContext{TenantID: tenantID, AccountID: accountID})
	body, _ := json.Marshal(map[string]string{"collection_id": collectionCookie.Value, "refresh_token": refreshToken})
	if _, err := h.client.ConnectConnector(ctx, provider, json.RawMessage(body)); err != nil {
		h.logger.Warn("rag connectors oauth: connect failed", "provider", provider, "error", err)
		h.redirectConnectErr(w, r, "connect_failed")
		return
	}
	http.Redirect(w, r, h.dashboardURL+"/rag/connectors?connected="+url.QueryEscape(provider), http.StatusFound)
}

// isAuthed reports whether the request carries an authenticated tenant (JWT session).
func isAuthed(r *http.Request) bool {
	u := auth.GetUser(r.Context())
	return u != nil && u.TenantID != ""
}

// HTTPTokenExchanger is the production TokenExchanger: it POSTs the authorization code to the
// provider's token endpoint with the app's client_secret + PKCE verifier and reads refresh_token.
// The client_secret lives ONLY here (never in the handler, never logged).
type HTTPTokenExchanger struct {
	providers map[string]OAuthProviderConfig
	secrets   map[string]string // client_secret per provider (edge secret store)
	http      *http.Client
}

func NewHTTPTokenExchanger(providers map[string]OAuthProviderConfig, secrets map[string]string, hc *http.Client) *HTTPTokenExchanger {
	return &HTTPTokenExchanger{providers: providers, secrets: secrets, http: hc}
}

func (e *HTTPTokenExchanger) Exchange(ctx context.Context, provider, code, codeVerifier, redirectURI string) (string, error) {
	cfg, ok := e.providers[provider]
	if !ok {
		return "", &oauthError{"unknown oauth provider"}
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", e.secrets[provider])
	form.Set("redirect_uri", redirectURI)
	form.Set("code_verifier", codeVerifier)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := e.http.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return "", &oauthError{"provider token endpoint rejected the exchange"}
	}
	var out struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return "", err
	}
	if out.RefreshToken == "" {
		return "", &oauthError{"provider returned no refresh_token"}
	}
	return out.RefreshToken, nil
}

type oauthError struct{ msg string }

func (e *oauthError) Error() string { return e.msg }

// LoadOAuthConnectorsFromEnv builds the provider config + secrets from the edge environment.
// Per provider it reads THEO_RAG_OAUTH_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET / _SCOPES (provider
// upper-cased, `-` → `_`). Providers without a configured CLIENT_ID are omitted (the operator gate:
// the broker only offers a provider once its OAuth app is registered). Returns the (config, secrets).
func LoadOAuthConnectorsFromEnv(getenv func(string) string) (map[string]OAuthProviderConfig, map[string]string) {
	cfgs := map[string]OAuthProviderConfig{}
	secrets := map[string]string{}
	for provider, base := range defaultOAuthProviders() {
		key := strings.ToUpper(strings.ReplaceAll(provider, "-", "_"))
		clientID := getenv("THEO_RAG_OAUTH_" + key + "_CLIENT_ID")
		if clientID == "" {
			continue // not registered yet — do not offer this provider
		}
		base.ClientID = clientID
		if sc := getenv("THEO_RAG_OAUTH_" + key + "_SCOPES"); sc != "" {
			base.Scopes = sc
		}
		// Optional endpoint overrides — point a provider at a conformant OAuth2 IdP other than the
		// public default (staging against Ory Hydra, a self-hosted provider, etc.). Absent → default.
		if au := getenv("THEO_RAG_OAUTH_" + key + "_AUTHORIZE_URL"); au != "" {
			base.AuthorizeURL = au
		}
		if tu := getenv("THEO_RAG_OAUTH_" + key + "_TOKEN_URL"); tu != "" {
			base.TokenURL = tu
		}
		cfgs[provider] = base
		secrets[provider] = getenv("THEO_RAG_OAUTH_" + key + "_CLIENT_SECRET")
	}
	return cfgs, secrets
}
