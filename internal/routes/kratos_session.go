// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// tenantEnsurer is the slice of *auth.TenantProvisioner the resolver needs. An interface (not the
// concrete type) so the resolver is unit-testable without a real DB (mirrors SessionTokenHandler's
// dependency, kept minimal per ISP).
type tenantEnsurer interface {
	EnsureTenant(ctx context.Context, identityID, email string) (tenantID, accountID, role string, err error)
}

// KratosSessionTenantResolver resolves the tenant of a browser's Kratos session cookie via
// /sessions/whoami → EnsureTenant. It exists for BROWSER-REDIRECT endpoints (the RAG OAuth broker
// authorize/callback) that cannot carry a Bearer JWT — the same auth model as the GitHub App
// integration, but returning the tenant so a server-to-server action can run as that tenant. Bearer
// API routes MUST keep using requireJWT; this is only for top-level navigations.
type KratosSessionTenantResolver struct {
	kratosInternalURL string
	tenants           tenantEnsurer
	client            *http.Client
}

// NewKratosSessionTenantResolver wires the resolver. `tenants` is the *auth.TenantProvisioner.
func NewKratosSessionTenantResolver(kratosInternalURL string, tenants tenantEnsurer) *KratosSessionTenantResolver {
	return &KratosSessionTenantResolver{
		kratosInternalURL: kratosInternalURL,
		tenants:           tenants,
		client: &http.Client{
			Timeout:   5 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
	}
}

// Resolve returns (accountID, tenantID, true) when the request carries a valid ACTIVE Kratos
// session cookie whose identity resolves to a tenant; (_, _, false) otherwise (no session, expired,
// whoami/DB error). Fail-closed: any error path returns ok=false — the caller redirects to login.
func (k *KratosSessionTenantResolver) Resolve(r *http.Request) (accountID, tenantID string, ok bool) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, k.kratosInternalURL+"/sessions/whoami", nil)
	if err != nil {
		return "", "", false
	}
	for _, c := range r.Cookies() {
		req.AddCookie(c)
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return "", "", false
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", "", false
	}
	var session struct {
		Active   bool `json:"active"`
		Identity struct {
			ID     string `json:"id"`
			Traits struct {
				Email string `json:"email"`
			} `json:"traits"`
		} `json:"identity"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil || !session.Active {
		return "", "", false
	}
	if k.tenants == nil {
		return "", "", false
	}
	tid, aid, _, err := k.tenants.EnsureTenant(r.Context(), session.Identity.ID, session.Identity.Traits.Email)
	if err != nil || tid == "" {
		return "", "", false
	}
	return aid, tid, true
}

// Compile-time assertion that the concrete provisioner satisfies the minimal interface.
var _ tenantEnsurer = (*auth.TenantProvisioner)(nil)
