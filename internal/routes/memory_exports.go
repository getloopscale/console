// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/themory"
)

// Plan 3 of dashboard-memory-section-roadmap.md (T3.3).
// Async memory export jobs — customer requests a JSON dump of their
// memories; a background worker writes the file; customer downloads.
//
// ADRs honored:
//   D1 (Plan 3 / EC-16) — id is server-generated `export-{uuid v4}`;
//        client `filename` body is IGNORED. Path traversal cannot reach
//        the filesystem because the on-disk path is built from the id only.
//   D5 (Plan 0) — cross-tenant attempts surface as 404, never 403.
//   D7 (Plan 0 spirit) — no hard DELETE; status='failed' for terminal failures.

const exportIDPrefix = "export-"

// exportIDPattern matches the server-generated form: "export-" + UUID v4.
// UUIDs are 8-4-4-4-12 hex digits with hyphens. We accept any valid v4
// shape (the uuid library normalises case + hyphenation).
var exportIDPattern = regexp.MustCompile(`^export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// MemoryExportsHandler is the receiver for /v1/memory/exports/* routes.
type MemoryExportsHandler struct {
	db          *sql.DB
	client      TheMemoryClient
	logger      *slog.Logger
	exportDir   string
	workerDelay time.Duration
	// Red Team theo-cloud#104 closure: the test suite needs a way to
	// wait for the detached worker goroutines to finish so `t.TempDir`
	// cleanup + sqlmock teardown don't race the worker writing the
	// JSON file / hitting the DB. `workers` is intentionally a
	// sync.WaitGroup (not a buffered channel) so the production
	// hot-path stays a single Add/Done pair with zero allocations.
	workers sync.WaitGroup
}

// NewMemoryExportsHandler constructs the handler. workerDelay is the
// time the background worker sleeps before writing the file — production
// uses ~3s for a realistic "processing" feel; tests pass 0 to complete
// synchronously without races.
func NewMemoryExportsHandler(db *sql.DB, client TheMemoryClient, logger *slog.Logger, exportDir string, workerDelay time.Duration) *MemoryExportsHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &MemoryExportsHandler{
		db:          db,
		client:      client,
		logger:      logger,
		exportDir:   exportDir,
		workerDelay: workerDelay,
	}
}

// Create inserts a pending export row + spawns the background worker.
// POST /v1/memory/exports
//
// D1 invariant: the request body MAY include a `label` (stored as
// display_name); the body's `filename` field (if any) is read but
// silently discarded. The on-disk + URL filename always derive from
// the server-generated `id`.
func (h *MemoryExportsHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Could not read request body.")
		return
	}
	var req struct {
		Label string `json:"label,omitempty"`
		// Note: `filename` field intentionally NOT in this struct.
		// Even if the client sends one, json.Unmarshal ignores
		// unknown fields by default — defense in depth (D1).
	}
	if len(body) > 0 {
		_ = json.Unmarshal(body, &req) // best-effort; missing body is OK
	}
	var displayName sql.NullString
	if t := strings.TrimSpace(req.Label); t != "" {
		displayName = sql.NullString{String: t, Valid: true}
	}

	id := exportIDPrefix + uuid.NewString()

	const q = `INSERT INTO memory_exports (id, subject, tenant_id, display_name, status)
		VALUES ($1, $2, $3, $4, $5)`
	if _, err := h.db.ExecContext(r.Context(), q,
		id, user.Subject, user.TenantID, displayName, "pending",
	); err != nil {
		h.logger.Warn("exports create: insert failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create export. Try again.")
		return
	}

	// Spawn the worker. Per EC-21 spirit: detach from request ctx so the
	// request's cancellation does not cancel the worker mid-flight. Model B: the
	// tenant is threaded so the worker's data calls resolve the per-tenant key.
	//
	// #104 closure: bookend the goroutine with workers.Add / workers.Done so
	// tests can WaitForWorkers() before tearing down the TempDir + sqlmock.
	h.workers.Add(1)
	go func() {
		defer h.workers.Done()
		h.runWorker(id, user.Subject, user.TenantID)
	}()

	writeJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"status": "pending",
	})
}

// Status returns the export row for the authenticated tenant.
// GET /v1/memory/exports/{id}/status
func (h *MemoryExportsHandler) Status(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	id := chi.URLParam(r, "id")
	if !exportIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Export id must be export-{uuid}.")
		return
	}

	const q = `SELECT id, status, error_message, file_path FROM memory_exports
		WHERE id = $1 AND subject = $2 AND tenant_id = $3`

	var (
		gotID        string
		status       string
		errorMessage sql.NullString
		filePath     sql.NullString
	)
	err := h.db.QueryRowContext(r.Context(), q, id, user.Subject, user.TenantID).
		Scan(&gotID, &status, &errorMessage, &filePath)
	if errors.Is(err, sql.ErrNoRows) {
		// D5: cross-tenant or non-existent collapse to 404.
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Export not found.")
		return
	}
	if err != nil {
		h.logger.Warn("exports status: query failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load export status. Try again.")
		return
	}

	out := map[string]any{
		"id":     gotID,
		"status": status,
	}
	if errorMessage.Valid {
		out["error_message"] = errorMessage.String
	}
	if filePath.Valid && status == "succeeded" {
		if info, err := os.Stat(filePath.String); err == nil {
			out["file_size"] = info.Size()
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// Download streams the exported JSON file with attachment headers.
// GET /v1/memory/exports/{id}/download
func (h *MemoryExportsHandler) Download(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	id := chi.URLParam(r, "id")
	if !exportIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "Export id must be export-{uuid}.")
		return
	}

	const q = `SELECT status, file_path FROM memory_exports
		WHERE id = $1 AND subject = $2 AND tenant_id = $3`
	var (
		status   string
		filePath sql.NullString
	)
	err := h.db.QueryRowContext(r.Context(), q, id, user.Subject, user.TenantID).
		Scan(&status, &filePath)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Export not found.")
		return
	}
	if err != nil {
		h.logger.Warn("exports download: query failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not start download. Try again.")
		return
	}
	if status != "succeeded" || !filePath.Valid {
		writeError(w, http.StatusNotFound, "NOT_READY", "Export is not yet available.")
		return
	}

	f, err := os.Open(filePath.String)
	if err != nil {
		h.logger.Warn("exports download: open file failed", "error", err, "path", filePath.String)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not open export file. Try again.")
		return
	}
	defer func() { _ = f.Close() }()

	w.Header().Set("Content-Type", "application/json")
	// D1: the attachment filename uses the server-generated id, NOT any
	// client-supplied label. Path traversal here is impossible because
	// `id` matched exportIDPattern above.
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, id))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}

// WaitForWorkers blocks until every in-flight export worker has returned.
// Test-helper only; production never calls it. Closes the Red Team
// theo-cloud#104 race where `t.TempDir` cleanup and the test's sqlmock
// teardown ran while a worker goroutine was still writing the file /
// running its final UPDATE.
func (h *MemoryExportsHandler) WaitForWorkers() {
	h.workers.Wait()
}

// exportPageSize is the per-request page size when listing memories for an
// export. TheMemory caps the scope-list `limit` at 100 (zod `.max(100)`, same
// as recall `topK`); requesting more 422s and fails the whole export
// (usetheodev/theo-workspace#6). The worker pages through the full set in
// chunks of this size, following the provider's opaque cursor.
const exportPageSize = 100

// runWorker materialises the export on disk: page through ALL the subject's
// memories within the provider's page-size cap, write a JSON file, update the
// row. Stale-job reaper remains Out of Scope (plan Risks table).
func (h *MemoryExportsHandler) runWorker(id, subject, tenantID string) {
	if h.workerDelay > 0 {
		time.Sleep(h.workerDelay)
	}
	bg, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	// Model B: inject the authenticated tenant into the detached worker context so
	// the data client's per-tenant key resolver (broker) resolves the right key.
	bg = auth.WithUser(bg, &auth.UserContext{Subject: subject, TenantID: tenantID})

	// Move to 'running' so the dashboard can show progress.
	_, _ = h.db.ExecContext(bg, `UPDATE memory_exports SET status = 'running' WHERE id = $1`, id)

	// Page through the full set in <=exportPageSize chunks, following the
	// provider's opaque cursor. A single oversized request (Limit:200) 422s and
	// fails every export (#6); a naive clamp to one page would silently truncate
	// to the first 100 — data loss. Both are avoided by exhausting the cursor.
	memories := make([]themory.MemoryRow, 0)
	cursor := ""
	for {
		page, err := h.client.List(bg, subject, themory.ListOptions{Limit: exportPageSize, Cursor: cursor})
		if err != nil {
			h.failExport(bg, id, fmt.Sprintf("memory list failed: %v", err))
			return
		}
		memories = append(memories, page.Memories...)
		if page.NextCursor == nil || *page.NextCursor == "" {
			break
		}
		cursor = *page.NextCursor
	}

	if err := os.MkdirAll(h.exportDir, 0o750); err != nil {
		h.failExport(bg, id, fmt.Sprintf("mkdir failed: %v", err))
		return
	}
	// D1: filename derives from the validated id ONLY — no client input,
	// no traversal possible.
	path := filepath.Join(h.exportDir, id+".json")
	// G302 CORRIGIDO (nao suprimido): 0o640 -> 0o600. O arquivo e escrito e lido pelo mesmo
	// processo; a permissao de grupo nao servia a ninguem e ampliava o alcance de um export
	// que pode conter memoria de tenant. Corrigir remove a vulnerabilidade; suprimir apenas
	// removeria o alarme.
	//
	// G304 SUPRIMIDO com a razao, porque o achado nao se aplica: `id` NAO vem do cliente —
	// e `exportIDPrefix + uuid.NewString()`, gerado no servidor (linha ~113), e a rota de
	// leitura ainda valida a forma `export-{uuid}` antes de tocar no disco. Nao ha input do
	// chamador neste caminho, entao nao ha traversal a construir.
	// #nosec G304 -- path derives from a server-generated uuid, never from client input (D1 / EC-16)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		h.failExport(bg, id, fmt.Sprintf("open failed: %v", err))
		return
	}
	defer func() { _ = f.Close() }()

	// Preserve the on-disk shape ({"memories":[...]}) the single-page worker
	// wrote (it encoded the *ListResult). NextCursor is nil here (set exhausted).
	if err := json.NewEncoder(f).Encode(&themory.ListResult{Memories: memories}); err != nil {
		h.failExport(bg, id, fmt.Sprintf("encode failed: %v", err))
		return
	}

	if _, err := h.db.ExecContext(bg,
		`UPDATE memory_exports SET status = 'succeeded', file_path = $1, completed_at = NOW() WHERE id = $2`,
		path, id,
	); err != nil {
		h.logger.Warn("exports worker: mark succeeded failed", "error", err, "id", id)
	}
}

func (h *MemoryExportsHandler) failExport(ctx context.Context, id, message string) {
	h.logger.Warn("exports worker: failed", "id", id, "message", message)
	_, _ = h.db.ExecContext(ctx,
		`UPDATE memory_exports SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
		message, id,
	)
}
