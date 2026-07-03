// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// starterProvisioner is the minimal surface MeHandler needs to lazily create a
// free-tier subscription row the first time it is missing — satisfied by
// *billing.Provisioner. Kept as a local interface (DIP) so this package does not
// take a hard dependency on the billing handler wiring and stays test-stubbable.
type starterProvisioner interface {
	ProvisionStarter(ctx context.Context, userID, email, tenantID string) error
}

// MeHandler returns user info for the authenticated user.
type MeHandler struct {
	// db is the BFF's Postgres handle used to read the tenant provisioning
	// snapshot (subscriptions). May be nil when the deployment runs without a
	// database — in that case the provisioning fields are simply omitted.
	db *sql.DB
	// provisioner lazily creates the free starter subscription the first time it
	// is missing (mirrors the /billing lazy-ensure). May be nil (billing off).
	provisioner starterProvisioner
}

// NewMeHandler creates a handler for /v1/auth/me. Pass a nil db to omit the
// provisioning snapshot (identity-only mode); a nil provisioner disables the
// lazy starter-plan creation (a missing subscription then reports "pending").
func NewMeHandler(db *sql.DB, provisioner starterProvisioner) *MeHandler {
	return &MeHandler{db: db, provisioner: provisioner}
}

// meProvisioningQuery reads the latest subscription for the user's account. Its
// presence is the "after-registration bootstrap ran" signal (M0 J-02 T1.2).
const meProvisioningQuery = "SELECT plan, status FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) ORDER BY created_at DESC LIMIT 1"

// Get returns the authenticated user's info plus a tenant provisioning snapshot.
// GET /v1/auth/me — requires auth.RequireJWT middleware.
func (h *MeHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	resp := map[string]interface{}{
		"email":   user.Email,
		"name":    user.Name,
		"team":    user.TenantID,
		"user_id": user.Subject,
	}

	// M0 J-02 T1.2 — attach the provisioning snapshot the register "completing"
	// screen polls until the new tenant is ready. The subscriptions row written
	// by the after-registration bootstrap (billing.Provisioner.ProvisionStarter)
	// is the readiness signal: present ⇒ active, absent ⇒ still pending. A
	// billing-lookup failure MUST NOT break the identity endpoint (fail-clear,
	// degrade to "unknown" — never a 500 on /me).
	if h.db != nil {
		var plan, status string
		err := h.db.QueryRowContext(r.Context(), meProvisioningQuery, user.TenantID).Scan(&plan, &status)
		switch {
		case err == nil:
			resp["provisioning"] = "active"
			resp["plan"] = plan
			resp["subscription_status"] = status
		case errors.Is(err, sql.ErrNoRows):
			// No subscription row yet. Lazily create the free starter plan the
			// first time (idempotent ON CONFLICT DO NOTHING) — the same lazy
			// ensure /billing performs. On success the tenant IS provisioned on
			// starter/active; on failure, stay pending so the next poll retries.
			if h.provisioner != nil {
				if perr := h.provisioner.ProvisionStarter(r.Context(), user.Subject, user.Email, user.TenantID); perr == nil {
					resp["provisioning"] = "active"
					resp["plan"] = "starter"
					resp["subscription_status"] = "active"
				} else {
					slog.Warn("me: lazy starter provisioning failed", "tenant_id", user.TenantID, "error", perr)
					resp["provisioning"] = "pending"
				}
			} else {
				resp["provisioning"] = "pending"
			}
		default:
			slog.Error("me: tenant provisioning lookup failed", "tenant_id", user.TenantID, "error", err)
			resp["provisioning"] = "unknown"
		}
	}

	writeJSON(w, http.StatusOK, resp)
}
