// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// getloopscale/loopscale#477 step 3 — loop-console is the dashboard's Backend for Frontend.
//
// The browser keeps only the Kratos session cookie. This file is the single
// place that turns that cookie into an identity, server-side, by asking Kratos
// /sessions/whoami. It used to exist three times (the session-token exchange,
// the RAG OAuth redirect resolver, and the consent flow), each with its own
// decoding and its own failure mapping.

// Errors a session lookup can end in. They are distinct because the dashboard
// acts on them differently: only ErrNoSession means the person must sign in
// again; the other two are transient and must never log anyone out.
var (
	// ErrNoSession: no cookie, a cookie Kratos refuses, or an inactive session.
	ErrNoSession = errors.New("no active identity session")
	// ErrIdentityProviderUnavailable: Kratos could not be asked.
	ErrIdentityProviderUnavailable = errors.New("identity provider unavailable")
	// ErrTenantResolution: the session is valid and its tenant could not be resolved.
	ErrTenantResolution = errors.New("tenant resolution failed")
)

// VerifiableAddress is one email address Kratos tracks verification for.
type VerifiableAddress struct {
	Value    string `json:"value"`
	Verified bool   `json:"verified"`
	Via      string `json:"via"`
}

// AuthenticationMethod is how the session was established (password, oidc/google, ...).
type AuthenticationMethod struct {
	Method   string `json:"method"`
	Provider string `json:"provider,omitempty"`
}

// SessionIdentity is the subset of a Kratos session the dashboard reads.
//
// Kratos returns far more — devices[].ip_address, recovery_addresses,
// schema_url. Decoding narrowly is what keeps those out of any response built
// from this type: a field that is never parsed cannot be forwarded by accident.
type SessionIdentity struct {
	ID                    string                 `json:"id"`
	Email                 string                 `json:"email"`
	Name                  string                 `json:"name"`
	VerifiableAddresses   []VerifiableAddress    `json:"verifiable_addresses,omitempty"`
	AuthenticationMethods []AuthenticationMethod `json:"authentication_methods,omitempty"`
}

// TenantEnsurer is the slice of *TenantProvisioner a session lookup needs.
type TenantEnsurer interface {
	EnsureTenant(ctx context.Context, identityID, email string) (tenantID, accountID, role string, err error)
}

var _ TenantEnsurer = (*TenantProvisioner)(nil)

// SessionAuthenticator resolves the caller of a cookie-authenticated request.
type SessionAuthenticator interface {
	Authenticate(r *http.Request) (*UserContext, error)
}

// KratosSessionAuthenticator validates a browser's Kratos session cookie against
// Kratos /sessions/whoami and resolves the identity's tenant.
type KratosSessionAuthenticator struct {
	kratosInternalURL string
	tenants           TenantEnsurer
	client            *http.Client
}

var _ SessionAuthenticator = (*KratosSessionAuthenticator)(nil)

// NewKratosSessionAuthenticator wires the authenticator. kratosInternalURL is
// the in-cluster Kratos public API; tenants is the *TenantProvisioner.
func NewKratosSessionAuthenticator(kratosInternalURL string, tenants TenantEnsurer) *KratosSessionAuthenticator {
	return &KratosSessionAuthenticator{
		kratosInternalURL: kratosInternalURL,
		tenants:           tenants,
		client: &http.Client{
			Timeout:   5 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
	}
}

// Identify returns the identity behind the request's Kratos session cookie.
//
// Every inbound cookie is forwarded, not only `ory_kratos_session`: the cookie
// name is Kratos configuration, and whoami picks the one it owns.
func (k *KratosSessionAuthenticator) Identify(r *http.Request) (*SessionIdentity, error) {
	if len(r.Cookies()) == 0 {
		return nil, ErrNoSession
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, k.kratosInternalURL+"/sessions/whoami", nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build whoami request: %v", ErrIdentityProviderUnavailable, err)
	}
	for _, c := range r.Cookies() {
		req.AddCookie(c)
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: whoami: %v", ErrIdentityProviderUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		// #330: log the cookie NAMES and the provider's status, never the values —
		// a session cookie value IS the credential. "The cookie never arrived" and
		// "the cookie was refused" need opposite investigations.
		slog.Warn("identity session rejected by identity provider",
			"reason", "whoami_non_200",
			"provider_status", resp.StatusCode,
			"forwarded_cookie_names", cookieNames(r),
		)
		return nil, ErrNoSession
	}

	var session struct {
		Active   bool `json:"active"`
		Identity struct {
			ID     string `json:"id"`
			Traits struct {
				Email string `json:"email"`
				Name  string `json:"name"`
			} `json:"traits"`
			VerifiableAddresses []VerifiableAddress `json:"verifiable_addresses"`
		} `json:"identity"`
		AuthenticationMethods []AuthenticationMethod `json:"authentication_methods"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil || !session.Active || session.Identity.ID == "" {
		slog.Warn("identity session rejected by identity provider",
			"reason", "session_inactive_or_undecodable",
			"provider_status", resp.StatusCode,
			"decode_failed", err != nil,
			"forwarded_cookie_names", cookieNames(r),
		)
		return nil, ErrNoSession
	}
	return &SessionIdentity{
		ID:                    session.Identity.ID,
		Email:                 session.Identity.Traits.Email,
		Name:                  session.Identity.Traits.Name,
		VerifiableAddresses:   session.Identity.VerifiableAddresses,
		AuthenticationMethods: session.AuthenticationMethods,
	}, nil
}

// Authenticate resolves the request's session into the caller: identity plus
// the tenant it belongs to. The tenant comes from the database, keyed by the
// identity Kratos vouched for — never from anything the request itself carries.
func (k *KratosSessionAuthenticator) Authenticate(r *http.Request) (*UserContext, error) {
	id, err := k.Identify(r)
	if err != nil {
		return nil, err
	}
	if k.tenants == nil {
		return nil, fmt.Errorf("%w: no tenant provisioner configured", ErrTenantResolution)
	}
	tenantID, accountID, _, err := k.tenants.EnsureTenant(r.Context(), id.ID, id.Email)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTenantResolution, err)
	}
	if tenantID == "" {
		// MEET-2026-04-07-039 B7: never fall back to a "default" tenant.
		return nil, fmt.Errorf("%w: identity %s resolved to no tenant", ErrTenantResolution, id.ID)
	}
	return &UserContext{
		Subject:   id.ID,
		Email:     id.Email,
		Name:      id.Name,
		TenantID:  tenantID,
		AccountID: accountID,
	}, nil
}

// cookieNames returns only the NAMES of the request's cookies (#330).
func cookieNames(r *http.Request) []string {
	cookies := r.Cookies()
	names := make([]string, 0, len(cookies))
	for _, c := range cookies {
		names = append(names, c.Name)
	}
	return names
}
