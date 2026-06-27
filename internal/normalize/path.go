// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package normalize provides HTTP request path normalization middleware.
package normalize

import (
	"net/http"
	"strings"
)

// PathSlashes returns a middleware that detects consecutive slashes in
// the raw request URI path and redirects to the canonical single-slash
// form with HTTP 308 (preserves method + body so POSTs are safe).
//
// Red Team theo-cloud#86 closure (CWE-16 Security Misconfiguration).
// Before this middleware, `GET //engine/api/v1/projects` against the
// edge (Caddy) bypassed the canonical `/engine/*` proxy handle and fell
// through to the SPA catch-all, returning `200 + text/html` (the SPA
// shell). No data was leaked (no API JSON, no protected endpoint
// reached) but the inconsistent edge response confused diagnosis and
// would mask any future routing config drift.
//
// Caddy's `path_regexp` matcher cannot detect `//` prefix because Caddy's
// URL parser collapses repeated slashes BEFORE routing. Go's
// `net/http.Request.RequestURI` preserves the raw request path, so the
// normalization happens here at the BFF instead.
//
// Behavior:
//   - Empty / single-slash paths pass through.
//   - Paths containing `//` get a 308 redirect to the collapsed form
//     (preserves query string).
//   - The 308 status preserves the original method per RFC 7538 so a
//     POST `//foo` retries against `/foo` with the same body.
func PathSlashes(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := r.RequestURI
		if !needsNormalization(raw) {
			next.ServeHTTP(w, r)
			return
		}
		canonical := canonicalize(raw)
		w.Header().Set("Location", canonical)
		// 308 preserves request method per RFC 7538 — important for
		// POST/PUT probes so the body retries against the canonical
		// path (vs 301/302 which downgrade to GET in many clients).
		w.WriteHeader(http.StatusPermanentRedirect)
	})
}

// needsNormalization reports whether the raw request URI contains
// consecutive slashes anywhere in its path component.
func needsNormalization(rawURI string) bool {
	if rawURI == "" {
		return false
	}
	// Isolate the path part (everything before '?' or '#').
	path := rawURI
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	return strings.Contains(path, "//")
}

// canonicalize collapses every run of `/+` in the path to a single
// `/`, preserving any query string / fragment that followed.
func canonicalize(rawURI string) string {
	pathPart := rawURI
	tail := ""
	if i := strings.IndexAny(rawURI, "?#"); i >= 0 {
		pathPart = rawURI[:i]
		tail = rawURI[i:]
	}
	collapsed := collapseSlashes(pathPart)
	return collapsed + tail
}

// collapseSlashes returns s with every run of consecutive `/` replaced
// by a single `/`. Empty input is returned unchanged.
func collapseSlashes(s string) string {
	if s == "" {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	prevSlash := false
	for _, ch := range s {
		if ch == '/' {
			if prevSlash {
				continue
			}
			prevSlash = true
		} else {
			prevSlash = false
		}
		b.WriteRune(ch)
	}
	return b.String()
}
