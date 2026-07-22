// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// AuthzMCPResolvePath is the internal endpoint the Theo MCP Gateway's BrokerResolver
// calls per request (gateway-themory-integration D1). UNLIKE the Traefik ForwardAuth
// endpoint (which returns ONLY the minted Authorization header for the edge to copy
// upstream), this endpoint returns the FULL PRINCIPAL as JSON so the gateway can
// populate its own per-tenant tool gate (M2) + tenant attribution. Internal-only
// (never consumer-facing) — the gateway is the only caller.
const AuthzMCPResolvePath = "/internal/authz/mcp-resolve"

// MCPCapabilityBinding binds one MCP capability to the broker that mints its
// per-tenant key and the scope it requires (D2). The map keyed by capability makes
// the endpoint MCP-aware + multiplexing: a new capability is one map entry, not a
// new handler instance + redeploy (the REST ForwardAuth pattern). Exported so the
// composition root (cmd) can declare the bindings.
type MCPCapabilityBinding struct {
	Minter        TenantKeyMinter
	RequiredScope string
	// ScopeTools maps each data scope (e.g. "memory:read") to the MCP tool names it
	// grants (e.g. "recall", "episodes"). The gateway's allowlist matches scope==tool
	// name exactly, so the principal's `scopes` field MUST carry tool names, not the
	// raw data scopes (theo-workspace#10). The DOWNSTREAM minted key still carries the
	// raw data scopes — themory remains the authoritative per-verb gate. When nil, the
	// raw scopes pass through unchanged (backward-compat for capabilities without a map).
	ScopeTools map[string][]string
}

// mcpPrincipal is the JSON the gateway consumes. DownstreamKey is a secret (same
// trust model as the ForwardAuth Authorization header on the internal hop) and is
// NEVER logged. Scopes are the consumer's resolved scopes (the gateway maps them to
// its per-tenant tool allowlist; themory is the authoritative downstream gate).
type mcpPrincipal struct {
	TenantID string `json:"tenant_id"`
	// Subject is the credential's owning user, forwarded so the gateway can bind the
	// upstream's per-user tier (X-Theo-User-Id) to the SAME identity the dashboard
	// reads. Without it the MCP upstream falls back to a per-deployment constant, so
	// an agent's memories land under an identity no consumer queries — the dashboard
	// lists /v1/scopes/user/{session-subject}/memories and finds nothing.
	//
	// Auth-trusted: it comes from the resolved credential, never from a client header.
	// Empty for legacy credentials with no subject; the gateway then omits the header
	// and the upstream keeps its existing fallback.
	Subject       string   `json:"subject,omitempty"`
	DownstreamKey string   `json:"downstream_key"`
	Scopes        []string `json:"scopes"`
}

// MCPResolveHandler is the MCP-aware authz-brain endpoint. It runs the SAME 3 guards
// as ForwardAuthHandler (resolve → scope gate → M1 cross-account) + the per-tenant
// mint, then returns the principal JSON on ALLOW. Every DENY (401/403/503) is
// FAIL-CLOSED: no principal body, no Authorization header.
type MCPResolveHandler struct {
	resolve   APIKeyResolver
	authorize AccountTenantAuthorizer
	caps      map[string]MCPCapabilityBinding
	logger    *slog.Logger
}

// NewMCPResolveHandler wires the endpoint. caps binds each fronted capability to its
// broker + required scope; resolve/authorize reuse the same auth fabric as ForwardAuth.
func NewMCPResolveHandler(resolve APIKeyResolver, authorize AccountTenantAuthorizer, caps map[string]MCPCapabilityBinding, logger *slog.Logger) *MCPResolveHandler {
	return &MCPResolveHandler{resolve: resolve, authorize: authorize, caps: caps, logger: logger}
}

func (h *MCPResolveHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Capability selection BEFORE any validation: an unknown capability is a
	// fail-closed 403 (never resolve/mint for a capability we do not front).
	capability := r.Header.Get("X-Theo-Capability")
	binding, ok := h.caps[capability]
	if !ok {
		writeError(w, http.StatusForbidden, "UNKNOWN_CAPABILITY", "Unknown or unsupported MCP capability.")
		return
	}

	uc, scopes, err := h.resolve(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		// Infra error is fail-closed 503 — NEVER 401, which would tell a valid key
		// it is invalid during a backend outage (mirror forward_auth.go).
		if errors.Is(err, auth.ErrBackendUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "AUTH_BACKEND_UNAVAILABLE", "Authorization backend unavailable. Try again.")
			return
		}
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or missing API key.")
		return
	}
	if !hasScope(scopes, binding.RequiredScope) {
		writeError(w, http.StatusForbidden, "SCOPE_REQUIRED", "This API key does not carry the required scope.")
		return
	}

	// M1 cross-account guard (same as ForwardAuth): an Account-aware credential MUST
	// own the target tenant; a DB error is fail-closed 503; a legacy NULL-account key
	// skips the check (M0 backward-compat).
	if uc.AccountID != "" {
		owns, aerr := h.authorize(r.Context(), uc.AccountID, uc.TenantID)
		if aerr != nil {
			h.logger.Warn("mcp-resolve: ownership check failed", "account", uc.AccountID, "tenant", uc.TenantID, "capability", capability, "error", aerr)
			writeError(w, http.StatusServiceUnavailable, "AUTH_BACKEND_UNAVAILABLE", "Authorization backend unavailable. Try again.")
			return
		}
		if !owns {
			h.logger.Warn("mcp-resolve: cross-account credential rejected", "account", uc.AccountID, "tenant", uc.TenantID, "capability", capability)
			writeError(w, http.StatusForbidden, "CROSS_ACCOUNT", "This credential's account does not own the target tenant.")
			return
		}
	}

	// Mint with the CONSUMER's own scopes (least privilege — the broker intersects
	// with its supported set, so the minted key can never exceed the consumer's).
	minted, err := binding.Minter.KeyForTenantScoped(r.Context(), uc.AccountID, uc.TenantID, scopes)
	if err != nil {
		h.logger.Warn("mcp-resolve: per-tenant mint failed", "tenant", uc.TenantID, "capability", capability, "error", err)
		writeError(w, http.StatusServiceUnavailable, "MINT_UNAVAILABLE", "Could not provision a credential. Try again.")
		return
	}
	if minted == "" {
		h.logger.Warn("mcp-resolve: broker returned an empty key", "tenant", uc.TenantID, "capability", capability)
		writeError(w, http.StatusServiceUnavailable, "MINT_UNAVAILABLE", "Could not provision a credential. Try again.")
		return
	}

	// ALLOW: return the full principal. The gateway injects DownstreamKey on the
	// upstream leg and maps Scopes to its per-tenant tool allowlist.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(mcpPrincipal{
		TenantID:      uc.TenantID,
		Subject:       uc.Subject,
		DownstreamKey: minted,
		Scopes:        binding.grantedTools(scopes),
	})
}

// grantedTools translates the consumer's data scopes into the MCP tool names the
// gateway allowlist expects (theo-workspace#10). The gateway matches scope==tool name
// exactly, so a data scope like "memory:read" must become its verbs ("recall", …).
// Deterministic (sorted, deduped). When the binding has no ScopeTools map, the raw
// scopes pass through (backward-compat for capabilities that have not declared one).
func (b MCPCapabilityBinding) grantedTools(scopes []string) []string {
	if b.ScopeTools == nil {
		return scopes
	}
	set := make(map[string]struct{})
	for _, s := range scopes {
		for _, tool := range b.ScopeTools[s] {
			set[tool] = struct{}{}
		}
	}
	tools := make([]string, 0, len(set))
	for t := range set {
		tools = append(tools, t)
	}
	sort.Strings(tools)
	return tools
}
