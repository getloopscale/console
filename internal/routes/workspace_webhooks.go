// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/getloopscale/loop-console/internal/auth"
)

// J-16 Settings — customer-facing workspace/deploy webhook registrations. A
// mirror of MemoryWebhooksHandler (memory_webhooks.go) for a new resource: these
// fire on DEPLOY events (deploy.succeeded / deploy.failed / …). Persists to the
// workspace_webhooks table (engine migration 000050).
//
// Registration-only v0.1 per the same ADR D2 precedent memory_webhooks shipped at
// — DELIVERY is a separate T2-gated slice; the dashboard discloses this with a
// persistent "Delivery coming soon" Alert. Reuses the shared package helpers
// (randomHex16, webhookURLPattern, webhookLabelMax, writeError/writeJSON) to avoid
// duplicating the memory-webhooks logic (DRY).

const workspaceWebhookIDPrefix = "wwh-"

var workspaceWebhookIDPattern = regexp.MustCompile(`^wwh-[0-9a-f]{16}$`)

// WorkspaceWebhooksHandler is the receiver for /v1/webhooks/* routes.
type WorkspaceWebhooksHandler struct {
	db     *sql.DB
	logger *slog.Logger
}

// NewWorkspaceWebhooksHandler creates the handler. logger may be nil.
// capWorkspaceWebhooks é o teto defensivo desta lista (B-114). O `LIMIT` da query é `capWorkspaceWebhooks + 1`,
// para que o handler saiba distinguir "exatamente 100" de "mais de 100".
const capWorkspaceWebhooks = 100

func NewWorkspaceWebhooksHandler(db *sql.DB, logger *slog.Logger) *WorkspaceWebhooksHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &WorkspaceWebhooksHandler{db: db, logger: logger}
}

// WorkspaceWebhookView is the wire shape for List + Create response.
type WorkspaceWebhookView struct {
	ID        string   `json:"id"`
	URL       string   `json:"url"`
	Label     string   `json:"label"`
	Events    []string `json:"events"`
	CreatedAt string   `json:"created_at"`
}

// Create persists a new webhook registration.
// POST /v1/webhooks
func (h *WorkspaceWebhooksHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Could not read request body.")
		return
	}

	var req struct {
		URL    string   `json:"url"`
		Label  string   `json:"label"`
		Events []string `json:"events"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body.")
		return
	}

	if !webhookURLPattern.MatchString(req.URL) {
		writeError(w, http.StatusBadRequest, "INVALID_URL", "Webhook URL must start with http:// or https://.")
		return
	}
	trimmed := strings.TrimSpace(req.Label)
	if trimmed == "" {
		writeError(w, http.StatusBadRequest, "EMPTY_LABEL", "Webhook label is required.")
		return
	}
	if len(req.Label) > webhookLabelMax {
		writeError(w, http.StatusBadRequest, "LABEL_TOO_LONG",
			fmt.Sprintf("Webhook label must be %d characters or fewer.", webhookLabelMax))
		return
	}
	if len(req.Events) == 0 {
		writeError(w, http.StatusBadRequest, "EMPTY_EVENTS", "At least one event is required.")
		return
	}

	id := workspaceWebhookIDPrefix + randomHex16()
	eventsJSON, err := json.Marshal(req.Events)
	if err != nil {
		h.logger.Error("workspace webhooks create: events marshal failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create webhook. Try again.")
		return
	}

	// Per-webhook HMAC-SHA256 signing secret (whsec_<43 base64url> = 48 chars).
	// Persisted RAW — the future dispatcher signs at delivery time. Returned to
	// the customer ONCE in this response (Stripe show-once pattern).
	rawSecret := make([]byte, 32)
	if _, err := rand.Read(rawSecret); err != nil {
		h.logger.Error("workspace webhooks create: crypto/rand failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create webhook. Try again.")
		return
	}
	secret := "whsec_" + base64.RawURLEncoding.EncodeToString(rawSecret)

	const q = `INSERT INTO workspace_webhooks (id, subject, tenant_id, url, label, events, secret)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`
	if _, err := h.db.ExecContext(r.Context(), q,
		id, user.Subject, user.TenantID, req.URL, trimmed, eventsJSON, secret,
	); err != nil {
		h.logger.Warn("workspace webhooks create: insert failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create webhook. Try again.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"url":    req.URL,
		"label":  trimmed,
		"events": req.Events,
		"secret": secret, // RAW — shown ONCE; customer stores to verify HMAC signatures
	})
}

// List returns the authenticated user's active webhooks, capped at 100.
// GET /v1/webhooks/list
func (h *WorkspaceWebhooksHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	const q = `SELECT id, url, label, events, created_at
		FROM workspace_webhooks
		WHERE subject = $1 AND tenant_id = $2 AND revoked_at IS NULL
		ORDER BY created_at DESC
		LIMIT 101`

	rows, err := h.db.QueryContext(r.Context(), q, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("workspace webhooks list: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list webhooks. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()

	out := make([]WorkspaceWebhookView, 0, 16)
	for rows.Next() {
		var (
			v         WorkspaceWebhookView
			eventsRaw []byte
		)
		if err := rows.Scan(&v.ID, &v.URL, &v.Label, &eventsRaw, &v.CreatedAt); err != nil {
			h.logger.Warn("workspace webhooks list: scan failed", "error", err)
			continue
		}
		if err := json.Unmarshal(eventsRaw, &v.Events); err != nil {
			h.logger.Warn("workspace webhooks list: events unmarshal failed", "error", err, "id", v.ID)
			v.Events = []string{}
		}
		out = append(out, v)
	}
	out, temMais := truncar(out, capWorkspaceWebhooks)
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": out, "has_more": temMais})
}

// Delete soft-deletes the webhook. Cross-tenant / non-existent / already-revoked
// all collapse to 404 (never 403) — existence-leak prevention.
// DELETE /v1/webhooks/{id}
func (h *WorkspaceWebhooksHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	id := chi.URLParam(r, "id")
	if !workspaceWebhookIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Webhook id must match wwh-{16hex}.")
		return
	}

	const q = `UPDATE workspace_webhooks
		SET revoked_at = NOW()
		WHERE id = $1 AND subject = $2 AND tenant_id = $3 AND revoked_at IS NULL`

	res, err := h.db.ExecContext(r.Context(), q, id, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("workspace webhooks delete: update failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not delete webhook. Try again.")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Webhook not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Deliveries returns the most-recent deliveries for one webhook, scoped to the
// authenticated owner (subject + tenant) so a caller cannot read another
// tenant's delivery history. Mirrors MemoryWebhookDeliveriesHandler.List; reuses
// the shared DeliveryView + deliveryHistoryLimit.
// GET /v1/settings/webhooks/{id}/deliveries
func (h *WorkspaceWebhooksHandler) Deliveries(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	webhookID := chi.URLParam(r, "id")
	if !workspaceWebhookIDPattern.MatchString(webhookID) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Webhook id must match wwh-{16hex}.")
		return
	}

	const q = `
		SELECT d.id, d.event_type, d.status, d.attempt_count,
		       d.last_response_status, d.last_error_message,
		       d.created_at, d.completed_at
		FROM workspace_webhook_deliveries d
		JOIN workspace_webhooks w ON w.id = d.webhook_id
		WHERE d.webhook_id = $1 AND w.subject = $2 AND w.tenant_id = $3
		ORDER BY d.created_at DESC
		LIMIT $4`
	rows, err := h.db.QueryContext(r.Context(), q, webhookID, user.Subject, user.TenantID, deliveryHistoryLimit)
	if err != nil {
		h.logger.Warn("workspace webhook deliveries list: query failed", "error", err, "webhook_id", webhookID)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load deliveries. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()

	out := make([]DeliveryView, 0, deliveryHistoryLimit)
	for rows.Next() {
		var (
			v          DeliveryView
			lastStatus sql.NullInt64
			lastErr    sql.NullString
			completed  sql.NullString
		)
		if err := rows.Scan(&v.ID, &v.EventType, &v.Status, &v.AttemptCount,
			&lastStatus, &lastErr, &v.CreatedAt, &completed); err != nil {
			h.logger.Warn("workspace webhook deliveries list: scan failed", "error", err)
			continue
		}
		if lastStatus.Valid {
			s := int(lastStatus.Int64)
			v.LastResponseStatus = &s
		}
		if lastErr.Valid {
			msg := lastErr.String
			if len(msg) > 200 {
				msg = msg[:200] + "…"
			}
			msg = strings.Map(func(r rune) rune {
				if r < 32 && r != '\n' && r != '\t' {
					return ' '
				}
				return r
			}, msg)
			v.LastErrorMessage = &msg
		}
		if completed.Valid {
			v.CompletedAt = &completed.String
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"deliveries": out})
}
