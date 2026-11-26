// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"net/http"

	"github.com/getloopscale/loop-console/internal/auth"
)

// tenantEnsurer is the slice of *auth.TenantProvisioner the resolver needs. An interface (not the
// concrete type) so the resolver is unit-testable without a real DB.
type tenantEnsurer = auth.TenantEnsurer

// KratosSessionTenantResolver resolves the tenant of a browser's Kratos session cookie. It exists for
// BROWSER-REDIRECT endpoints (the RAG OAuth broker authorize/callback): a top-level navigation whose
// server-to-server action must run as that tenant. It is a thin adapter over
// auth.KratosSessionAuthenticator — the one place a session cookie becomes an identity.
type KratosSessionTenantResolver struct {
	sessions *auth.KratosSessionAuthenticator
}

// NewKratosSessionTenantResolver wires the resolver. `tenants` is the *auth.TenantProvisioner.
func NewKratosSessionTenantResolver(kratosInternalURL string, tenants tenantEnsurer) *KratosSessionTenantResolver {
	return &KratosSessionTenantResolver{sessions: auth.NewKratosSessionAuthenticator(kratosInternalURL, tenants)}
}

// Resolve returns (accountID, tenantID, true) when the request carries a valid ACTIVE Kratos
// session cookie whose identity resolves to a tenant; (_, _, false) otherwise (no session, expired,
// whoami/DB error). Fail-closed: any error path returns ok=false — the caller redirects to login.
func (k *KratosSessionTenantResolver) Resolve(r *http.Request) (accountID, tenantID string, ok bool) {
	user, err := k.sessions.Authenticate(r)
	if err != nil {
		return "", "", false
	}
	return user.AccountID, user.TenantID, true
}
