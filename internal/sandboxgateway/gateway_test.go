// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package sandboxgateway_test

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/getloopscale/contracts/serviceauth"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/sandboxgateway"
)

type rig struct {
	gateway  *httptest.Server
	received chan *http.Request
	bodies   chan string
	pub      ed25519.PublicKey
}

// newRig starts a sandbox double and a gateway in front of it. The gateway
// authenticates every caller as caller; a nil caller is an unauthenticated one.
func newRig(t *testing.T, caller *auth.UserContext, upstream http.HandlerFunc) *rig {
	t.Helper()
	r := &rig{received: make(chan *http.Request, 4), bodies: make(chan string, 4)}
	sandbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		r.received <- req
		r.bodies <- string(body)
		if upstream != nil {
			upstream(w, req)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"sbx_1"}`))
	}))
	t.Cleanup(sandbox.Close)

	pub, priv, _ := ed25519.GenerateKey(nil)
	r.pub = pub
	signer, err := auth.NewServiceSigner(priv)
	if err != nil {
		t.Fatal(err)
	}
	target, _ := url.Parse(sandbox.URL)
	handler, err := sandboxgateway.New(target, signer, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	r.gateway = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if caller != nil {
			req = req.WithContext(auth.WithUser(req.Context(), caller))
		}
		handler.ServeHTTP(w, req)
	}))
	t.Cleanup(r.gateway.Close)
	return r
}

func (r *rig) do(t *testing.T, method, path, body string, headers map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, r.gateway.URL+path, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

var alice = &auth.UserContext{Subject: "usr-alice", TenantID: "tenant-a", Email: "alice@example.test"}

func TestForwardsTheRequestUnchangedAndReturnsTheAnswer(t *testing.T) {
	r := newRig(t, alice, nil)

	resp := r.do(t, http.MethodPost, "/v1/sandboxes/sbx_1/exec?wait=1", `{"cmd":["true"]}`, map[string]string{"Content-Type": "application/json"})

	got := <-r.received
	if got.Method != http.MethodPost || got.URL.Path != "/v1/sandboxes/sbx_1/exec" || got.URL.RawQuery != "wait=1" {
		t.Errorf("the sandbox received %s %s?%s", got.Method, got.URL.Path, got.URL.RawQuery)
	}
	if body := <-r.bodies; body != `{"cmd":["true"]}` {
		t.Errorf("the sandbox received the body %q", body)
	}
	answer, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated || string(answer) != `{"id":"sbx_1"}` {
		t.Errorf("the caller received %d %s", resp.StatusCode, answer)
	}
}

func TestSignsTheCallersUserAndTenant(t *testing.T) {
	r := newRig(t, alice, nil)

	r.do(t, http.MethodGet, "/v1/sandboxes", "", nil)

	got := <-r.received
	ts, _ := strconv.ParseInt(got.Header.Get("X-Loop-Runtime-Timestamp"), 10, 64)
	err := serviceauth.Verify([]ed25519.PublicKey{r.pub}, got.Header.Get("X-Loop-Runtime-Signature"), serviceauth.PayloadInput{
		UserID: "usr-alice", TenantID: "tenant-a", Timestamp: ts,
		Nonce: got.Header.Get("X-Loop-Runtime-Nonce"), Method: http.MethodGet, Path: "/v1/sandboxes",
	})
	if err != nil {
		t.Errorf("the signature does not cover usr-alice, tenant-a, GET and /v1/sandboxes: %v", err)
	}
	if time.Since(time.Unix(ts, 0)) > time.Minute {
		t.Errorf("the signed timestamp %d is not the current time", ts)
	}
}

func TestACallerCannotChooseTheTenantOrKeepItsCredential(t *testing.T) {
	r := newRig(t, alice, nil)

	r.do(t, http.MethodGet, "/v1/sandboxes", "", map[string]string{
		"Authorization":            "Bearer the-callers-own-key",
		"Cookie":                   "session=abc",
		"X-Loop-Runtime-Tenant":    "tenant-b",
		"X-Loop-Runtime-User-ID":   "usr-mallory",
		"x-loop-runtime-signature": "forged",
		"X-Loop-Runtime-Email":     "mallory@example.test",
	})

	got := <-r.received
	if tenant, user := got.Header.Get("X-Loop-Runtime-Tenant"), got.Header.Get("X-Loop-Runtime-User-ID"); tenant != "tenant-a" || user != "usr-alice" {
		t.Errorf("the sandbox received tenant %q and user %q", tenant, user)
	}
	if len(got.Header.Values("X-Loop-Runtime-Tenant")) != 1 || got.Header.Get("X-Loop-Runtime-Signature") == "forged" {
		t.Error("a header the caller sent reached the sandbox next to the signed one")
	}
	for _, name := range []string{"Authorization", "Cookie", "X-Loop-Runtime-Email"} {
		if v := got.Header.Get(name); v != "" {
			t.Errorf("%s reached the sandbox: %q", name, v)
		}
	}
}

func TestRefusesARequestWithNoCaller(t *testing.T) {
	for name, caller := range map[string]*auth.UserContext{
		"no caller": nil,
		"no tenant": {Subject: "usr-alice"},
		"no user":   {TenantID: "tenant-a"},
	} {
		t.Run(name, func(t *testing.T) {
			r := newRig(t, caller, nil)

			resp := r.do(t, http.MethodGet, "/v1/sandboxes", "", nil)

			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", resp.StatusCode)
			}
			select {
			case <-r.received:
				t.Error("the request reached the sandbox")
			default:
			}
		})
	}
}

func TestStreamsTheAnswerAsItArrives(t *testing.T) {
	release := make(chan struct{})
	r := newRig(t, alice, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: first\n\n"))
		w.(http.Flusher).Flush()
		<-release
	})
	defer close(release)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, r.gateway.URL+"/v1/sandboxes/sbx_1/exec/stream", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("no answer while the sandbox was still writing: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil || line != "data: first\n" {
		t.Errorf("first line = %q, err = %v; want it before the sandbox finishes", line, err)
	}
}

func TestAnAnswerSlowerThanTheServersTimeoutsStillArrives(t *testing.T) {
	// A command in a sandbox may run for minutes. The console's server cuts an
	// answer at its WriteTimeout unless the gateway lifts the deadline.
	_, priv, _ := ed25519.GenerateKey(nil)
	signer, _ := auth.NewServiceSigner(priv)
	sandbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(600 * time.Millisecond)
		_, _ = w.Write([]byte("done"))
	}))
	defer sandbox.Close()
	target, _ := url.Parse(sandbox.URL)
	handler, _ := sandboxgateway.New(target, signer, slog.New(slog.NewTextHandler(io.Discard, nil)))
	console := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		handler.ServeHTTP(w, req.WithContext(auth.WithUser(req.Context(), alice)))
	}))
	console.Config.WriteTimeout = 200 * time.Millisecond
	console.Config.ReadTimeout = 200 * time.Millisecond
	console.Start()
	defer console.Close()

	resp, err := http.Post(console.URL+"/v1/sandboxes/sbx_1/exec", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("the answer was cut: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if body, _ := io.ReadAll(resp.Body); string(body) != "done" {
		t.Errorf("body = %q, want the sandbox's answer", body)
	}
}

func TestAnswers502WhenTheSandboxIsDown(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(nil)
	signer, _ := auth.NewServiceSigner(priv)
	target, _ := url.Parse("http://127.0.0.1:1")
	handler, _ := sandboxgateway.New(target, signer, slog.New(slog.NewTextHandler(io.Discard, nil)))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/sandboxes", nil)

	handler.ServeHTTP(rec, req.WithContext(auth.WithUser(req.Context(), alice)))

	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "SANDBOX_UNAVAILABLE") {
		t.Errorf("answer = %d %s, want 502 SANDBOX_UNAVAILABLE", rec.Code, rec.Body.String())
	}
}

func TestNewRefusesAnIncompleteConfiguration(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(nil)
	signer, _ := auth.NewServiceSigner(priv)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	good, _ := url.Parse("http://sandbox.internal:8080")
	noHost, _ := url.Parse("sandbox.internal")

	if _, err := sandboxgateway.New(noHost, signer, log); err == nil {
		t.Error("a target with no scheme was accepted")
	}
	if _, err := sandboxgateway.New(good, nil, log); err == nil {
		t.Error("a gateway with no signer was accepted")
	}
}
