// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"errors"
	"net/http"
	"time"

	loopscalejwt "github.com/getloopscale/contracts/jwt"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/ratelimit"
)

// SessionTokenHandler exchanges Kratos session cookies for HS256 JWT tokens.
//
// getloopscale/loopscale#477: the dashboard no longer calls this — it is authenticated
// by its session cookie (auth.RequireCaller) and reads its identity from
// GET /v1/auth/session. The endpoint stays until step 4 removes the HS256
// issuer, because local scripts and the full-chain e2e still exchange here.
type SessionTokenHandler struct {
	issuer            *loopscalejwt.SessionTokenIssuer
	tenantProvisioner *auth.TenantProvisioner
	sessions          *auth.KratosSessionAuthenticator
	limiter           ratelimit.Limiter
}

const (
	rateLimitWindow   = 1 * time.Minute
	rateLimitMaxCalls = 10
)

// NewSessionTokenHandler creates a session token exchange handler.
func NewSessionTokenHandler(issuer *loopscalejwt.SessionTokenIssuer, tenantProv *auth.TenantProvisioner, kratosInternalURL string) *SessionTokenHandler {
	return &SessionTokenHandler{
		issuer:            issuer,
		tenantProvisioner: tenantProv,
		sessions:          auth.NewKratosSessionAuthenticator(kratosInternalURL, tenantProv),
		limiter:           ratelimit.NewInMemoryLimiter(rateLimitMaxCalls, rateLimitWindow),
	}
}

// Exchange validates the Kratos session cookie and returns a JWT.
// POST /v1/auth/session/token
func (h *SessionTokenHandler) Exchange(w http.ResponseWriter, r *http.Request) {
	// §2.3: Rate limit by identity+IP with standard headers
	key := ratelimit.Key("", r.RemoteAddr) // Pre-auth: IP only
	allowed, remaining, resetAt := h.limiter.Allow(key)
	ratelimit.SetHeaders(w, rateLimitMaxCalls, remaining, resetAt)
	if !allowed {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Try again in a moment.")
		return
	}

	session, err := h.sessions.Identify(r)
	if err != nil {
		if errors.Is(err, auth.ErrNoSession) {
			writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Please sign in.")
			return
		}
		writeError(w, http.StatusBadGateway, "AUTH_SERVICE_UNAVAILABLE", "Authentication service unavailable. Try again.")
		return
	}

	// Resolve or create tenant for this user.
	// This MUST succeed — never issue a JWT with "default" tenant.
	tenantID := ""
	accountID := "" // M3: the Account the tenant belongs to ("" for dev/legacy).
	if h.tenantProvisioner != nil {
		tid, aid, _, tErr := h.tenantProvisioner.EnsureTenant(r.Context(), session.ID, session.Email)
		if tErr != nil {
			writeError(w, http.StatusInternalServerError, "TENANT_ERROR",
				"Failed to set up your account. Try again or contact support.")
			return
		}
		tenantID = tid
		accountID = aid
	}
	if tenantID == "" {
		tenantID = "personal" // Only in dev without DB
	}

	// Issue JWT — M3: carry account_id additively (empty for dev/legacy tenants).
	token, expiresIn, err := h.issuer.Issue(
		session.ID,
		session.Email,
		session.Name,
		tenantID,
		accountID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "Failed to create access token.")
		return
	}

	// The identity travels with the token so the dashboard never calls Kratos
	// itself. The exchange already fetched the session server-side; handing back
	// this subset removes the browser's only reason to hold an Ory session
	// response, and with it devices[].ip_address and recovery_addresses.
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
		"identity":     session,
	})
}
