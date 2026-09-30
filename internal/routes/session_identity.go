// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// sessionIdentifier is the slice of *auth.KratosSessionAuthenticator this handler needs.
type sessionIdentifier interface {
	Identify(r *http.Request) (*auth.SessionIdentity, error)
}

// SessionIdentityHandler serves GET /v1/auth/session: who the browser's Kratos
// session belongs to, and nothing that authenticates anybody.
//
// usetheoai/theo#477 step 3 — the dashboard used to learn its identity from the
// response of POST /v1/auth/session/token, which also handed it an HS256 bearer
// token. The identity half moved here; the token half the dashboard no longer
// receives at all. The status is the contract the dashboard acts on: 401 means
// the session ended, anything else is transient and must not sign anyone out.
type SessionIdentityHandler struct {
	sessions sessionIdentifier
}

// NewSessionIdentityHandler wires the handler.
func NewSessionIdentityHandler(sessions sessionIdentifier) *SessionIdentityHandler {
	return &SessionIdentityHandler{sessions: sessions}
}

// Get writes {"identity": {...}} for an active session.
func (h *SessionIdentityHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := h.sessions.Identify(r)
	switch {
	case err == nil:
		// The identity is personal data; no shared cache may keep it.
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"identity": id})
	case errors.Is(err, auth.ErrNoSession):
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Please sign in.")
	default:
		slog.Warn("session identity: identity provider unavailable", "error", err)
		writeError(w, http.StatusBadGateway, "AUTH_SERVICE_UNAVAILABLE", "Authentication service unavailable. Try again.")
	}
}
