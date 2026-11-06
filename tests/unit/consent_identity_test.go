// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// usetheoai/theo#477 step 2 — the consent handler is where every Hydra token
// gets its identity claims and its audience. These tests pin four behaviours:
//
//   - the token carries account_id (it is a cross-account guard, not a label);
//   - no token is issued without a tenant — a provisioning failure rejects consent;
//   - auto-approval is limited to an explicit allowlist of first-party clients;
//   - an RFC 8707 `resource` from the original authorization request becomes the
//     access-token audience when it is a known resource URI, and is ignored otherwise.
package unit

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/consent"
)

const (
	identityTestSubject = "kratos-user-477"
	identityTestTenant  = "tn-477"
	identityTestAccount = "acct-477"
	mcpMemoryResource   = "https://mcp.usetheo.dev/memory"
)

// oryConsentMock serves the Hydra admin consent endpoints and the Kratos admin
// identity endpoint, and records what the handler sent to accept/reject.
type oryConsentMock struct {
	clientID       string
	requestURL     string
	identityStatus int

	mu         sync.Mutex
	acceptBody map[string]interface{}
	rejectBody map[string]interface{}
}

func (m *oryConsentMock) server(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/admin/oauth2/auth/requests/consent/accept"):
			m.record(t, r, &m.acceptBody)
			_ = json.NewEncoder(w).Encode(map[string]string{"redirect_to": "https://hydra/accepted"})
		case strings.HasPrefix(r.URL.Path, "/admin/oauth2/auth/requests/consent/reject"):
			m.record(t, r, &m.rejectBody)
			_ = json.NewEncoder(w).Encode(map[string]string{"redirect_to": "https://hydra/rejected"})
		case strings.HasPrefix(r.URL.Path, "/admin/oauth2/auth/requests/consent"):
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"client":          map[string]string{"client_id": m.clientID},
				"subject":         identityTestSubject,
				"requested_scope": []string{"openid", "offline_access"},
				"request_url":     m.requestURL,
			})
		case strings.HasPrefix(r.URL.Path, "/admin/identities/"):
			if m.identityStatus != 0 && m.identityStatus != http.StatusOK {
				w.WriteHeader(m.identityStatus)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"traits": map[string]string{"email": "user477@example.com", "name": "User 477"},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func (m *oryConsentMock) record(t *testing.T, r *http.Request, into *map[string]interface{}) {
	t.Helper()
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		t.Errorf("read body: %v", err)
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Errorf("decode body %q: %v", raw, err)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	*into = body
}

func (m *oryConsentMock) accepted() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.acceptBody
}

func (m *oryConsentMock) rejected() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rejectBody
}

// tenantDB returns a sqlmock DB whose tenant fast path either finds the
// provisioned tenant (err == nil) or fails with err.
func tenantDB(t *testing.T, err error) *auth.TenantProvisioner {
	t.Helper()
	db, mock, mockErr := sqlmock.New()
	if mockErr != nil {
		t.Fatalf("sqlmock: %v", mockErr)
	}
	t.Cleanup(func() { _ = db.Close() })
	q := mock.ExpectQuery(`SELECT t\.id, t\.account_id, tm\.role FROM tenants t JOIN tenant_members tm`).
		WithArgs(identityTestSubject)
	if err != nil {
		q.WillReturnError(err)
	} else {
		q.WillReturnRows(sqlmock.NewRows([]string{"id", "account_id", "role"}).
			AddRow(identityTestTenant, identityTestAccount, "owner"))
	}
	return auth.NewTenantProvisioner(db, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func newIdentityConsentHandler(srvURL string, prov *auth.TenantProvisioner, policy consent.Policy) *consent.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hydra := auth.NewHydraClient(srvURL, srvURL, "theo-cli")
	return consent.NewHandler(hydra, prov, srvURL, srvURL, srvURL, logger).WithPolicy(policy)
}

func runConsent(h *consent.Handler) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.Consent(rec, httptest.NewRequest(http.MethodGet, "/auth/consent?consent_challenge=chal-477", nil))
	return rec
}

func accessTokenClaims(t *testing.T, accept map[string]interface{}) map[string]interface{} {
	t.Helper()
	session, ok := accept["session"].(map[string]interface{})
	if !ok {
		t.Fatalf("accept body has no session: %v", accept)
	}
	claims, ok := session["access_token"].(map[string]interface{})
	if !ok {
		t.Fatalf("accept session has no access_token claims: %v", session)
	}
	return claims
}

func grantedAudience(t *testing.T, accept map[string]interface{}) []string {
	t.Helper()
	raw, ok := accept["grant_access_token_audience"].([]interface{})
	if !ok {
		t.Fatalf("accept body has no grant_access_token_audience: %v", accept)
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		out = append(out, v.(string))
	}
	return out
}

func authorizeURL(resources ...string) string {
	q := url.Values{"client_id": {"theo-cli"}, "response_type": {"code"}}
	for _, r := range resources {
		q.Add("resource", r)
	}
	return "https://auth.usetheo.dev/oauth2/auth?" + q.Encode()
}

var defaultPolicy = consent.Policy{FirstPartyClients: []string{"theo-cli"}}

func TestConsent_AccessTokenCarriesAccountID(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL()}
	srv := m.server(t)
	defer srv.Close()

	rec := runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, nil), defaultPolicy))

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body=%s", rec.Code, rec.Body.String())
	}
	claims := accessTokenClaims(t, m.accepted())
	if claims["account_id"] != identityTestAccount {
		t.Errorf("access_token account_id = %v, want %q", claims["account_id"], identityTestAccount)
	}
	if claims["tenant_id"] != identityTestTenant {
		t.Errorf("access_token tenant_id = %v, want %q", claims["tenant_id"], identityTestTenant)
	}
}

func TestConsent_RejectedWhenTenantProvisioningFails(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL()}
	srv := m.server(t)
	defer srv.Close()

	rec := runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, errors.New("connection refused")), defaultPolicy))

	if m.accepted() != nil {
		t.Fatalf("consent was accepted without a tenant: %v", m.accepted())
	}
	if m.rejected() == nil {
		t.Fatal("consent was not rejected at the authorization server")
	}
	if got := m.rejected()["error"]; got != "access_denied" {
		t.Errorf("reject error = %v, want access_denied", got)
	}
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "https://hydra/rejected" {
		t.Errorf("response = %d Location=%q, want 302 to the reject continuation", rec.Code, rec.Header().Get("Location"))
	}
}

func TestConsent_RejectedWhenIdentityLookupFails(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL(), identityStatus: http.StatusInternalServerError}
	srv := m.server(t)
	defer srv.Close()

	// The provisioner is never reached (no email), so no query is expected.
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	prov := auth.NewTenantProvisioner(db, slog.New(slog.NewTextHandler(io.Discard, nil)))

	runConsent(newIdentityConsentHandler(srv.URL, prov, defaultPolicy))

	if m.accepted() != nil {
		t.Fatalf("consent was accepted without a tenant: %v", m.accepted())
	}
	if m.rejected() == nil {
		t.Fatal("consent was not rejected when the identity could not be resolved")
	}
}

func TestConsent_AdmitsEveryAllowlistedFirstPartyClient(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-dashboard", requestURL: authorizeURL()}
	srv := m.server(t)
	defer srv.Close()
	policy := consent.Policy{FirstPartyClients: []string{"theo-cli", "theo-dashboard"}}

	rec := runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, nil), policy))

	if rec.Code != http.StatusFound || m.accepted() == nil {
		t.Fatalf("allowlisted client not auto-approved: status=%d accepted=%v", rec.Code, m.accepted())
	}
}

func TestConsent_RefusesClientOutsideAllowlist(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL()}
	srv := m.server(t)
	defer srv.Close()
	// theo-cli is the Hydra client this service owns, but the allowlist is the
	// only source of first-party trust: a policy that omits it must refuse it.
	policy := consent.Policy{FirstPartyClients: []string{"theo-dashboard"}}

	rec := runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, nil), policy))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if m.accepted() != nil {
		t.Fatalf("client outside the allowlist was auto-approved: %v", m.accepted())
	}
}

func TestConsent_GrantsAllowlistedResourceAsAudience(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL(mcpMemoryResource)}
	srv := m.server(t)
	defer srv.Close()
	policy := consent.Policy{FirstPartyClients: []string{"theo-cli"}, AllowedResources: []string{mcpMemoryResource}}

	runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, nil), policy))

	if got, want := grantedAudience(t, m.accepted()), []string{mcpMemoryResource}; !reflect.DeepEqual(got, want) {
		t.Errorf("granted audience = %v, want %v", got, want)
	}
}

func TestConsent_IgnoresResourceOutsideAllowlist(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL("https://attacker.example/mcp")}
	srv := m.server(t)
	defer srv.Close()
	policy := consent.Policy{FirstPartyClients: []string{"theo-cli"}, AllowedResources: []string{mcpMemoryResource}}

	runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, nil), policy))

	if got, want := grantedAudience(t, m.accepted()), []string{"theo-cloud", "theo-engine"}; !reflect.DeepEqual(got, want) {
		t.Errorf("granted audience = %v, want the default %v", got, want)
	}
}

func TestConsent_GrantsOnlyTheAllowlistedResourcesOfAMixedRequest(t *testing.T) {
	m := &oryConsentMock{clientID: "theo-cli", requestURL: authorizeURL("https://attacker.example/mcp", mcpMemoryResource)}
	srv := m.server(t)
	defer srv.Close()
	policy := consent.Policy{FirstPartyClients: []string{"theo-cli"}, AllowedResources: []string{mcpMemoryResource}}

	runConsent(newIdentityConsentHandler(srv.URL, tenantDB(t, nil), policy))

	if got, want := grantedAudience(t, m.accepted()), []string{mcpMemoryResource}; !reflect.DeepEqual(got, want) {
		t.Errorf("granted audience = %v, want %v", got, want)
	}
}
