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

// AuthzForwardRagPath is the internal ForwardAuth endpoint for the theo-rag
// capability (M14 — Model B). The generic ForwardAuthHandler is reused (a 3rd
// instance wired with the rag broker + "rag:read"); only the path differs so the
// Traefik `forward-auth-rag` middleware targets it.
const AuthzForwardRagPath = "/internal/authz/forward-rag"

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
	KeyForTenantScoped(ctx context.Context, accountID, tenantID string, scopes []string) (string, error)
}

// AccountTenantAuthorizer reports whether accountID owns tenantID — the M1
// cross-account guard. Injected (not a concrete *sql.DB) so the handler stays
// unit-testable without a DB (DIP); production closes over auth.AccountOwnsTenant.
type AccountTenantAuthorizer func(ctx context.Context, accountID, tenantID string) (bool, error)

// ForwardAuthHandler is the authz-brain endpoint the Traefik edge delegates to.
// It validates the inbound theo_live_*, checks the required scope, mints the
// per-tenant downstream credential, and returns it as the Authorization response
// header on ALLOW (200). Every DENY path (401/403/503) is FAIL-CLOSED and NEVER
// carries an Authorization header — so the edge copies nothing and makes no
// upstream call without an explicit ALLOW.
type ForwardAuthHandler struct {
	resolve   APIKeyResolver
	minter    TenantKeyMinter
	authorize AccountTenantAuthorizer
	required  string
	logger    *slog.Logger
}

// NewForwardAuthHandler wires the authz endpoint. requiredScope is the scope the
// fronted capability needs (e.g. "memory:read"). authorize is the M1 cross-account
// guard (ownership of tenant by account); it is consulted only for Account-aware
// credentials (legacy NULL-account keys skip it — M0 backward-compat).
func NewForwardAuthHandler(resolve APIKeyResolver, minter TenantKeyMinter, authorize AccountTenantAuthorizer, requiredScope string, logger *slog.Logger) *ForwardAuthHandler {
	return &ForwardAuthHandler{resolve: resolve, minter: minter, authorize: authorize, required: requiredScope, logger: logger}
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

	// M1 cross-account guard. An Account-aware credential (AccountID set) MUST own
	// the tenant it targets; otherwise 403 (the broker LAZILY trusts this check and
	// does not re-validate). A legacy NULL-account key (AccountID == "") SKIPS the
	// check — it predates accounts (M0 backward-compat). A DB error in the check is
	// FAIL-CLOSED (503), never a silent allow.
	if uc.AccountID != "" {
		owns, aerr := h.authorize(r.Context(), uc.AccountID, uc.TenantID)
		if aerr != nil {
			h.logger.Warn("forward-auth: ownership check failed", "account", uc.AccountID, "tenant", uc.TenantID, "error", aerr)
			writeError(w, http.StatusServiceUnavailable, "AUTH_BACKEND_UNAVAILABLE", "Authorization backend unavailable. Try again.")
			return
		}
		if !owns {
			h.logger.Warn("forward-auth: cross-account credential rejected", "account", uc.AccountID, "tenant", uc.TenantID)
			writeError(w, http.StatusForbidden, "CROSS_ACCOUNT", "This credential's account does not own the target tenant.")
			return
		}
	}

	// Mint with the CONSUMER's own scopes (least privilege) — the broker
	// intersects with the gateway's supported set, so the minted key can never
	// exceed what the consumer's key holds (no intra-tenant scope escalation).
	// accountID is threaded for cache-keying but never reaches the data-plane.
	minted, err := h.minter.KeyForTenantScoped(r.Context(), uc.AccountID, uc.TenantID, scopes)
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
