// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Package sandboxgateway forwards the sandbox API to a LoopSandbox deployment
// that runs with LOOPSANDBOX_AUTH=gateway.
package sandboxgateway

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/getloopscale/loop-console/internal/auth"
)

// Signer signs an outbound request whose identity headers are already set.
// *auth.ServiceSigner implements it.
type Signer interface {
	Attach(r *http.Request) error
}

// identityHeaderPrefix covers the identity and signature headers. A caller must
// never be able to supply one: the sandbox reads its tenant from them.
const identityHeaderPrefix = "X-Loop-Runtime-"

// New returns a handler that forwards a request of an authenticated caller to
// the sandbox API at target, with the method, path, query and body unchanged.
//
// The caller's credential stays here. The sandbox receives the caller's user and
// tenant in headers signed by signer, and trusts nothing else. The handler must
// sit behind a middleware that puts the caller in the request context.
func New(target *url.URL, signer Signer, logger *slog.Logger) (http.Handler, error) {
	if target == nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		return nil, errors.New("sandbox gateway: the target must be an http or https URL with a host")
	}
	if signer == nil {
		return nil, errors.New("sandbox gateway: a signer is required, the sandbox accepts signed requests only")
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
		},
		// Command output and code cells are streamed: write every chunk as it arrives.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.Warn("sandbox gateway: upstream request failed", "path", r.URL.Path, "error", err)
			writeError(w, http.StatusBadGateway, "SANDBOX_UNAVAILABLE", "The sandbox service is unavailable. Try again.")
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil || user.Subject == "" || user.TenantID == "" {
			writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
			return
		}
		// A command, an upload or a terminal outlives the server's timeouts, which
		// are set for dashboard calls. The sandbox bounds its own operations.
		deadlines := http.NewResponseController(w)
		_ = deadlines.SetReadDeadline(time.Time{})
		_ = deadlines.SetWriteDeadline(time.Time{})

		out := r.Clone(r.Context())
		for name := range out.Header {
			if strings.HasPrefix(http.CanonicalHeaderKey(name), identityHeaderPrefix) {
				out.Header.Del(name)
			}
		}
		out.Header.Del("Authorization")
		out.Header.Del("Cookie")
		out.Header.Set(auth.EngineUserIDHeader, user.Subject)
		out.Header.Set(auth.EngineTenantHeader, user.TenantID)
		if err := signer.Attach(out); err != nil {
			logger.Warn("sandbox gateway: could not sign the request", "path", r.URL.Path, "error", err)
			writeError(w, http.StatusBadGateway, "SERVICE_AUTH_SIGN_FAILED", "Service authentication failure. Try again.")
			return
		}
		proxy.ServeHTTP(w, out)
	}), nil
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"code":"` + code + `","message":"` + message + `"}`))
}
