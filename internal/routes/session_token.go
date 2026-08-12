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
// verifiableAddress / authenticationMethod / identityResponse are the ONLY
// identity fields that cross to the browser. They mirror the dashboard's
// `Session` type (dashboard/src/lib/api/types.ts) — anything the dashboard does
// not read is deliberately absent, not merely unused.
type verifiableAddress struct {
	Value    string `json:"value"`
	Verified bool   `json:"verified"`
	Via      string `json:"via"`
}

type authenticationMethod struct {
	Method   string `json:"method"`
	Provider string `json:"provider,omitempty"`
}

type identityResponse struct {
	ID                    string                 `json:"id"`
	Email                 string                 `json:"email"`
	Name                  string                 `json:"name"`
	VerifiableAddresses   []verifiableAddress    `json:"verifiable_addresses,omitempty"`
	AuthenticationMethods []authenticationMethod `json:"authentication_methods,omitempty"`
}

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

	// Only the fields the dashboard reads are decoded. Ory returns a great deal
	// more — devices[].ip_address, recovery_addresses, schema_url — and this
	// endpoint exists so the browser never sees any of it. Decoding narrowly is
	// what makes the omission structural rather than a habit: a field that is
	// not parsed cannot be forwarded by accident later.
	var session struct {
		Active   bool `json:"active"`
		Identity struct {
			ID     string `json:"id"`
			Traits struct {
				Email string `json:"email"`
				Name  string `json:"name"`
			} `json:"traits"`
			VerifiableAddresses []verifiableAddress `json:"verifiable_addresses"`
		} `json:"identity"`
		AuthenticationMethods []authenticationMethod `json:"authentication_methods"`
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

	// The identity travels with the token so the dashboard never calls Kratos
	// itself. The exchange already fetched the session server-side; handing back
	// this subset removes the browser's only reason to hold an Ory session
	// response, and with it devices[].ip_address and recovery_addresses.
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
		"identity": identityResponse{
			ID:                    session.Identity.ID,
			Email:                 session.Identity.Traits.Email,
			Name:                  session.Identity.Traits.Name,
			VerifiableAddresses:   session.Identity.VerifiableAddresses,
			AuthenticationMethods: session.AuthenticationMethods,
		},
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
