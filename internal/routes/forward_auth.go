// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// AuthzForwardPath is the internal endpoint the edge (Traefik ForwardAuth) calls
// per request. It is NOT a consumer-facing route — only the edge invokes it
// (platform-api-gateway-edge-slice1 M6, ADR D7). A fixed internal path needs no
// env knob (parsimony — YAGNI).
const AuthzForwardPath = "/internal/authz/forward"

// AuthzForwardPromptlyPath is the internal ForwardAuth endpoint for the
// theo-promptly capability (M11 — Model B L2). The generic ForwardAuthHandler is
// reused (a 2nd instance wired with the promptly broker + "promptly:read"); only
// the path differs so the Traefik `forward-auth-promptly` middleware targets it.
const AuthzForwardPromptlyPath = "/internal/authz/forward-promptly"

// APIKeyResolver validates an inbound Authorization header and resolves the
// tenant. Injected (not a concrete *sql.DB dependency) so the handler is unit-
// testable without a database; in production it closes over auth.ResolveAPIKey.
type APIKeyResolver func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error)

// TenantKeyMinter mints/loads the per-tenant downstream credential scoped to the
// consumer's OWN scopes (least privilege — a read-only consumer never receives a
// write/delete key). Satisfied by *themory.Broker (memory) and *promptly.Broker
// (M11) — both implement KeyForTenantScoped (Model B); an interface here keeps the
// handler DIP-clean and lets one generic handler serve both capabilities.
type TenantKeyMinter interface {
	KeyForTenantScoped(ctx context.Context, tenantID string, scopes []string) (string, error)
}

// ForwardAuthHandler is the authz-brain endpoint the Traefik edge delegates to.
// It validates the inbound theo_live_*, checks the required scope, mints the
// per-tenant downstream credential, and returns it as the Authorization response
// header on ALLOW (200). Every DENY path (401/403/503) is FAIL-CLOSED and NEVER
// carries an Authorization header — so the edge copies nothing and makes no
// upstream call without an explicit ALLOW.
type ForwardAuthHandler struct {
	resolve  APIKeyResolver
	minter   TenantKeyMinter
	required string
	logger   *slog.Logger
}

// NewForwardAuthHandler wires the authz endpoint. requiredScope is the scope the
// fronted capability needs (e.g. "memory:read").
func NewForwardAuthHandler(resolve APIKeyResolver, minter TenantKeyMinter, requiredScope string, logger *slog.Logger) *ForwardAuthHandler {
	return &ForwardAuthHandler{resolve: resolve, minter: minter, required: requiredScope, logger: logger}
}

func (h *ForwardAuthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	uc, scopes, err := h.resolve(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		// EC-1: an infra error is fail-closed (503) — NEVER 401 "bad key", which
		// would tell a valid key it is invalid during a backend outage.
		if errors.Is(err, auth.ErrBackendUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "AUTH_BACKEND_UNAVAILABLE", "Authorization backend unavailable. Try again.")
			return
		}
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or missing API key.")
		return
	}
	if !hasScope(scopes, h.required) {
		writeError(w, http.StatusForbidden, "SCOPE_REQUIRED", "This API key does not carry the required scope.")
		return
	}

	// Mint with the CONSUMER's own scopes (least privilege) — the broker
	// intersects with the gateway's supported set, so the minted key can never
	// exceed what the consumer's key holds (no intra-tenant scope escalation).
	minted, err := h.minter.KeyForTenantScoped(r.Context(), uc.TenantID, scopes)
	// Fail-closed: a mint error OR an empty minted key (EC-2) MUST NEVER set an
	// Authorization header — the edge then denies (no upstream call). The broker's
	// own invariant is to never fall back to a master key (TestBroker_MintFailure_*).
	if err != nil {
		h.logger.Warn("forward-auth: per-tenant mint failed", "tenant", uc.TenantID, "error", err)
		writeError(w, http.StatusServiceUnavailable, "MINT_UNAVAILABLE", "Could not provision a credential. Try again.")
		return
	}
	if minted == "" {
		h.logger.Warn("forward-auth: broker returned an empty key", "tenant", uc.TenantID)
		writeError(w, http.StatusServiceUnavailable, "MINT_UNAVAILABLE", "Could not provision a credential. Try again.")
		return
	}

	// ALLOW: hand the minted per-tenant credential to the edge, which copies it
	// onto the upstream request via authResponseHeaders. The consumer's own key
	// is stripped at the edge (D3) so the backend sees ONLY this scoped key.
	w.Header().Set("Authorization", "Bearer "+minted)
	w.WriteHeader(http.StatusOK)
}

// hasScope is a small local membership check (KISS — not knowledge-duplication
// with auth.sliceContains; the two are unrelated concepts that happen to look alike).
func hasScope(scopes []string, required string) bool {
	for _, s := range scopes {
		if s == required {
			return true
		}
	}
	return false
}
