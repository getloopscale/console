// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Package consent implements the login/consent handlers that Ory Hydra
// calls during OAuth2 authorization flows.
//
// For allowlisted first-party clients, consent is auto-approved.
// Login redirects to Kratos self-service login flow.
package consent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/getloopscale/loop-console/internal/auth"
)

// expiredLinkHTML is the canonical error page rendered when the Hydra
// login/consent challenge has expired, was already consumed, or is otherwise
// unknown. Red Team loop-console#117 closure — replaces the previous silent
// empty-redirect (browser → /auth/login/ → 404 "Page not found") with an
// honest message that tells the operator exactly what to do next.
//
// Per Cross-Project Rule 9 / public-copy: no internal terms (Hydra, OAuth,
// Kratos) are exposed to the user. Inline styles only (CSP `style-src
// 'self' 'unsafe-inline'` on the dashboard surface; this is a small static
// page rendered by the BFF, no React, so the CSP cost is zero).
const expiredLinkHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login link expired — LoopScale</title>
<style>
  body { margin: 0; min-height: 100vh; background: #09090b; color: #fafafa;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 480px; background: #18181b; border: 1px solid #27272a;
          border-radius: 12px; padding: 32px; }
  h1 { margin: 0 0 16px 0; font-size: 20px; font-weight: 600; }
  p  { margin: 0 0 16px 0; color: #a1a1aa; line-height: 1.5; }
  code { background: #27272a; padding: 2px 6px; border-radius: 4px;
         font-family: ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", monospace;
         font-size: 13px; color: #fafafa; }
</style>
</head>
<body>
  <div class="card">
    <h1>Your login link has expired</h1>
    <p>This sign-in link has expired or was already used. Login links are single-use and valid for a few minutes.</p>
    <p>To finish signing in, re-run <code>loopscale login</code> in your terminal and open the new link the CLI prints.</p>
  </div>
</body>
</html>`

// renderExpiredLink emits the canonical "login link expired" page with
// HTTP 410 Gone. 410 is semantically correct: the challenge previously
// existed and is now permanently unavailable.
func renderExpiredLink(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusGone)
	_, _ = w.Write([]byte(expiredLinkHTML))
}

// defaultAccessTokenAudience is granted when the client asked for no audience
// and named no allowlisted resource: tokens that work against both loop-console
// and the engine, as every CLI token has so far.
var defaultAccessTokenAudience = []string{"loop-console", "loop-runtime-engine"}

// Policy decides who consent auto-approves and which audiences it may grant
// (getloopscale/loopscale#477, docs/decisions.md § Identity in the loopscale repository).
type Policy struct {
	// FirstPartyClients are the OAuth2 client ids whose consent is auto-approved.
	// Every other client is refused. Empty refuses everything (fail closed).
	FirstPartyClients []string
	// AllowedResources are the RFC 8707 resource URIs consent grants as the
	// access-token audience when the authorization request names them. A
	// requested resource outside this list is ignored, never granted.
	AllowedResources []string
}

// errNoTenant marks consent that cannot carry a tenant. No token is issued
// without one: every API refuses a tenantless token ("Account setup
// required"), so issuing it only moves the failure to a worse place.
var errNoTenant = errors.New("consent: tenant could not be resolved")

// Handler manages Hydra's login and consent callbacks.
type Handler struct {
	policy            Policy
	hydra             *auth.HydraClient
	tenantProvisioner *auth.TenantProvisioner
	kratosPublicURL   string // Browser-facing URL (for redirects)
	kratosInternalURL string // Cluster-internal URL (for server-to-server calls)
	kratosAdminURL    string // Cluster-internal Kratos admin API (identity lookups)
	kratosClient      *http.Client
	logger            *slog.Logger
}

// NewHandler creates a consent handler.
// kratosPublicURL is used for browser redirects, kratosInternalURL for server-to-server (whoami),
// kratosAdminURL for identity-trait lookups on the Kratos admin API.
func NewHandler(hydra *auth.HydraClient, tenantProv *auth.TenantProvisioner, kratosPublicURL, kratosInternalURL, kratosAdminURL string, logger *slog.Logger) *Handler {
	if kratosInternalURL == "" {
		kratosInternalURL = kratosPublicURL
	}
	return &Handler{
		policy:            Policy{FirstPartyClients: []string{hydra.ClientID()}},
		hydra:             hydra,
		tenantProvisioner: tenantProv,
		kratosPublicURL:   kratosPublicURL,
		kratosInternalURL: kratosInternalURL,
		kratosAdminURL:    kratosAdminURL,
		kratosClient: &http.Client{
			Timeout:   5 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
		logger: logger,
	}
}

// WithPolicy replaces the default policy (the Hydra client this service owns
// as the only first-party client, no resource URIs) and returns the handler.
func (h *Handler) WithPolicy(p Policy) *Handler {
	h.policy = Policy{
		FirstPartyClients: slices.Clone(p.FirstPartyClients),
		AllowedResources:  slices.Clone(p.AllowedResources),
	}
	return h
}

// Login handles the login challenge from Hydra.
// Hydra redirects here when a user needs to authenticate.
// We redirect to Kratos self-service login, passing the challenge.
// GET /auth/login?login_challenge=...
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("login_challenge")
	if challenge == "" {
		http.Error(w, "Missing login_challenge", http.StatusBadRequest)
		return
	}

	loginReq, err := h.hydra.GetLoginRequest(challenge)
	if err != nil {
		if errors.Is(err, auth.ErrChallengeNotFound) {
			h.logger.Info("login link expired or already consumed", "challenge", challenge)
			renderExpiredLink(w)
			return
		}
		h.logger.Error("failed to get login request", "error", err)
		http.Error(w, "Authentication service error", http.StatusBadGateway)
		return
	}

	// If the user has already authenticated (skip=true), accept immediately.
	if loginReq.Skip {
		redirectTo, err := h.hydra.AcceptLogin(challenge, loginReq.Subject)
		if err != nil {
			if errors.Is(err, auth.ErrChallengeNotFound) {
				h.logger.Info("login link expired between fetch and accept", "challenge", challenge)
				renderExpiredLink(w)
				return
			}
			h.logger.Error("failed to accept login", "error", err)
			http.Error(w, "Authentication service error", http.StatusBadGateway)
			return
		}
		// #nosec G710 -- redirectTo is the post-auth continuation URL computed by our own Hydra OAuth server (AcceptLogin), not attacker-controlled input.
		http.Redirect(w, r, redirectTo, http.StatusFound)
		return
	}

	// Redirect to Kratos self-service login flow.
	// After Kratos authenticates the user, it redirects back here
	// with the identity session, and we accept the Hydra login.
	kratosLoginURL := fmt.Sprintf("%s/self-service/login/browser?return_to=%s",
		h.kratosPublicURL,
		url.QueryEscape(fmt.Sprintf("/auth/login/complete?login_challenge=%s", challenge)),
	)
	http.Redirect(w, r, kratosLoginURL, http.StatusFound)
}

// LoginComplete is called after Kratos authenticates the user.
// It validates the Kratos session cookie, then accepts the Hydra login challenge.
// GET /auth/login/complete?login_challenge=...
func (h *Handler) LoginComplete(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("login_challenge")
	if challenge == "" {
		http.Error(w, "Missing login_challenge", http.StatusBadRequest)
		return
	}

	// Validate Kratos session — the user must have an active session cookie.
	// Without this check, an attacker could call /auth/login/complete directly.
	subject, err := h.getKratosSessionSubject(r)
	if err != nil {
		h.logger.Error("kratos session validation failed", "error", err, "challenge", challenge)
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	redirectTo, err := h.hydra.AcceptLogin(challenge, subject)
	if err != nil {
		if errors.Is(err, auth.ErrChallengeNotFound) {
			// Red Team loop-console#117 closure: this is the canonical
			// hit-path that surfaced the original "Page not found" bug.
			// User finished Kratos sign-in, came back here, and Hydra
			// had already expired/consumed the challenge → silent empty
			// redirect → /auth/login/ 404. Now: honest 410 + clear copy.
			h.logger.Info("login link expired or already consumed", "challenge", challenge)
			renderExpiredLink(w)
			return
		}
		h.logger.Error("failed to accept login", "error", err)
		http.Error(w, "Authentication service error", http.StatusBadGateway)
		return
	}
	// #nosec G710 -- redirectTo is the post-auth continuation URL computed by our own Hydra OAuth server (AcceptLogin), not attacker-controlled input.
	http.Redirect(w, r, redirectTo, http.StatusFound)
}

// getKratosSessionSubject validates the Kratos session cookie and returns the subject.
func (h *Handler) getKratosSessionSubject(r *http.Request) (string, error) {
	// Forward the cookies from the original request to Kratos /sessions/whoami.
	// Uses internal URL to avoid going through external proxy/TLS.
	whoamiURL := fmt.Sprintf("%s/sessions/whoami", h.kratosInternalURL)
	req, err := http.NewRequest("GET", whoamiURL, nil)
	if err != nil {
		return "", fmt.Errorf("create whoami request: %w", err)
	}

	// Forward ALL cookies — Kratos uses dynamic cookie names (e.g., csrf_token_{hash}).
	for _, cookie := range r.Cookies() {
		req.AddCookie(cookie)
	}

	resp, err := h.kratosClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("kratos whoami request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("no active kratos session (status %d)", resp.StatusCode)
	}

	var session struct {
		Identity struct {
			ID string `json:"id"`
		} `json:"identity"`
		Active bool `json:"active"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return "", fmt.Errorf("decode kratos session: %w", err)
	}

	if !session.Active || session.Identity.ID == "" {
		return "", fmt.Errorf("kratos session is not active")
	}

	return session.Identity.ID, nil
}

// fetchIdentityClaims builds the access-token claims for subject: email and
// name from Kratos, tenant_id and account_id from the tenant provisioner.
// ctx is the request context — it carries the OTel span, deadline, and
// cancellation so the identity lookup and tenant provisioning are tied to the
// consent request (MEDIUM-003).
//
// getloopscale/loopscale#477: any failure to resolve the tenant is returned wrapped in
// errNoTenant. It used to be non-fatal (MEET-2026-04-07-039 B5), issuing a
// token without tenant_id that every API then refused.
func (h *Handler) fetchIdentityClaims(ctx context.Context, subject string) (map[string]interface{}, error) {
	// Use the explicitly configured admin URL — never derive it by string-replacing
	// the public URL (that silently breaks when service names don't match the heuristic).
	kratosAdmin := strings.TrimRight(h.kratosAdminURL, "/")
	identityURL := fmt.Sprintf("%s/admin/identities/%s", kratosAdmin, subject)
	// #nosec G704 -- host is the operator-configured Kratos admin URL (T1.2); subject is a server-validated Kratos session identity, not free-form attacker input.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, identityURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build identity request: %w", errNoTenant, err)
	}
	resp, err := h.kratosClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: fetch identity: %w", errNoTenant, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: identity lookup returned status %d", errNoTenant, resp.StatusCode)
	}

	var identity struct {
		Traits struct {
			Email string `json:"email"`
			Name  string `json:"name"`
		} `json:"traits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&identity); err != nil {
		return nil, fmt.Errorf("%w: decode identity: %w", errNoTenant, err)
	}
	if identity.Traits.Email == "" {
		return nil, fmt.Errorf("%w: identity has no email trait", errNoTenant)
	}
	if h.tenantProvisioner == nil {
		return nil, fmt.Errorf("%w: no tenant provisioner configured", errNoTenant)
	}

	tenantID, accountID, _, err := h.tenantProvisioner.EnsureTenant(ctx, subject, identity.Traits.Email)
	if err != nil {
		return nil, fmt.Errorf("%w: provision tenant: %w", errNoTenant, err)
	}
	if tenantID == "" {
		return nil, fmt.Errorf("%w: provisioner returned an empty tenant", errNoTenant)
	}

	claims := map[string]interface{}{
		"email":     identity.Traits.Email,
		"tenant_id": tenantID,
	}
	if identity.Traits.Name != "" {
		claims["name"] = identity.Traits.Name
	}
	// account_id is the M1 cross-account guard's input, not a display field.
	// "" for a tenant that predates accounts (NULL-tolerant) — omitted, never faked.
	if accountID != "" {
		claims["account_id"] = accountID
	}
	return claims, nil
}

// grantedAudience decides the access-token audience. RFC 8707 resources named
// in the original authorization request are granted when they are allowlisted
// (the token is then bound to those resources only); a resource outside the
// allowlist is ignored. With no allowlisted resource the client's requested
// audience is granted, and with none requested, defaultAccessTokenAudience.
func (h *Handler) grantedAudience(req *auth.ConsentRequest) ([]string, error) {
	var granted []string
	if req.RequestURL != "" {
		u, err := url.Parse(req.RequestURL)
		if err != nil {
			return nil, fmt.Errorf("parse authorization request url: %w", err)
		}
		for _, resource := range u.Query()["resource"] {
			if slices.Contains(h.policy.AllowedResources, resource) && !slices.Contains(granted, resource) {
				granted = append(granted, resource)
			}
		}
	}
	if len(granted) > 0 {
		return granted, nil
	}
	if len(req.RequestedAccessTokenAud) > 0 {
		return req.RequestedAccessTokenAud, nil
	}
	return defaultAccessTokenAudience, nil
}

// rejectConsent refuses the challenge at Hydra — no token is issued — and
// sends the user agent back to the client carrying the OAuth2 error.
func (h *Handler) rejectConsent(w http.ResponseWriter, r *http.Request, challenge, description string) {
	redirectTo, err := h.hydra.RejectConsent(challenge, "access_denied", description)
	if err != nil {
		if errors.Is(err, auth.ErrChallengeNotFound) {
			h.logger.Info("consent link expired before it could be rejected", "challenge", challenge)
			renderExpiredLink(w)
			return
		}
		h.logger.Error("failed to reject consent", "challenge", challenge, "error", err)
		http.Error(w, "Authentication service error", http.StatusBadGateway)
		return
	}
	// #nosec G710 -- redirectTo is the post-consent continuation URL computed by our own Hydra OAuth server (RejectConsent), not attacker-controlled input.
	http.Redirect(w, r, redirectTo, http.StatusFound)
}

// Consent handles the consent challenge from Hydra.
// For the CLI (first-party client), auto-approve all requested scopes.
// GET /auth/consent?consent_challenge=...
func (h *Handler) Consent(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("consent_challenge")
	if challenge == "" {
		http.Error(w, "Missing consent_challenge", http.StatusBadRequest)
		return
	}

	consentReq, err := h.hydra.GetConsentRequest(challenge)
	if err != nil {
		if errors.Is(err, auth.ErrChallengeNotFound) {
			h.logger.Info("consent link expired or already consumed", "challenge", challenge)
			renderExpiredLink(w)
			return
		}
		h.logger.Error("failed to get consent request", "error", err)
		http.Error(w, "Authentication service error", http.StatusBadGateway)
		return
	}

	// Auto-approval is ONLY for the allowlisted first-party clients. Any other
	// registered Hydra client (including a rogue client registered via the
	// admin API) must NOT receive auto-approved scopes and tenant_id claims.
	if !slices.Contains(h.policy.FirstPartyClients, consentReq.ClientID) {
		h.logger.Warn("consent rejected — untrusted client", "client", consentReq.ClientID, "subject", consentReq.Subject)
		http.Error(w, "Unauthorized client", http.StatusForbidden)
		return
	}

	tokenClaims, err := h.fetchIdentityClaims(r.Context(), consentReq.Subject)
	if err != nil {
		// No token without a tenant. Log the cause with context; the client
		// sees only a product-language description.
		h.logger.Error("consent rejected — tenant could not be resolved",
			"client", consentReq.ClientID,
			"subject", consentReq.Subject,
			"error", err,
		)
		h.rejectConsent(w, r, challenge, "Account setup failed. Please try signing in again.")
		return
	}

	audience, err := h.grantedAudience(consentReq)
	if err != nil {
		h.logger.Error("consent rejected — unreadable authorization request",
			"client", consentReq.ClientID,
			"subject", consentReq.Subject,
			"error", err,
		)
		h.rejectConsent(w, r, challenge, "The sign-in request could not be read. Please try again.")
		return
	}

	redirectTo, err := h.hydra.AcceptConsent(challenge, consentReq.RequestedScope, audience, tokenClaims)
	if err != nil {
		if errors.Is(err, auth.ErrChallengeNotFound) {
			h.logger.Info("consent link expired between fetch and accept", "challenge", challenge)
			renderExpiredLink(w)
			return
		}
		h.logger.Error("failed to accept consent", "error", err)
		http.Error(w, "Authentication service error", http.StatusBadGateway)
		return
	}

	// Do NOT log token claims (email, tenant_id) — they are PII. Log only
	// non-identifying metadata for operational visibility.
	_, hasAccount := tokenClaims["account_id"]
	h.logger.Info("consent auto-approved",
		"client", consentReq.ClientID,
		"subject", consentReq.Subject,
		"scope_count", len(consentReq.RequestedScope),
		"audience", audience,
		"has_account", hasAccount,
	)
	// #nosec G710 -- redirectTo is the post-consent continuation URL computed by our own Hydra OAuth server (AcceptConsent), not attacker-controlled input.
	http.Redirect(w, r, redirectTo, http.StatusFound)
}

// sanitizeDeviceReturnTo builds a safe, relative return_to path for the device
// verification flow from validated query parameters only, discarding any
// attacker-controlled scheme/host in the original request URL. The result is
// always a relative "/auth/device" path, so it cannot redirect off-origin.
func sanitizeDeviceReturnTo(r *http.Request) string {
	q := url.Values{}
	if c := r.URL.Query().Get("device_challenge"); c != "" {
		q.Set("device_challenge", c)
	}
	if uc := r.URL.Query().Get("user_code"); uc != "" {
		q.Set("user_code", uc)
	}
	rt := "/auth/device"
	if enc := q.Encode(); enc != "" {
		rt += "?" + enc
	}
	return rt
}

// DeviceVerify handles the device authorization challenge from Hydra.
// When a user visits the device verification URL, Hydra redirects here with a challenge.
// This handler validates the Kratos session, then accepts the device challenge.
// GET /auth/device?device_challenge=...&user_code=...
func (h *Handler) DeviceVerify(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("device_challenge")
	if challenge == "" {
		http.Error(w, "Missing device_challenge", http.StatusBadRequest)
		return
	}

	// Validate Kratos session — user must be authenticated
	subject, err := h.getKratosSessionSubject(r)
	if err != nil {
		h.logger.Warn("device verify: no session, redirecting to login", "error", err)
		// Redirect to Kratos login with return_to back to this device verify URL.
		// Rebuild return_to as a relative path from validated query params only —
		// never echo the raw request URL (open-redirect / host-injection guard).
		returnTo := sanitizeDeviceReturnTo(r)
		loginURL := fmt.Sprintf("%s/self-service/login/browser?return_to=%s",
			h.kratosPublicURL, url.QueryEscape(returnTo))
		http.Redirect(w, r, loginURL, http.StatusFound)
		return
	}

	// Accept the device challenge via Hydra admin
	userCode := r.URL.Query().Get("user_code")
	redirectTo, err := h.hydra.AcceptDeviceChallenge(challenge, userCode)
	if err != nil {
		h.logger.Error("device verify: failed to accept device challenge", "error", err, "subject", subject)
		http.Error(w, "Failed to authorize device. Please try again.", http.StatusBadGateway)
		return
	}
	h.logger.Info("device authorized", "subject", subject, "user_code", userCode)

	if redirectTo != "" {
		// #nosec G710 -- redirectTo is the post-device-grant continuation URL computed by our own Hydra OAuth server (AcceptDeviceChallenge), not attacker-controlled input.
		http.Redirect(w, r, redirectTo, http.StatusFound)
		return
	}

	// Success — show confirmation
	w.Header().Set("Content-Type", "text/html")
	_, _ = fmt.Fprint(w, `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0a;color:#fff;margin:0"><div style="text-align:center"><h2>CLI authorized</h2><p style="color:#888">You can close this tab and return to your terminal.</p></div></body></html>`)
}
