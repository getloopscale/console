// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// T3.1 of plan kratos-self-service-rate-limit-systemic v1.1 — register-proxy
// response-shape unifier middleware tests. 5 tests covering all 4 plan
// scenarios + the EC-4 absorption (dashboard continuation guarantee).

func newProxyWithUpstream(t *testing.T, upstream *httptest.Server) *RegisterProxyHandler {
	t.Helper()
	return NewRegisterProxyHandler(upstream.URL, nil)
}

func mustReadJSON(t *testing.T, body io.Reader) map[string]string {
	t.Helper()
	all, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	m := map[string]string{}
	if err := json.Unmarshal(all, &m); err != nil {
		t.Fatalf("unmarshal body=%q: %v", string(all), err)
	}
	return m
}

// Regression (2026-07-12, dogfood J-UI-10): a browser registration submit makes
// the upstream identity-store answer with a 303 to its public browser URL
// (KRATOS_PUBLIC_URL, e.g. http://localhost:8090/...). The proxy's HTTP client
// MUST NOT follow that redirect — inside the gateway container `localhost:8090`
// is the container's own loopback with nothing listening, so following it fails
// with "connection refused" and the handler wrongly emits 503. A reverse proxy
// captures the upstream redirect and lets the real browser follow it. This test
// pins: upstream 303 (Location unreachable-if-followed) → canonical 303, never 503.
func TestRegisterProxy_UpstreamRedirect_NotFollowed_Returns303(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// http://127.0.0.1:1 is unreachable; if the client FOLLOWS this 303 the
		// Do() call errors and the handler returns 503 (the bug).
		w.Header().Set("Location", "http://127.0.0.1:1/login?id=deadbeef")
		w.WriteHeader(http.StatusSeeOther)
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`traits.email=x%40e2e.test&method=password&password=valid-13c-pwd!`)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if rr.Code == http.StatusServiceUnavailable {
		t.Fatalf("proxy followed the upstream redirect and 503'd instead of capturing it: body=%s", rr.Body.String())
	}
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("want canonical 303 on upstream redirect, got %d body=%s", rr.Code, rr.Body.String())
	}
	if loc := rr.Header().Get("Location"); loc != "/auth/check-email" {
		t.Errorf("want canonical Location=/auth/check-email, got %q", loc)
	}
}

func TestRegisterProxy_NewEmail_Returns200UniversalMessage(t *testing.T) {
	// Upstream simulates new-email path: 200 + canonical Kratos-like success body.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"identity":{"id":"abc123"}}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`{"email":"new@example.com","password":"valid-13c-pwd!"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200 universal response, got %d body=%s", rr.Code, rr.Body.String())
	}
	got := mustReadJSON(t, rr.Body)
	if !strings.Contains(got["message"], "If the email is valid") {
		t.Errorf("want canonical message, got %q", got["message"])
	}
	if got["redirect"] != "/auth/check-email" {
		t.Errorf("want redirect=/auth/check-email, got %q", got["redirect"])
	}
}

func TestRegisterProxy_ExistingEmail_Returns200UniversalMessageNotLeakingExistence(t *testing.T) {
	// Upstream simulates existing-email path: 400 + error body saying "exists".
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"An account with the same identifier exists already."}}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`{"email":"existing@example.com","password":"valid-13c-pwd!"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200 universal response (no leak via status), got %d body=%s",
			rr.Code, rr.Body.String())
	}
	got := mustReadJSON(t, rr.Body)
	// Critical: response body MUST NOT contain "exists" / "already" or any
	// hint that the email is known to the system.
	bodyStr := strings.ToLower(rr.Body.String())
	for _, leak := range []string{"exists", "already", "in use", "identifier", "duplicate"} {
		if strings.Contains(bodyStr, leak) {
			t.Errorf("response leaks existence hint %q in body: %s", leak, rr.Body.String())
		}
	}
	if !strings.Contains(got["message"], "If the email is valid") {
		t.Errorf("want canonical message, got %q", got["message"])
	}
}

func TestRegisterProxy_UpstreamError_Returns503OrGenericError(t *testing.T) {
	// Upstream simulates 5xx outage.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"backend exploded"}}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`{"email":"any@example.com","password":"x"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 on upstream 5xx, got %d body=%s", rr.Code, rr.Body.String())
	}
	// Body must NOT leak upstream error details.
	bodyStr := strings.ToLower(rr.Body.String())
	for _, leak := range []string{"backend exploded", "kratos", "ory"} {
		if strings.Contains(bodyStr, leak) {
			t.Errorf("503 response leaks upstream details %q in body: %s", leak, rr.Body.String())
		}
	}
}

func TestRegisterProxy_ResponseShape_IsIdenticalAcrossNewVsExistingEmail(t *testing.T) {
	// Side-by-side check: both branches MUST produce byte-identical body.
	upstreamNew := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"identity":{"id":"new"}}`))
	}))
	defer upstreamNew.Close()
	upstreamExisting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"exists"}}`))
	}))
	defer upstreamExisting.Close()

	hNew := newProxyWithUpstream(t, upstreamNew)
	hExisting := newProxyWithUpstream(t, upstreamExisting)

	makeReq := func() *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
			bytes.NewReader([]byte(`{"email":"probe@example.com","password":"x"}`)))
		r.Header.Set("Content-Type", "application/json")
		return r
	}

	rrNew := httptest.NewRecorder()
	hNew.Post(rrNew, makeReq())
	rrExisting := httptest.NewRecorder()
	hExisting.Post(rrExisting, makeReq())

	if rrNew.Code != rrExisting.Code {
		t.Fatalf("status code diverges: new=%d existing=%d", rrNew.Code, rrExisting.Code)
	}
	if rrNew.Body.String() != rrExisting.Body.String() {
		t.Fatalf("body diverges — enumeration leak. new=%s existing=%s",
			rrNew.Body.String(), rrExisting.Body.String())
	}
}

// T3.4 wiring: form-encoded submissions (the canonical dashboard register
// form shape) MUST receive HTTP 303 + Location header instead of JSON body,
// so the browser navigates to the canonical redirect path on form.submit().
// EC-4 invariant holds: identical 303 redirect for both new + existing email.
func TestRegisterProxy_FormEncoded_Returns303RedirectToCheckEmail(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"identity":{"id":"abc"}}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`csrf_token=x&method=password&traits.email=new%40example.com&traits.name=N&password=valid-13c-pwd`)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("want 303 for form-encoded submission, got %d", rr.Code)
	}
	if loc := rr.Header().Get("Location"); loc != "/auth/check-email" {
		t.Errorf("want Location=/auth/check-email, got %q", loc)
	}
}

// EC-4 absorption: dashboard-continuation guarantee. The universal redirect
// field MUST point to a generic continuation path that does NOT require a
// flow token — so legitimate new users can advance to verification without
// any branch-specific state leaking.
func TestRegisterProxy_DashboardCanContinue_WithoutFlowToken_OnNewEmailSuccess(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		// Upstream returns a real flow continuation token; canonical handler
		// MUST NOT propagate it into the response body.
		_, _ = w.Write([]byte(`{"identity":{"id":"new"},"continue_with":[{"action":"show_verification_ui","flow":{"id":"flow-secret-deadbeef","url":"https://kratos.example.com/self-service/verification?flow=flow-secret-deadbeef"}}]}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`{"email":"new@example.com","password":"valid-13c-pwd!"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	got := mustReadJSON(t, rr.Body)
	// Redirect MUST be the canonical generic path — NOT a flow-specific URL.
	if got["redirect"] != "/auth/check-email" {
		t.Errorf("want redirect=/auth/check-email (generic, no flow token), got %q",
			got["redirect"])
	}
	// Flow token MUST NOT appear anywhere in the response.
	bodyStr := rr.Body.String()
	if strings.Contains(bodyStr, "flow-secret-deadbeef") {
		t.Errorf("flow token from upstream leaked into response body: %s", bodyStr)
	}
	if strings.Contains(bodyStr, "kratos.example.com") {
		t.Errorf("upstream URL leaked into response body: %s", bodyStr)
	}
	// Dashboard navigation primitive: redirect must be a relative path that
	// works without any flow_id parameter — proves the dashboard can
	// continue without branch-specific state.
	if !strings.HasPrefix(got["redirect"], "/") {
		t.Errorf("redirect must be a relative path for dashboard continuation, got %q",
			got["redirect"])
	}
}

// F-sec-3 absorption regression-protector: malformed `?flow=` query parameter
// MUST NOT be concatenated raw into the upstream URL. A flow that fails the
// canonical UUID shape returns the universal response WITHOUT making the
// upstream call (universal response also ensures no enumeration leak).
func TestRegisterProxy_RejectsMalformedFlowID_NoSSRFConcat(t *testing.T) {
	var upstreamHit bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHit = true
		// If the upstream IS hit, ensure the malformed flow did not slip
		// through as a raw query injection.
		if got := r.URL.Query().Get("flow"); strings.Contains(got, "&admin=true") || strings.Contains(got, "#") {
			t.Errorf("SSRF: malformed flow leaked to upstream: %q", got)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	// Adversarial query: not-a-UUID with attempted parameter injection.
	req := httptest.NewRequest(http.MethodPost,
		"/v1/auth/register?flow=abc&admin=true",
		bytes.NewReader([]byte(`{"email":"x@example.com","password":"valid-13c-pwd!"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if upstreamHit {
		t.Fatalf("upstream MUST NOT be called when flow_id is malformed (defense-in-depth against SSRF)")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("want 200 universal response on malformed flow, got %d", rr.Code)
	}
	got := mustReadJSON(t, rr.Body)
	if got["message"] != "If the email is valid, we sent verification instructions." {
		t.Errorf("want canonical universal message, got %q", got["message"])
	}
}

// F-sec-3 absorption: a well-formed UUID flow_id IS forwarded to upstream,
// canonically encoded via url.Values (no raw concat).
func TestRegisterProxy_AcceptsCanonicalFlowID_EncodesViaURLValues(t *testing.T) {
	const canonicalFlow = "23abd533-a011-419d-9c88-052032827663"
	var observedFlow string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedFlow = r.URL.Query().Get("flow")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	req := httptest.NewRequest(http.MethodPost,
		"/v1/auth/register?flow="+canonicalFlow,
		bytes.NewReader([]byte(`{"email":"x@example.com","password":"valid-13c-pwd!"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if observedFlow != canonicalFlow {
		t.Errorf("upstream observed flow=%q, want %q (canonical UUID propagated)", observedFlow, canonicalFlow)
	}
	if rr.Code != http.StatusOK {
		t.Errorf("want 200, got %d", rr.Code)
	}
}

// F-sec-5 absorption: bodies larger than maxRegisterBodyBytes (64 KiB) MUST
// be rejected without unbounded allocation. The universal response still
// fires (no enumeration leak).
func TestRegisterProxy_RejectsOversizedBody_NoUnboundedAllocation(t *testing.T) {
	var upstreamHit bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)
	// 128 KiB body — twice the cap.
	huge := bytes.Repeat([]byte("A"), 128*1024)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader(huge))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.Post(rr, req)

	if upstreamHit {
		t.Fatalf("upstream MUST NOT be called when body exceeds cap")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("want 200 universal (per EC-4 no-leak invariant), got %d", rr.Code)
	}
}

// F-sec-8 absorption: cache-control headers stamped on the universal +
// redirect + 503 branches so a CDN / browser back-button cannot surface a
// stale response (which includes the redirect hint) to an unrelated user.
func TestRegisterProxy_ResponsesHaveCacheControlNoStore(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()

	h := newProxyWithUpstream(t, upstream)

	// JSON branch — universal 200.
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`{"email":"x@example.com"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Post(rr, req)
	if cc := rr.Header().Get("Cache-Control"); cc != "no-store, private" {
		t.Errorf("universal 200: want Cache-Control=no-store, private; got %q", cc)
	}

	// Form-encoded branch — 303 redirect.
	req2 := httptest.NewRequest(http.MethodPost, "/v1/auth/register",
		bytes.NewReader([]byte(`email=x@example.com`)))
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr2 := httptest.NewRecorder()
	h.Post(rr2, req2)
	if cc := rr2.Header().Get("Cache-Control"); cc != "no-store, private" {
		t.Errorf("303 redirect: want Cache-Control=no-store, private; got %q", cc)
	}
}
