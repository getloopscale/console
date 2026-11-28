// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package sandboxgateway

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Mount routes the sandbox paths to gateway. keyOrLogin admits an API key that
// may run sandboxes, or a login; loginOnly admits a login. No other path of
// the sandbox API is reachable through the console.
func Mount(r chi.Router, gateway http.Handler, keyOrLogin, loginOnly func(http.Handler) http.Handler) {
	for _, path := range []string{"/v1/sandboxes", "/v1/sandboxes/*", "/v1/capabilities", "/v1/templates", "/v1/templates/*"} {
		r.With(keyOrLogin).Handle(path, gateway)
	}
	// A secret outlives the sandbox that reads it, so a key that only runs
	// sandboxes does not write one.
	for _, path := range []string{"/v1/secrets", "/v1/secrets/*"} {
		r.With(loginOnly).Handle(path, gateway)
	}
}
