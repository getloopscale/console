// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"net/http"

	"github.com/usetheo/theo/cloud/internal/auth"
)

// MeHandler returns user info for the authenticated user.
type MeHandler struct {
	validator *auth.JWKSValidator
}

// NewMeHandler creates a handler for /v1/auth/me.
func NewMeHandler(validator *auth.JWKSValidator) *MeHandler {
	return &MeHandler{validator: validator}
}

// Get returns the authenticated user's info.
// GET /v1/auth/me
// Requires: Authorization: Bearer <jwt>
func (h *MeHandler) Get(w http.ResponseWriter, r *http.Request) {
	token := extractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED",
			"Not authenticated. Run: theo login")
		return
	}

	claims, err := h.validator.Validate(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "AUTH_FAILED",
			"Session expired or invalid. Run: theo login")
		return
	}

	// Custom claims from consent handler are in "ext" (Hydra convention).
	email := claims.Email
	if email == "" {
		email = claims.Ext.Email
	}
	name := claims.Name
	if name == "" {
		name = claims.Ext.Name
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"email":    email,
		"name":     name,
		"team":     claims.TenantID,
		"role":     claims.Role,
		"plan":     "starter",
		"user_id":  claims.Subject,
	})
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if len(auth) > 7 && auth[:7] == "Bearer " {
		return auth[7:]
	}
	return ""
}
