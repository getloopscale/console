package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/rag"
)

// RagDataClient is the theo-rag proxy the dashboard BFF depends on (DIP — a stub
// satisfies it in tests). Satisfied by *rag.DataClient. M21 adds the write surface
// (create/delete collections + documents, ask) alongside the M17 reads.
type RagDataClient interface {
	ListCollections(ctx context.Context, limit, offset int) (*rag.CollectionsResult, error)
	ListDocuments(ctx context.Context, collectionID string, limit, offset int) (*rag.DocumentsResult, error)
	Analytics(ctx context.Context, collectionID, since string) (*rag.AnalyticsResult, error)
	CreateCollection(ctx context.Context, in rag.CreateCollectionInput) (*rag.Collection, error)
	DeleteCollection(ctx context.Context, id string) error
	IngestDocument(ctx context.Context, in rag.IngestInput) (json.RawMessage, error)
	// M11 — file upload (PDF/office/CSV/image). Streamed multipart to theo-rag's async ingest.
	UploadDocumentFile(ctx context.Context, in rag.UploadFileInput) (json.RawMessage, error)
	DeleteDocument(ctx context.Context, id string) error
	Ask(ctx context.Context, in rag.AskInput) (json.RawMessage, error)
	// #191 — connectors surface (list + sync + delete).
	ListConnectors(ctx context.Context) (*rag.ConnectionsResult, error)
	SyncConnector(ctx context.Context, id string) (json.RawMessage, error)
	DeleteConnector(ctx context.Context, id string) error
	// M8 — connect a data source (POST /connectors/{provider}/connect). Credential body
	// forwarded opaquely (never inspected/logged).
	ConnectConnector(ctx context.Context, provider string, body json.RawMessage) (json.RawMessage, error)
	// M10 — GraphRAG explorer reads: the persisted knowledge graph (nodes/edges) + communities
	// (with report summary + members). Forwarded opaquely; rag:read gated at theo-rag.
	GraphView(ctx context.Context, collectionID, level, limit string) (json.RawMessage, error)
	Communities(ctx context.Context, collectionID, level string) (json.RawMessage, error)
	// M13 — the full report (title + full_content + findings) for a community. Forwarded opaquely.
	CommunityReport(ctx context.Context, collectionID, communityKey, level string) (json.RawMessage, error)
	// chunk-editor — list a document's chunks (read), read one chunk, and edit a chunk's text
	// (theo-rag re-embeds server-side on write). Forwarded opaquely; rag:read / rag:write gated at theo-rag.
	ListDocumentChunks(ctx context.Context, documentID, cursor string) (json.RawMessage, error)
	GetChunk(ctx context.Context, id string) (json.RawMessage, error)
	UpdateChunk(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error)
	// Open Wiki — list wiki pages in a collection, read one page markdown, create a page.
	ListWikiPages(ctx context.Context, collectionID string) (json.RawMessage, error)
	GetWikiPage(ctx context.Context, id string) (json.RawMessage, error)
	CreateWikiPage(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	UpdateWikiPage(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error)
	DeleteWikiPage(ctx context.Context, id string) error
	WikiIndex(ctx context.Context, collectionID string) (json.RawMessage, error)
	WikiLog(ctx context.Context, collectionID string) (json.RawMessage, error)
}

// RagDashboardHandler serves the /v1/dashboard/rag BFF. Browser JWT sessions (requireJWT)
// reach it; the injected data client proxies to theo-rag with a per-tenant key resolved
// from the JWT tenant. M21 lifts the M17 read-only surface to read+write — the dashboard
// session mints a rag:read+write+delete key; theo-rag's per-verb scope still gates every
// write (the 6 data-plane invariants hold at the service).
type RagDashboardHandler struct {
	client RagDataClient
	logger *slog.Logger
}

// NewRagDashboardHandler builds the handler over the injected per-tenant data client (M21: read+write).
func NewRagDashboardHandler(client RagDataClient, logger *slog.Logger) *RagDashboardHandler {
	return &RagDashboardHandler{client: client, logger: logger}
}

// ListCollections serves GET /v1/dashboard/rag/collections — the caller workspace's
// collections, via the per-tenant key resolved from the JWT session (fail-closed 401
// when no tenant). Query params tenant/workspace are IGNORED (the tenant comes from JWT).
func (h *RagDashboardHandler) ListCollections(w http.ResponseWriter, r *http.Request) {
	if user := auth.GetUser(r.Context()); user == nil || user.TenantID == "" {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	q := r.URL.Query()
	limit, offset := 0, 0
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	res, err := h.client.ListCollections(r.Context(), limit, offset)
	if err != nil {
		h.logger.Warn("rag dashboard: list collections failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list collections.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// Analytics serves GET /v1/dashboard/rag/analytics — the caller workspace's M5 summary,
// via the per-tenant key (theo-rag gates /v1/analytics by rag:read since M17).
//
// ROADMAP-v8 M7 — when ?collection_id= is present the response carries an extra
// `scale` block (extraction tokens, communities, corpus size) for the selected
// collection. Absent collection_id keeps the M5 shape (scale nil, backward-compat).
// tenant/workspace query params are IGNORED (the tenant comes from the JWT).
func (h *RagDashboardHandler) Analytics(w http.ResponseWriter, r *http.Request) {
	if user := auth.GetUser(r.Context()); user == nil || user.TenantID == "" {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
		return
	}
	q := r.URL.Query()
	res, err := h.client.Analytics(r.Context(), q.Get("collection_id"), q.Get("since"))
	if err != nil {
		h.logger.Warn("rag dashboard: analytics failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load analytics.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// GraphView serves GET /v1/dashboard/rag/collections/{id}/graph — the persisted knowledge graph
// (nodes + edges) for the GraphRAG explorer (M10), via the per-tenant rag:read key. Forwarded
// opaquely (the dashboard renders it); the tenant comes from the JWT, never the request.
func (h *RagDashboardHandler) GraphView(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	q := r.URL.Query()
	res, err := h.client.GraphView(r.Context(), chi.URLParam(r, "id"), q.Get("level"), q.Get("limit"))
	if err != nil {
		h.logger.Warn("rag dashboard: graph failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the graph.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// Communities serves GET /v1/dashboard/rag/collections/{id}/communities — the graph communities
// (with report summary + members) for the GraphRAG explorer (M10), via the per-tenant rag:read key.
func (h *RagDashboardHandler) Communities(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	res, err := h.client.Communities(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("level"))
	if err != nil {
		h.logger.Warn("rag dashboard: communities failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load communities.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// CommunityReport serves GET /v1/dashboard/rag/collections/{id}/communities/{key}/report — the
// full community report (title + full_content + findings) for the explorer drill-down (M13), via
// the per-tenant rag:read key. An upstream 404 (no report generated) maps to a 404 here.
func (h *RagDashboardHandler) CommunityReport(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	res, err := h.client.CommunityReport(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "key"), r.URL.Query().Get("level"))
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			writeError(w, http.StatusNotFound, "REPORT_NOT_FOUND", "No report has been generated for this community yet.")
			return
		}
		h.logger.Warn("rag dashboard: community report failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the community report.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ListDocumentChunks serves GET /v1/dashboard/rag/documents/{id}/chunks (chunk-editor, rag:read).
func (h *RagDashboardHandler) ListDocumentChunks(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A document id is required.")
		return
	}
	res, err := h.client.ListDocumentChunks(r.Context(), id, r.URL.Query().Get("cursor"))
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			writeError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "That document does not exist.")
			return
		}
		h.logger.Warn("rag dashboard: list chunks failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the chunks.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// GetChunk serves GET /v1/dashboard/rag/chunks/{id} (chunk-editor, rag:read).
func (h *RagDashboardHandler) GetChunk(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A chunk id is required.")
		return
	}
	res, err := h.client.GetChunk(r.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			writeError(w, http.StatusNotFound, "CHUNK_NOT_FOUND", "That chunk does not exist.")
			return
		}
		h.logger.Warn("rag dashboard: get chunk failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the chunk.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// UpdateChunk serves PATCH /v1/dashboard/rag/chunks/{id} (chunk-editor, rag:write). Edits a
// chunk's text; theo-rag re-embeds it server-side. The body ({text}) is forwarded opaquely.
func (h *RagDashboardHandler) UpdateChunk(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A chunk id is required.")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Could not read the request body.")
		return
	}
	res, err := h.client.UpdateChunk(r.Context(), id, json.RawMessage(body))
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "404"):
			writeError(w, http.StatusNotFound, "CHUNK_NOT_FOUND", "That chunk does not exist.")
		case strings.Contains(err.Error(), "400"):
			writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "The chunk text must not be empty.")
		default:
			h.logger.Warn("rag dashboard: update chunk failed", "error", err)
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not save the chunk.")
		}
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ListDocuments serves GET /v1/dashboard/rag/documents?collection_id — the caller
// workspace's documents + ingest status, via the per-tenant key.
func (h *RagDashboardHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	q := r.URL.Query()
	limit, offset := 0, 0
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	res, err := h.client.ListDocuments(r.Context(), q.Get("collection_id"), limit, offset)
	if err != nil {
		h.logger.Warn("rag dashboard: list documents failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list documents.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// authTenant enforces the JWT session (fail-closed 401 when no tenant). Returns false
// (and writes the 401) when the caller is not an authenticated tenant.
func (h *RagDashboardHandler) authTenant(w http.ResponseWriter, r *http.Request) bool {
	if user := auth.GetUser(r.Context()); user != nil && user.TenantID != "" {
		return true
	}
	writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated.")
	return false
}

// CreateCollection serves POST /v1/dashboard/rag/collections (M21). The per-tenant
// rag:write key gates the write at theo-rag; the tenant comes from the JWT, never the body.
func (h *RagDashboardHandler) CreateCollection(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	var in rag.CreateCollectionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Name == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A non-empty collection name is required.")
		return
	}
	out, err := h.client.CreateCollection(r.Context(), in)
	if err != nil {
		h.logger.Warn("rag dashboard: create collection failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not create the collection.")
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// DeleteCollection serves DELETE /v1/dashboard/rag/collections/{id} (M21, rag:delete).
func (h *RagDashboardHandler) DeleteCollection(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A collection id is required.")
		return
	}
	if err := h.client.DeleteCollection(r.Context(), id); err != nil {
		h.logger.Warn("rag dashboard: delete collection failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the collection.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListConnectors serves GET /v1/dashboard/rag/connectors (#191) — the workspace's
// connector connections (non-secret view), via the per-tenant key (rag:read).
func (h *RagDashboardHandler) ListConnectors(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	res, err := h.client.ListConnectors(r.Context())
	if err != nil {
		h.logger.Warn("rag dashboard: list connectors failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not list connectors.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// connectorProviders is theo-rag's provider enum (M8). The BFF validates the {provider} path
// param against it (fail-fast 422) before proxying, so an unknown provider never reaches
// theo-rag. Kept in lockstep with theo-rag's CONNECTOR_PROVIDERS (+ the Atlassian pair).
var connectorProviders = map[string]bool{
	"google-drive": true, "dropbox": true, "gmail": true, "box": true, "zendesk": true,
	"salesforce": true, "microsoft-365": true, "notion": true, "github": true, "s3": true,
	"web": true, "slack": true, "confluence": true, "jira": true,
}

// ConnectConnector serves POST /v1/dashboard/rag/connectors/{provider}/connect (M8, rag:write).
// The provider is validated against the enum; the credential body is forwarded OPAQUELY to
// theo-rag (never inspected, transformed, or logged — Rule 8) which encrypts it and returns a
// non-secret Connection. The body is bounded (64 KiB) to reject an oversized payload.
func (h *RagDashboardHandler) ConnectConnector(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	provider := chi.URLParam(r, "provider")
	if !connectorProviders[provider] {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Unknown connector provider.")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Could not read the request body.")
		return
	}
	// Log the provider only — NEVER the body (it carries the credential).
	out, err := h.client.ConnectConnector(r.Context(), provider, json.RawMessage(body))
	if err != nil {
		h.logger.Warn("rag dashboard: connect connector failed", "provider", provider, "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not connect the data source.")
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// SyncConnector serves POST /v1/dashboard/rag/connectors/{id}/sync (#191, rag:write) —
// enqueues a sync; passes through theo-rag's 202 body.
func (h *RagDashboardHandler) SyncConnector(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A connector id is required.")
		return
	}
	out, err := h.client.SyncConnector(r.Context(), id)
	if err != nil {
		h.logger.Warn("rag dashboard: sync connector failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not start the sync.")
		return
	}
	writeJSON(w, http.StatusAccepted, out)
}

// DeleteConnector serves DELETE /v1/dashboard/rag/connectors/{id} (#191, rag:delete).
func (h *RagDashboardHandler) DeleteConnector(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A connector id is required.")
		return
	}
	if err := h.client.DeleteConnector(r.Context(), id); err != nil {
		h.logger.Warn("rag dashboard: delete connector failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the connector.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// IngestDocument serves POST /v1/dashboard/rag/documents (M21, rag:write). Text ingest
// is async at theo-rag (202); the raw upstream body (with the doc id + status) passes through.
func (h *RagDashboardHandler) IngestDocument(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	var in rag.IngestInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.CollectionID == "" || in.Text == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "collection_id and text are required.")
		return
	}
	out, err := h.client.IngestDocument(r.Context(), in)
	if err != nil {
		h.logger.Warn("rag dashboard: ingest document failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not ingest the document.")
		return
	}
	writeJSON(w, http.StatusAccepted, json.RawMessage(out))
}

// maxUploadBytes caps a single dashboard file upload at the BFF edge (DoS guard).
// theo-rag enforces its own content limit (413); this is the outer bound so a runaway
// upload cannot exhaust the BFF before the upstream rejects it.
const maxUploadBytes = 100 << 20 // 100 MiB

// UploadDocumentFile serves POST /v1/dashboard/rag/documents/file (M11, rag:write). A
// multipart file upload (PDF/office/CSV/image) is streamed to theo-rag's async ingest;
// the raw upstream body (doc id + status) passes through (202). The file spills to a
// temp file (FormFile) and is streamed out — never buffered whole in the BFF.
func (h *RagDashboardHandler) UploadDocumentFile(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A file upload is required.")
		return
	}
	defer func() { _ = file.Close() }()
	collectionID := r.FormValue("collection_id")
	if collectionID == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "collection_id is required.")
		return
	}
	out, err := h.client.UploadDocumentFile(r.Context(), rag.UploadFileInput{
		File:         file,
		Filename:     hdr.Filename,
		ContentType:  hdr.Header.Get("Content-Type"),
		CollectionID: collectionID,
		Name:         r.FormValue("name"),
		Mode:         r.FormValue("mode"),
	})
	if err != nil {
		h.logger.Warn("rag dashboard: upload document failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not upload the document.")
		return
	}
	writeJSON(w, http.StatusAccepted, json.RawMessage(out))
}

// DeleteDocument serves DELETE /v1/dashboard/rag/documents/{id} (M21, rag:delete).
func (h *RagDashboardHandler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A document id is required.")
		return
	}
	if err := h.client.DeleteDocument(r.Context(), id); err != nil {
		h.logger.Warn("rag dashboard: delete document failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the document.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Ask serves POST /v1/dashboard/rag/answers (M21, rag:read). A query returns a cited answer;
// the raw upstream answer body (answer + sources) passes through.

// validAskStrategy reports whether s is one of theo-rag's retrieval strategies (M9 —
// vector|keyword|hybrid|graph|global). Kept in lockstep with theo-rag's enum.
func validAskStrategy(s string) bool {
	switch s {
	case "vector", "keyword", "hybrid", "graph", "global":
		return true
	default:
		return false
	}
}

func (h *RagDashboardHandler) Ask(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	var in rag.AskInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.CollectionID == "" || in.Question == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "collection_id and question are required.")
		return
	}
	// M9 — fail-fast on an unknown strategy at the boundary (error-handling.md): reject it
	// here with a clear typed 422 rather than forwarding a bad value upstream. An empty
	// strategy is valid (theo-rag defaults to vector).
	if in.Strategy != "" && !validAskStrategy(in.Strategy) {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "strategy must be one of vector, keyword, hybrid, graph, global.")
		return
	}
	out, err := h.client.Ask(r.Context(), in)
	if err != nil {
		h.logger.Warn("rag dashboard: ask failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not answer the question.")
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(out))
}


// ListWikiPages serves GET /v1/dashboard/rag/wiki/pages?collection_id= (Open Wiki, rag:read).
func (h *RagDashboardHandler) ListWikiPages(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	cid := r.URL.Query().Get("collection_id")
	if cid == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A collection is required.")
		return
	}
	res, err := h.client.ListWikiPages(r.Context(), cid)
	if err != nil {
		h.logger.Warn("rag dashboard: list wiki pages failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the wiki pages.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// WikiIndex serves GET /v1/dashboard/rag/wiki/index?collection_id= (M26 OKF directory, rag:read).
func (h *RagDashboardHandler) WikiIndex(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	cid := r.URL.Query().Get("collection_id")
	if cid == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A collection id is required.")
		return
	}
	res, err := h.client.WikiIndex(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the wiki index.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// WikiLog serves GET /v1/dashboard/rag/wiki/log?collection_id= (M26 OKF changelog, rag:read).
func (h *RagDashboardHandler) WikiLog(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	cid := r.URL.Query().Get("collection_id")
	if cid == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A collection id is required.")
		return
	}
	res, err := h.client.WikiLog(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the wiki log.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// GetWikiPage serves GET /v1/dashboard/rag/wiki/pages/{id} (Open Wiki, rag:read).
func (h *RagDashboardHandler) GetWikiPage(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A page id is required.")
		return
	}
	res, err := h.client.GetWikiPage(r.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			writeError(w, http.StatusNotFound, "WIKI_PAGE_NOT_FOUND", "That wiki page does not exist.")
			return
		}
		h.logger.Warn("rag dashboard: get wiki page failed", "error", err)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not load the wiki page.")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// CreateWikiPage serves POST /v1/dashboard/rag/wiki/pages (Open Wiki, rag:write). Body
// {collection_id,name,content}; theo-rag ingests + embeds the markdown page.
func (h *RagDashboardHandler) CreateWikiPage(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Could not read the request body.")
		return
	}
	res, err := h.client.CreateWikiPage(r.Context(), json.RawMessage(body))
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "404"):
			writeError(w, http.StatusNotFound, "COLLECTION_NOT_FOUND", "That collection does not exist.")
		case strings.Contains(err.Error(), "413"):
			writeError(w, http.StatusRequestEntityTooLarge, "CONTENT_TOO_LARGE", "The page is too large.")
		case strings.Contains(err.Error(), "422"), strings.Contains(err.Error(), "400"):
			writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "The page name and content must not be empty.")
		default:
			h.logger.Warn("rag dashboard: create wiki page failed", "error", err)
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not create the wiki page.")
		}
		return
	}
	writeJSON(w, http.StatusAccepted, res)
}

// UpdateWikiPage serves PUT /v1/dashboard/rag/wiki/pages/{id} (KB0 page lifecycle, rag:write).
// Body {name?,content}; theo-rag re-parses the OKF frontmatter, re-embeds, and a changed
// frontmatter path is a rename/move.
func (h *RagDashboardHandler) UpdateWikiPage(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A page id is required.")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Could not read the request body.")
		return
	}
	res, err := h.client.UpdateWikiPage(r.Context(), id, json.RawMessage(body))
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "404"):
			writeError(w, http.StatusNotFound, "PAGE_NOT_FOUND", "That page does not exist.")
		case strings.Contains(err.Error(), "409"):
			writeError(w, http.StatusConflict, "PAGE_BUSY", "The page is being updated; try again.")
		case strings.Contains(err.Error(), "413"):
			writeError(w, http.StatusRequestEntityTooLarge, "CONTENT_TOO_LARGE", "The page is too large.")
		case strings.Contains(err.Error(), "422"), strings.Contains(err.Error(), "400"):
			writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "The page content must not be empty.")
		default:
			h.logger.Warn("rag dashboard: update wiki page failed", "error", err)
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not update the wiki page.")
		}
		return
	}
	writeJSON(w, http.StatusAccepted, res)
}

// DeleteWikiPage serves DELETE /v1/dashboard/rag/wiki/pages/{id} (KB0 page lifecycle, rag:delete).
func (h *RagDashboardHandler) DeleteWikiPage(w http.ResponseWriter, r *http.Request) {
	if !h.authTenant(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_REQUEST", "A page id is required.")
		return
	}
	if err := h.client.DeleteWikiPage(r.Context(), id); err != nil {
		switch {
		case strings.Contains(err.Error(), "404"):
			writeError(w, http.StatusNotFound, "PAGE_NOT_FOUND", "That page does not exist.")
		default:
			h.logger.Warn("rag dashboard: delete wiki page failed", "error", err)
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "Could not delete the wiki page.")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
