// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	theojwt "github.com/usetheoai/theo-contracts/jwt"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/ratelimit"
)

// SessionTokenHandler exchanges Kratos session cookies for JWT tokens.
type SessionTokenHandler struct {
	issuer            *theojwt.SessionTokenIssuer
	tenantProvisioner *auth.TenantProvisioner
	kratosInternalURL string
	kratosClient      *http.Client
	limiter           ratelimit.Limiter
}

const (
	rateLimitWindow   = 1 * time.Minute
	rateLimitMaxCalls = 10
)

// NewSessionTokenHandler creates a session token exchange handler.
func NewSessionTokenHandler(issuer *theojwt.SessionTokenIssuer, tenantProv *auth.TenantProvisioner, kratosInternalURL string) *SessionTokenHandler {
	return &SessionTokenHandler{
		issuer:            issuer,
		tenantProvisioner: tenantProv,
		kratosInternalURL: kratosInternalURL,
		kratosClient: &http.Client{
			Timeout:   5 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
		limiter: ratelimit.NewInMemoryLimiter(rateLimitMaxCalls, rateLimitWindow),
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

	// Validate Kratos session by forwarding cookies to whoami
	whoamiURL := fmt.Sprintf("%s/sessions/whoami", h.kratosInternalURL)
	req, err := http.NewRequestWithContext(r.Context(), "GET", whoamiURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Authentication service error.")
		return
	}
	for _, cookie := range r.Cookies() {
		req.AddCookie(cookie)
	}

	resp, err := h.kratosClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "AUTH_SERVICE_UNAVAILABLE", "Authentication service unavailable. Try again.")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		// #330: as duas origens de 401 deste handler — esta e a de sessao
		// inativa abaixo — sao indistinguiveis a partir do log, e exigem
		// investigacoes opostas: escopo de dominio do cookie de um lado,
		// estado da sessao do outro. Registramos os NOMES dos cookies
		// repassados (NUNCA os valores: sao credenciais de sessao) e o status
		// que o provedor devolveu, para que o proximo diagnostico seja leitura
		// e nao suposicao.
		slog.Warn("session exchange rejected by identity provider",
			"reason", "whoami_non_200",
			"provider_status", resp.StatusCode,
			"forwarded_cookie_names", cookieNames(r),
		)
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Please sign in.")
		return
	}

	var session struct {
		Active   bool `json:"active"`
		Identity struct {
			ID     string `json:"id"`
			Traits struct {
				Email string `json:"email"`
				Name  string `json:"name"`
			} `json:"traits"`
		} `json:"identity"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil || !session.Active {
		// #330: distinta da anterior — aqui o provedor ACEITOU a requisicao e
		// respondeu que a sessao nao esta ativa (ou o corpo nao decodificou).
		slog.Warn("session exchange rejected by identity provider",
			"reason", "session_inactive_or_undecodable",
			"provider_status", resp.StatusCode,
			"decode_failed", err != nil,
			"forwarded_cookie_names", cookieNames(r),
		)
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Session expired. Please sign in again.")
		return
	}

	// Resolve or create tenant for this user.
	// This MUST succeed — never issue a JWT with "default" tenant.
	tenantID := ""
	accountID := "" // M3: the Account the tenant belongs to ("" for dev/legacy).
	if h.tenantProvisioner != nil {
		tid, aid, _, tErr := h.tenantProvisioner.EnsureTenant(r.Context(), session.Identity.ID, session.Identity.Traits.Email)
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
		session.Identity.ID,
		session.Identity.Traits.Email,
		session.Identity.Traits.Name,
		tenantID,
		accountID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "Failed to create access token.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
	})
}

// cookieNames devolve apenas os NOMES dos cookies da requisicao. Existe para
// que o diagnostico de #330 nao dependa de inspecionar valores: o valor de um
// cookie de sessao E a credencial, e log e o lugar onde credencial vazada
// sobrevive mais tempo.
func cookieNames(r *http.Request) []string {
	cookies := r.Cookies()
	names := make([]string, 0, len(cookies))
	for _, c := range cookies {
		names = append(names, c.Name)
	}
	return names
}
