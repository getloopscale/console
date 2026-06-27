// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// T3.1 of plan kratos-self-service-rate-limit-systemic v1.1 (EC-4 + EC-13).
//
// RegisterProxyHandler is the response-shape unifier middleware for the
// self-service registration flow. It closes Red Team theo-cloud#43
// (account-existence enumeration via response shape divergence) by ALWAYS
// returning the universal:
//
//	{
//	  "message":  "If the email is valid, we sent verification instructions.",
//	  "redirect": "/auth/check-email"
//	}
//
// regardless of whether the upstream identity-store returned 200 (new
// identity created) OR 400/409 (email already exists). Both branches emit
// byte-identical response bodies so a probing attacker cannot distinguish
// existence by reading the response.
//
// EC-4 absorption (canonical SOTA pattern — Clerk/Auth0/Firebase): the
// universal response includes a `redirect` continuation hint pointing to
// a generic check-email page. The dashboard navigates to this path on
// success; the check-email page polls the verification API separately
// (no flow_id required), so legitimate new users continue to verification
// without any branch-specific state leaking into the response.
//
// EC-13 absorption (Kratos hook semantics): welcome-email gating is NOT
// implemented by this middleware. The upstream identity-store's existing
// post-registration hook fires welcome emails ONLY for NEW identities (the
// hook is skipped for existing-email submissions because no new identity
// is created). This middleware NEVER touches the welcome-email pipeline.
// Trade-off: an attacker cannot prevent a welcome email being delivered to
// a freshly-registered legitimate account; this is intentional and
// canonical.
//
// CR-9 compliance: no internal terms ("Kratos", "Ory") appear in the
// response body or in any user-facing log line emitted from this handler.
type RegisterProxyHandler struct {
	UpstreamURL string
	HTTPClient  *http.Client
	Logger      *slog.Logger
}

// NewRegisterProxyHandler constructs a handler bound to the upstream
// identity-store URL (typically config.KratosInternalURL). The handler
// owns its HTTP client with a 5s timeout — registration must not block
// the user for longer than the universal 200 response budget.
func NewRegisterProxyHandler(upstreamURL string, logger *slog.Logger) *RegisterProxyHandler {
	return &RegisterProxyHandler{
		UpstreamURL: upstreamURL,
		HTTPClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		Logger: logger,
	}
}

// universalResponse is the canonical response shape returned for BOTH new
// and existing email submissions. EC-4: includes the redirect continuation
// hint so the dashboard navigates uniformly on success.
type universalResponse struct {
	Message  string `json:"message"`
	Redirect string `json:"redirect"`
}

// canonicalBody returns the canonical universal response shape. EC-4:
// the same body for both new and existing email branches.
func canonicalBody() universalResponse {
	return universalResponse{
		Message:  "If the email is valid, we sent verification instructions.",
		Redirect: "/auth/check-email",
	}
}

// Post is the POST /v1/auth/register handler. Forwards the request body
// to the upstream identity-store and ALWAYS returns the canonical
// universal response on any upstream non-5xx outcome. On upstream timeout
// or 5xx, returns a generic 503 with no body details (no leak).
func (h *RegisterProxyHandler) Post(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		// EC-4: even malformed input gets the canonical response (no leak
		// of "we couldn't parse your input" — that itself is a probe vector).
		h.writeUniversal(w)
		return
	}
	defer r.Body.Close()

	// Build the upstream request. Use the path from the URL query so flow
	// continuation works for legitimate browser flows; the upstream
	// validates flow_id on its side.
	upstreamPath := "/self-service/registration"
	flow := r.URL.Query().Get("flow")
	if flow != "" {
		upstreamPath += "?flow=" + flow
	}
	upstreamReq, err := http.NewRequestWithContext(
		r.Context(), http.MethodPost, h.UpstreamURL+upstreamPath, bytes.NewReader(body))
	if err != nil {
		if h.Logger != nil {
			h.Logger.Warn("register-proxy: upstream request build failed",
				"err", err.Error())
		}
		h.writeError503(w)
		return
	}
	// Forward critical headers (Content-Type + Accept).
	if ct := r.Header.Get("Content-Type"); ct != "" {
		upstreamReq.Header.Set("Content-Type", ct)
	}
	if acc := r.Header.Get("Accept"); acc != "" {
		upstreamReq.Header.Set("Accept", acc)
	}

	resp, err := h.HTTPClient.Do(upstreamReq)
	if err != nil {
		if h.Logger != nil {
			h.Logger.Warn("register-proxy: upstream call failed",
				"err", err.Error())
		}
		h.writeError503(w)
		return
	}
	defer resp.Body.Close()

	// On upstream 5xx, return generic 503. EC-4: never propagate upstream
	// error details — they may include "user exists" or similar leaks.
	if resp.StatusCode >= 500 {
		if h.Logger != nil {
			h.Logger.Warn("register-proxy: upstream 5xx",
				"upstream_status", resp.StatusCode)
		}
		h.writeError503(w)
		return
	}

	// EC-4: any non-5xx upstream outcome (200 new-user success, 400
	// validation error, 409 conflict / email-exists) maps to the canonical
	// universal response — identical for both new and existing branches.
	// Submission Content-Type detection: a form-encoded submission (the
	// canonical dashboard register form) receives an HTTP 303 redirect to
	// the canonical redirect path so the browser navigates to the generic
	// check-email page. A JSON / API client receives the canonical JSON
	// body so it can drive its own continuation logic. EC-4 invariant
	// holds: both shapes are byte-identical between new and existing email
	// branches (no enumeration).
	if isFormEncoded(r) {
		h.writeRedirect303(w)
		return
	}
	h.writeUniversal(w)
}

// isFormEncoded reports whether the request is form-encoded (the canonical
// dashboard register form submission shape).
func isFormEncoded(r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	return strings.HasPrefix(ct, "application/x-www-form-urlencoded") ||
		strings.HasPrefix(ct, "multipart/form-data")
}

func (h *RegisterProxyHandler) writeUniversal(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(canonicalBody())
}

// writeRedirect303 emits HTTP 303 + Location header pointing at the canonical
// redirect path. The browser will follow with a GET, landing on
// /auth/check-email regardless of new-vs-existing email branch (EC-4
// invariant preserved for form-encoded clients).
func (h *RegisterProxyHandler) writeRedirect303(w http.ResponseWriter) {
	w.Header().Set("Location", canonicalBody().Redirect)
	w.WriteHeader(http.StatusSeeOther)
}

func (h *RegisterProxyHandler) writeError503(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": "Service temporarily unavailable. Try again in a moment.",
	})
}
