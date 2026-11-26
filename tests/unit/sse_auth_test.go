// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// T6.0 of plan 2026-05-27-backend-frontend-integration v1.1.
//
// Originally asserted that RequireJWT accepted a JWT in `?token=<jwt>` for the
// browser EventSource. getloopscale/loopscale#477 step 3 removed that fallback: the
// dashboard stream is cookie-authenticated, and a query-string token is now
// ignored. The Bearer-header cases below still hold.

package unit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	loopscalejwt "github.com/getloopscale/contracts/jwt"
	"github.com/getloopscale/loop-console/internal/auth"
)

const (
	sseTestSecret   = "test-secret-at-least-32-bytes-long-ok!"
	sseTestIssuer   = "loop-console-test"
	sseTestAudience = "loop-runtime-engine"
)

// buildSSEChain wires RequireJWT (HMAC validator only — no Hydra RSA) around
// a sentinel handler that records whether it was reached and the resolved
// user context.
func buildSSEChain(t *testing.T) (http.Handler, *loopscalejwt.SessionTokenIssuer, *struct {
	called bool
	user   *auth.UserContext
}) {
	t.Helper()
	issuer := loopscalejwt.NewSessionTokenIssuer(sseTestSecret, sseTestIssuer, sseTestAudience, 3600*time.Second)
	state := &struct {
		called bool
		user   *auth.UserContext
	}{}
	sentinel := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state.called = true
		state.user = auth.GetUser(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	mw := auth.RequireJWT(nil, issuer)
	return mw(sentinel), issuer, state
}

func mintSSEToken(t *testing.T, issuer *loopscalejwt.SessionTokenIssuer) string {
	t.Helper()
	token, _, err := issuer.Issue("kratos-user-id-sse-1", "sse@loopscale.dev", "Sse User", "tn-sse-1", "")
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	return token
}

func TestSSEAuth_IgnoresValidQueryParamToken(t *testing.T) {
	// getloopscale/loopscale#477 step 3: the dashboard stream authenticates with the
	// session cookie, so no caller needs a credential in the URL — where it would
	// reach access logs, proxy logs, browser history and the Referer header.
	handler, issuer, state := buildSSEChain(t)
	token := mintSSEToken(t, issuer)

	req := httptest.NewRequest(http.MethodGet, "/engine/api/v1/builds/abc/logs/stream?token="+token, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", w.Code, w.Body.String())
	}
	if state.called {
		t.Fatalf("sentinel reached on a query-string token")
	}
}

func TestSSEAuth_BearerHeaderStillWorks(t *testing.T) {
	// Defense-in-depth: the EventSource fallback MUST NOT break the
	// canonical header path. Otherwise we regress every CLI/fetch caller.
	handler, issuer, state := buildSSEChain(t)
	token := mintSSEToken(t, issuer)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Bearer path broken; got %d", w.Code)
	}
	if state.user == nil {
		t.Fatal("user context missing on Bearer path")
	}
}

func TestSSEAuth_HeaderWinsOverQueryParam(t *testing.T) {
	// If both are present, the header form is preferred (it's the
	// canonical surface; the query form is an SSE escape hatch). Tests
	// the precedence to prevent a future regression where someone
	// "fixes" extract by checking query first and breaks the documented
	// security model.
	handler, issuer, state := buildSSEChain(t)

	headerToken, _, _ := issuer.Issue("user-from-header", "h@h.h", "H", "tn-h", "")
	queryToken, _, _ := issuer.Issue("user-from-query", "q@q.q", "Q", "tn-q", "")

	req := httptest.NewRequest(http.MethodGet, "/x?token="+queryToken, nil)
	req.Header.Set("Authorization", "Bearer "+headerToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if state.user == nil || state.user.Subject != "user-from-header" {
		t.Errorf("header should win; got user=%+v", state.user)
	}
}

func TestSSEAuth_RejectsMissingToken(t *testing.T) {
	handler, _, state := buildSSEChain(t)
	req := httptest.NewRequest(http.MethodGet, "/engine/api/v1/builds/abc/logs/stream", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
	if state.called {
		t.Errorf("sentinel reached despite missing token")
	}
}

func TestSSEAuth_RejectsInvalidQueryToken(t *testing.T) {
	handler, _, state := buildSSEChain(t)
	req := httptest.NewRequest(http.MethodGet, "/x?token=not-a-real-jwt", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
	if state.called {
		t.Errorf("sentinel reached despite invalid token")
	}
}

func TestSSEAuth_RejectsExpiredQueryToken(t *testing.T) {
	// Mint a token with TTL 1ns then wait — validator must reject.
	expIssuer := loopscalejwt.NewSessionTokenIssuer(sseTestSecret, sseTestIssuer, sseTestAudience, time.Nanosecond)
	expired, _, _ := expIssuer.Issue("u", "e@e.e", "E", "tn-e", "")
	time.Sleep(2 * time.Millisecond)

	handler, _, state := buildSSEChain(t)
	req := httptest.NewRequest(http.MethodGet, "/x?token="+expired, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 (expired), got %d", w.Code)
	}
	if state.called {
		t.Errorf("sentinel reached despite expired token")
	}
}

func TestSSEAuth_RejectsWrongSecretQueryToken(t *testing.T) {
	// Mint a JWT with a DIFFERENT secret — signature must fail.
	bogusIssuer := loopscalejwt.NewSessionTokenIssuer(
		"different-secret-also-at-least-32-bytes!",
		sseTestIssuer, sseTestAudience, 3600*time.Second,
	)
	bogus, _, _ := bogusIssuer.Issue("u", "x@x.x", "X", "tn-x", "")

	handler, _, _ := buildSSEChain(t)
	req := httptest.NewRequest(http.MethodGet, "/x?token="+bogus, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 (bad signature), got %d", w.Code)
	}
}
