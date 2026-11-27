// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth

import "net/http"

// KeyOrCaller serves a route that accepts either credential of a LoopScale
// customer. A request whose Authorization header carries an API key goes through
// keyed, usually RequireScope; every other request goes through caller, usually
// RequireCaller, which takes a login token or a dashboard session.
//
// The credential picks the gate, and each gate still decides alone: an API key
// that fails its gate is never retried as a session.
func KeyOrCaller(keyed, caller func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		withKey, withCaller := keyed(next), caller(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, isKey := extractLoopScaleLiveBearerFromHeader(r.Header.Get("Authorization")); isKey {
				withKey.ServeHTTP(w, r)
				return
			}
			withCaller.ServeHTTP(w, r)
		})
	}
}
