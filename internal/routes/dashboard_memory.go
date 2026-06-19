// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Plan dashboard-memory-bff-server-side-key-vault v1.2 § T2.1.
//
// DashboardMemoryHandler is the BFF (Backend-For-Frontend) handler family
// for /v1/dashboard/memory/*. JWT-authenticated browser sessions hit these
// endpoints; the handler resolves a server-side theo_live_* API key via
// BFFKeyVault (the key NEVER touches the browser per ADR D1), then delegates
// the actual memory operation to the existing MemoryHandler.
//
// SECURITY INVARIANT (per Plan Goal): the secret returned by MintOrFetch
// is DISCARDED immediately. It is NEVER written to w, NEVER logged, NEVER
// set in a cookie. The mint is for AUDIT/REVOKE bookkeeping only.

package routes

import (
	"log/slog"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

const dashboardMemoryTracer = "github.com/usetheodev/theo-cloud/internal/routes/dashboard_memory"

// DashboardMemoryHandler delegates browser-trust calls through the BFF vault
// to the existing MemoryHandler infrastructure.
type DashboardMemoryHandler struct {
	vault         *auth.BFFKeyVault
	memoryHandler *MemoryHandler
	logger        *slog.Logger

	// Optional ops handlers — when set (via WithOps), the BFF also fronts
	// exports/webhooks so the dashboard reaches them through the session path
	// (closes the 401, gap 4). Nil when the deployment has no DB-backed ops.
	exports    *MemoryExportsHandler
	webhooks   *MemoryWebhooksHandler
	deliveries *MemoryWebhookDeliveriesHandler
}

// NewDashboardMemoryHandler constructs a DashboardMemoryHandler. Both vault
// and memoryHandler MUST be non-nil; logger MUST be non-nil per
// .claude/rules/theo-design.md § Error Philosophy (fail-loud at construction).
func NewDashboardMemoryHandler(v *auth.BFFKeyVault, m *MemoryHandler, logger *slog.Logger) *DashboardMemoryHandler {
	if v == nil || m == nil || logger == nil {
		panic("dashboard_memory: vault, memoryHandler, and logger required")
	}
	return &DashboardMemoryHandler{vault: v, memoryHandler: m, logger: logger}
}

// WithOps wires the exports/webhooks/deliveries handlers so the BFF can front
// them behind the session mint. Any may be nil (feature disabled). Returns the
// receiver for chaining.
func (h *DashboardMemoryHandler) WithOps(exports *MemoryExportsHandler, webhooks *MemoryWebhooksHandler, deliveries *MemoryWebhookDeliveriesHandler) *DashboardMemoryHandler {
	h.exports = exports
	h.webhooks = webhooks
	h.deliveries = deliveries
	return h
}

// mintOrFail wraps the vault MintOrFetch call shared by every BFF method.
// On error, writes the appropriate status + diagnostic + returns false.
// On success, sets the OTel span attribute and returns true.
//
// SECURITY: the returned secret is DISCARDED here (not returned). The mint
// is for audit-trail bookkeeping only — the actual upstream call to TheMemory
// uses the master THEMORY_API_KEY (per GO-TO CTO Invariant 3).
func (h *DashboardMemoryHandler) mintOrFail(w http.ResponseWriter, r *http.Request, spanSuffix string) bool {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return false
	}
	// MintOrFetch returns secret; we discard it immediately (security invariant).
	_, err := h.vault.MintOrFetch(r.Context(), user.Subject, user.TenantID)
	if err != nil {
		// EC-14: error never contains the secret (BFFVaultError.Error()).
		h.logger.Error("BFF mint failed", "error", err, "subject", user.Subject, "endpoint", spanSuffix)
		writeError(w, http.StatusInternalServerError, "VAULT_ERROR", "Internal error.")
		return false
	}
	// Audit trail per Q5 resolution: span name bff.memory.<verb>
	span := otel.Tracer(dashboardMemoryTracer).Start
	_, sp := span(r.Context(), "bff.memory."+spanSuffix)
	sp.SetAttributes(attribute.String("bff.minted", "true"))
	sp.End()
	return true
}

// List proxies /v1/dashboard/memory/list — browser-trust path. After mint,
// delegates to MemoryHandler.List which performs the upstream TheMemory call.
func (h *DashboardMemoryHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "list") {
		return
	}
	h.memoryHandler.List(w, r)
}

// Metrics proxies /v1/dashboard/memory/metrics.
func (h *DashboardMemoryHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "metrics") {
		return
	}
	h.memoryHandler.Metrics(w, r)
}

// Forget proxies /v1/dashboard/memory/forget/{memoryID}.
func (h *DashboardMemoryHandler) Forget(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "forget") {
		return
	}
	h.memoryHandler.Forget(w, r)
}

// Entities proxies /v1/dashboard/memory/entities.
func (h *DashboardMemoryHandler) Entities(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "entities") {
		return
	}
	h.memoryHandler.Entities(w, r)
}

// ListSkills proxies /v1/dashboard/memory/skills (dashboard-phase2b-skills-browse
// T3.3 — read-only Repo-tier skills browse). After mint, delegates to
// MemoryHandler.ListSkills, which namespaces repoId by the authenticated subject
// (D3) before the upstream TheMemory call.
func (h *DashboardMemoryHandler) ListSkills(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "skills") {
		return
	}
	h.memoryHandler.ListSkills(w, r)
}

// Remember proxies POST /v1/dashboard/memory/remember (gap 1 — write verb).
func (h *DashboardMemoryHandler) Remember(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "remember") {
		return
	}
	h.memoryHandler.Remember(w, r)
}

// Recall proxies POST /v1/dashboard/memory/recall (gap 2 — semantic search).
func (h *DashboardMemoryHandler) Recall(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "recall") {
		return
	}
	h.memoryHandler.Recall(w, r)
}

// Reflect proxies POST /v1/dashboard/memory/reflect (gap 3 — consolidation).
func (h *DashboardMemoryHandler) Reflect(w http.ResponseWriter, r *http.Request) {
	if !h.mintOrFail(w, r, "reflect") {
		return
	}
	h.memoryHandler.Reflect(w, r)
}

// --- exports/webhooks BFF fronting (gap 4 — close the 401) -------------------
// Each method mints (audit/revoke bookkeeping) then delegates to the existing
// ops handler. The provider call uses the master key per Invariant 3.

// opDisabled logs + returns 404 when a BFF-fronted ops feature is not wired.
// Logging it (not just writing) surfaces misconfiguration — a dashboard call to
// a disabled feature is an operator signal, not silent.
func (h *DashboardMemoryHandler) opDisabled(w http.ResponseWriter, feature string) {
	h.logger.Warn("BFF ops feature not enabled", "feature", feature)
	writeError(w, http.StatusNotFound, "NOT_FOUND", feature+" are not enabled.")
}

// ExportsCreate proxies POST /v1/dashboard/memory/exports.
func (h *DashboardMemoryHandler) ExportsCreate(w http.ResponseWriter, r *http.Request) {
	if h.exports == nil {
		h.opDisabled(w, "Exports")
		return
	}
	if !h.mintOrFail(w, r, "exports.create") {
		return
	}
	h.exports.Create(w, r)
}

// ExportsStatus proxies GET /v1/dashboard/memory/exports/{id}/status.
func (h *DashboardMemoryHandler) ExportsStatus(w http.ResponseWriter, r *http.Request) {
	if h.exports == nil {
		h.opDisabled(w, "Exports")
		return
	}
	if !h.mintOrFail(w, r, "exports.status") {
		return
	}
	h.exports.Status(w, r)
}

// ExportsDownload proxies GET /v1/dashboard/memory/exports/{id}/download.
func (h *DashboardMemoryHandler) ExportsDownload(w http.ResponseWriter, r *http.Request) {
	if h.exports == nil {
		h.opDisabled(w, "Exports")
		return
	}
	if !h.mintOrFail(w, r, "exports.download") {
		return
	}
	h.exports.Download(w, r)
}

// WebhooksCreate proxies POST /v1/dashboard/memory/webhooks.
func (h *DashboardMemoryHandler) WebhooksCreate(w http.ResponseWriter, r *http.Request) {
	if h.webhooks == nil {
		h.opDisabled(w, "Webhooks")
		return
	}
	if !h.mintOrFail(w, r, "webhooks.create") {
		return
	}
	h.webhooks.Create(w, r)
}

// WebhooksList proxies GET /v1/dashboard/memory/webhooks/list.
func (h *DashboardMemoryHandler) WebhooksList(w http.ResponseWriter, r *http.Request) {
	if h.webhooks == nil {
		h.opDisabled(w, "Webhooks")
		return
	}
	if !h.mintOrFail(w, r, "webhooks.list") {
		return
	}
	h.webhooks.List(w, r)
}

// WebhooksDelete proxies DELETE /v1/dashboard/memory/webhooks/{id}.
func (h *DashboardMemoryHandler) WebhooksDelete(w http.ResponseWriter, r *http.Request) {
	if h.webhooks == nil {
		h.opDisabled(w, "Webhooks")
		return
	}
	if !h.mintOrFail(w, r, "webhooks.delete") {
		return
	}
	h.webhooks.Delete(w, r)
}

// WebhookDeliveriesList proxies GET /v1/dashboard/memory/webhooks/{id}/deliveries.
func (h *DashboardMemoryHandler) WebhookDeliveriesList(w http.ResponseWriter, r *http.Request) {
	if h.deliveries == nil {
		h.opDisabled(w, "Deliveries")
		return
	}
	if !h.mintOrFail(w, r, "webhooks.deliveries") {
		return
	}
	h.deliveries.List(w, r)
}

// WebhookDeliveryReplay proxies POST /v1/dashboard/memory/webhooks/{webhook_id}/deliveries/{delivery_id}/replay.
func (h *DashboardMemoryHandler) WebhookDeliveryReplay(w http.ResponseWriter, r *http.Request) {
	if h.deliveries == nil {
		h.opDisabled(w, "Deliveries")
		return
	}
	if !h.mintOrFail(w, r, "webhooks.replay") {
		return
	}
	h.deliveries.Replay(w, r)
}

// RevokeOnLogout proxies POST /v1/dashboard/memory/revoke-on-logout — clean
// shutdown path called by Dashboard logout flow. Idempotent.
func (h *DashboardMemoryHandler) RevokeOnLogout(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	if err := h.vault.Revoke(r.Context(), user.Subject, user.TenantID); err != nil {
		h.logger.Error("BFF revoke failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusInternalServerError, "VAULT_ERROR", "Internal error.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
