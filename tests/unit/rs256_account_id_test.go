// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// getloopscale/loopscale#477 step 2 — RequireJWT must surface account_id from a Hydra
// RS256 access token. Before this, only the HMAC session path set AccountID, so
// every consumer that gates on `uc.AccountID != ""` (the M1 cross-account guard
// in forward-auth and MCP-resolve) silently skipped the check for an RS256 caller.
package unit

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	loopscalejwt "github.com/getloopscale/contracts/jwt"
	goJWT "github.com/golang-jwt/jwt/v5"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/routes"
)

const (
	rs256TestIssuer = "https://auth.test/"
	rs256TestKID    = "rs256-test-key"
)

// hydraSigner is an in-process stand-in for Hydra: an RSA key, its JWKS, and a
// validator configured exactly as production configures it (loop-console + loop-runtime).
type hydraSigner struct {
	key       *rsa.PrivateKey
	validator *loopscalejwt.Validator
}

func newHydraSigner(t *testing.T) *hydraSigner {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"keys": []map[string]string{{
			"kid": rs256TestKID,
			"kty": "RSA",
			"use": "sig",
			"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(jwks.Close)
	return &hydraSigner{
		key:       key,
		validator: loopscalejwt.NewValidatorWithAudiences(jwks.URL, rs256TestIssuer, []string{"loop-console", "loop-runtime-engine"}),
	}
}

func (s *hydraSigner) mint(t *testing.T, extra goJWT.MapClaims) string {
	t.Helper()
	claims := goJWT.MapClaims{
		"iss": rs256TestIssuer,
		"sub": "kratos-user-rs256",
		"aud": []string{"loop-console", "loop-runtime-engine"},
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	for k, v := range extra {
		claims[k] = v
	}
	tok := goJWT.NewWithClaims(goJWT.SigningMethodRS256, claims)
	tok.Header["kid"] = rs256TestKID
	signed, err := tok.SignedString(s.key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

// userAfterRequireJWT runs RequireJWT (RS256 only) and returns the UserContext
// it attached, or nil when the request did not reach the handler.
func userAfterRequireJWT(t *testing.T, s *hydraSigner, token string) *auth.UserContext {
	t.Helper()
	var got *auth.UserContext
	h := auth.RequireJWT(s.validator, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = auth.GetUser(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got == nil {
		t.Fatalf("RequireJWT refused the token: %d %s", rec.Code, rec.Body.String())
	}
	return got
}

func TestRequireJWT_RS256SetsAccountIDFromTopLevelClaim(t *testing.T) {
	s := newHydraSigner(t)
	token := s.mint(t, goJWT.MapClaims{"tenant_id": "tn-top", "account_id": "acct-top"})

	uc := userAfterRequireJWT(t, s, token)

	if uc.AccountID != "acct-top" {
		t.Errorf("AccountID = %q, want %q", uc.AccountID, "acct-top")
	}
}

func TestRequireJWT_RS256SetsAccountIDFromExtWhenNotTopLevel(t *testing.T) {
	s := newHydraSigner(t)
	token := s.mint(t, goJWT.MapClaims{"ext": map[string]string{"tenant_id": "tn-ext", "account_id": "acct-ext"}})

	uc := userAfterRequireJWT(t, s, token)

	if uc.AccountID != "acct-ext" {
		t.Errorf("AccountID = %q, want %q", uc.AccountID, "acct-ext")
	}
}

func TestRequireJWT_RS256TopLevelAccountIDWinsOverExt(t *testing.T) {
	s := newHydraSigner(t)
	token := s.mint(t, goJWT.MapClaims{
		"tenant_id": "tn-both", "account_id": "acct-top",
		"ext": map[string]string{"account_id": "acct-ext"},
	})

	uc := userAfterRequireJWT(t, s, token)

	if uc.AccountID != "acct-top" {
		t.Errorf("AccountID = %q, want the top-level %q", uc.AccountID, "acct-top")
	}
}

func TestRequireJWT_RS256WithoutAccountIDStillAuthenticates(t *testing.T) {
	s := newHydraSigner(t)
	token := s.mint(t, goJWT.MapClaims{"tenant_id": "tn-legacy"})

	uc := userAfterRequireJWT(t, s, token)

	if uc.AccountID != "" || uc.TenantID != "tn-legacy" {
		t.Errorf("legacy token: AccountID=%q TenantID=%q, want \"\" and tn-legacy", uc.AccountID, uc.TenantID)
	}
}

type recordingMinter struct{ called bool }

func (m *recordingMinter) KeyForTenantScoped(context.Context, string, string, []string) (string, error) {
	m.called = true
	return "minted", nil
}

// The cross-account guard in forward-auth fires only when the resolved identity
// carries an AccountID. Composing RequireJWT in front of it proves an RS256
// caller now reaches the guard: an account that does not own the tenant is 403.
func TestForwardAuth_EnforcesCrossAccountGuardForRS256Caller(t *testing.T) {
	s := newHydraSigner(t)
	token := s.mint(t, goJWT.MapClaims{"tenant_id": "tn-victim", "account_id": "acct-attacker"})

	var authorizeCalledWith [2]string
	authorize := func(_ context.Context, accountID, tenantID string) (bool, error) {
		authorizeCalledWith = [2]string{accountID, tenantID}
		return false, nil
	}
	resolveFromJWT := func(ctx context.Context, _ string) (*auth.UserContext, []string, error) {
		return auth.GetUser(ctx), []string{"memory:read"}, nil
	}
	minter := &recordingMinter{}
	fa := routes.NewForwardAuthHandler(resolveFromJWT, minter, authorize, "memory:read", slog.New(slog.NewTextHandler(io.Discard, nil)))
	chain := auth.RequireJWT(s.validator, nil)(fa)

	req := httptest.NewRequest(http.MethodGet, routes.AuthzForwardPath, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if authorizeCalledWith != [2]string{"acct-attacker", "tn-victim"} {
		t.Fatalf("cross-account guard not consulted for the RS256 caller (called with %v)", authorizeCalledWith)
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 CROSS_ACCOUNT; body=%s", rec.Code, rec.Body.String())
	}
	if minter.called {
		t.Error("a credential was minted for an account that does not own the tenant")
	}
}
