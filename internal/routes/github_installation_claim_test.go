// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/auth"
)

type recordedClaim struct {
	method, path string
	header       http.Header
	body         map[string]any
}

// engineStub answers the claim endpoint with a fixed status and body and
// records what it received.
func engineStub(t *testing.T, status int, body string) (*httptest.Server, *recordedClaim) {
	t.Helper()
	got := &recordedClaim{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.path, got.header = r.Method, r.URL.Path, r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got.body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

type signerStub struct{ attached int }

func (s *signerStub) Attach(r *http.Request) error {
	s.attached++
	r.Header.Set("X-Loop-Runtime-Signature", "signed")
	return nil
}

func TestEngineClaimer_PostsTheCodeAsTheUser(t *testing.T) {
	srv, got := engineStub(t, http.StatusOK,
		`{"installations":[{"id":1,"account_login":"acme","account_type":"Organization"},{"id":2,"account_login":"dev","account_type":"User"}]}`)
	signer := &signerStub{}
	claimer := NewEngineGitHubClaimer(srv.URL, srv.Client(), "service-secret", signer)

	n, err := claimer.ClaimInstallations(context.Background(), ghTestUser, ghTestOAuthCode)
	if err != nil {
		t.Fatalf("ClaimInstallations: %v", err)
	}
	if n != 2 {
		t.Fatalf("installations = %d, want 2", n)
	}
	if got.method != http.MethodPost || got.path != "/api/v1/integrations/github/installations/claim" {
		t.Fatalf("request = %s %s, want POST on the claim path", got.method, got.path)
	}
	if got.body["code"] != ghTestOAuthCode || len(got.body) != 1 {
		t.Fatalf("body = %v, want only the code", got.body)
	}
	if got.header.Get(auth.EngineUserIDHeader) != "user-1" || got.header.Get(auth.EngineTenantHeader) != "tenant-1" ||
		got.header.Get(auth.EngineEmailHeader) != "dev@example.test" {
		t.Fatalf("identity headers = %v, want the signed-in user's", got.header)
	}
	if got.header.Get("X-Service-Auth") != "service-secret" {
		t.Fatal("the service secret was not sent")
	}
	if signer.attached != 1 || got.header.Get("X-Loop-Runtime-Signature") != "signed" {
		t.Fatal("the request was not signed")
	}
}

func TestEngineClaimer_EmptyListIsNoInstallation(t *testing.T) {
	srv, _ := engineStub(t, http.StatusOK, `{"installations":[]}`)
	n, err := NewEngineGitHubClaimer(srv.URL, srv.Client(), "s", nil).ClaimInstallations(context.Background(), ghTestUser, ghTestOAuthCode)
	if err != nil || n != 0 {
		t.Fatalf("got (%d, %v), want (0, nil)", n, err)
	}
}

func TestEngineClaimer_ErrorCarriesTheEngineCodeAndNotItsMessage(t *testing.T) {
	srv, _ := engineStub(t, http.StatusBadRequest,
		`{"code":"GITHUB_CODE_REJECTED","message":"GitHub said: bad_verification_code for `+ghTestOAuthCode+`"}`)
	_, err := NewEngineGitHubClaimer(srv.URL, srv.Client(), "s", nil).ClaimInstallations(context.Background(), ghTestUser, ghTestOAuthCode)
	var claimErr *GitHubClaimError
	if !errors.As(err, &claimErr) {
		t.Fatalf("err = %v, want a *GitHubClaimError", err)
	}
	if claimErr.Code != "GITHUB_CODE_REJECTED" {
		t.Fatalf("Code = %q, want GITHUB_CODE_REJECTED", claimErr.Code)
	}
	if strings.Contains(err.Error(), ghTestOAuthCode) || strings.Contains(err.Error(), "bad_verification_code") {
		t.Fatalf("error text %q repeats the engine's message", err.Error())
	}
}

func TestEngineClaimer_UnreadableErrorBodyIsAnInternalError(t *testing.T) {
	srv, _ := engineStub(t, http.StatusBadGateway, `<html>bad gateway</html>`)
	_, err := NewEngineGitHubClaimer(srv.URL, srv.Client(), "s", nil).ClaimInstallations(context.Background(), ghTestUser, ghTestOAuthCode)
	var claimErr *GitHubClaimError
	if !errors.As(err, &claimErr) || claimErr.Code != "INTERNAL_ERROR" {
		t.Fatalf("err = %v, want INTERNAL_ERROR", err)
	}
}

func TestEngineClaimer_UnreachableEngineIsServiceUnavailable(t *testing.T) {
	srv, _ := engineStub(t, http.StatusOK, `{}`)
	base := srv.URL
	srv.Close()
	_, err := NewEngineGitHubClaimer(base, &http.Client{}, "s", nil).ClaimInstallations(context.Background(), ghTestUser, ghTestOAuthCode)
	var claimErr *GitHubClaimError
	if !errors.As(err, &claimErr) || claimErr.Code != "SERVICE_UNAVAILABLE" {
		t.Fatalf("err = %v, want SERVICE_UNAVAILABLE", err)
	}
	if strings.Contains(err.Error(), ghTestOAuthCode) {
		t.Fatalf("error text %q carries the code", err.Error())
	}
}

func TestEngineClaimer_RefusesACallWithoutAnIdentity(t *testing.T) {
	srv, got := engineStub(t, http.StatusOK, `{"installations":[]}`)
	_, err := NewEngineGitHubClaimer(srv.URL, srv.Client(), "s", nil).ClaimInstallations(context.Background(), nil, ghTestOAuthCode)
	if err == nil {
		t.Fatal("want an error for a nil user")
	}
	if got.method != "" {
		t.Fatal("the engine was called without an identity")
	}
}
