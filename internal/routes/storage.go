// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/metrics"
	"github.com/usetheodev/theo-cloud/internal/storage"
	"github.com/usetheodev/theo-cloud/internal/storage/share"
)

// StorageService is the subset of *storage.Service the HTTP handlers depend on
// (DIP — the handler test stubs this; *storage.Service satisfies it).
type StorageService interface {
	Upload(ctx context.Context, tenantID, path string, body io.Reader, size int64, mime string) error
	Download(ctx context.Context, tenantID, path string) (io.ReadCloser, storage.ObjectMeta, error)
	Stat(ctx context.Context, tenantID, path string) (storage.ObjectRecord, error)
	List(ctx context.Context, tenantID, prefix string, limit int, cursor string) ([]storage.ObjectRecord, string, error)
	Delete(ctx context.Context, tenantID, path string) error
	DeletePrefix(ctx context.Context, tenantID, prefix string) (storage.BulkDeleteResult, error)
	Share(ctx context.Context, tenantID, path string, ttl time.Duration) (token string, expires time.Time, err error)
	Redeem(ctx context.Context, token string) (io.ReadCloser, storage.ObjectMeta, error)
	Usage(ctx context.Context, tenantID string) (storage.UsageInfo, error)
	// Presigned data-plane (M2/M3): mint direct-to-S3 URLs so bytes bypass the BFF.
	PresignUpload(ctx context.Context, tenantID, path string, size int64, mime string) (string, time.Time, error)
	CommitUpload(ctx context.Context, tenantID, path string) error
	PresignDownload(ctx context.Context, tenantID, path string) (string, time.Time, error)
}

// StorageHandler serves the /v1/storage/* API. Product language only in every
// user-visible message (public-copy.md — never "S3"/"bucket").
type StorageHandler struct {
	svc StorageService
}

// NewStorageHandler builds the handler.
func NewStorageHandler(svc StorageService) *StorageHandler { return &StorageHandler{svc: svc} }

// MountDashboardRoutes registers the /v1/dashboard/storage/* browser-session
// surface on r (the caller wraps r with requireJWT). It mirrors the theo_live_
// /v1/storage/* verbs — List / Stat / Upload / Delete / Share — PLUS Download,
// the read-one the Workspace folder-browser preview + download actions call.
// Keeping the mount here (not inline in the composition root) makes the route
// set testable: a missing verb surfaces as a 405 in a unit test, not in prod.
func (h *StorageHandler) MountDashboardRoutes(r chi.Router) {
	r.Get("/usage", h.Usage)
	r.Get("/objects", h.List)
	r.Get("/objects/*", h.Download)
	r.Get("/stat/*", h.Stat)
	r.Put("/objects/*", h.Upload)
	r.Delete("/objects/*", h.Delete)
	r.Post("/bulk-delete", h.BulkDelete)
	r.Post("/share", h.CreateShare)
	// Presigned data-plane (M2/M3). The path travels in the JSON body (not the URL)
	// to avoid colliding with the greedy /objects/* wildcard above.
	r.Post("/presign-upload", h.PresignUpload)
	r.Post("/presign-commit", h.CommitUpload)
	r.Post("/presign-download", h.PresignDownload)
}

func tenantOf(r *http.Request) string {
	if u := auth.GetUser(r.Context()); u != nil {
		return u.TenantID
	}
	return ""
}

// Upload serves PUT /v1/storage/objects/{path...} (scope storage:write).
func (h *StorageHandler) Upload(w http.ResponseWriter, r *http.Request) {
	path := chi.URLParam(r, "*")
	if r.ContentLength < 0 {
		writeStorageError(w, http.StatusLengthRequired, "length_required", "A Content-Length header is required to store a file.")
		return
	}
	mime := r.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	// HIGH-1: never trust the client Content-Length unbounded — cap the readable
	// body at the declared size so the bytes streamed to storage cannot exceed
	// what quota reserved (the per-file cap is enforced by the quota reserve on
	// the declared size; MaxBytesReader stops a body that lies larger).
	body := http.MaxBytesReader(w, r.Body, r.ContentLength)
	err := h.svc.Upload(r.Context(), tenantOf(r), path, body, r.ContentLength, mime)
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"path": path, "size": r.ContentLength})
}

// presignReq is the body for the presign endpoints: the object path (and, for an
// upload mint, the declared size + content type). The path is in the body — not
// the URL — to avoid the greedy /objects/* wildcard.
type presignReq struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
}

func decodePresignReq(w http.ResponseWriter, r *http.Request) (presignReq, bool) {
	var req presignReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil || req.Path == "" {
		writeStorageError(w, http.StatusBadRequest, "invalid_request", "A JSON body with a non-empty \"path\" is required.")
		return presignReq{}, false
	}
	return req, true
}

// PresignUpload serves POST /presign-upload: reserves quota + mints a presigned
// PUT URL so the client uploads the bytes DIRECTLY to S3. Finalized by CommitUpload.
func (h *StorageHandler) PresignUpload(w http.ResponseWriter, r *http.Request) {
	req, ok := decodePresignReq(w, r)
	if !ok {
		return
	}
	mime := req.ContentType
	if mime == "" {
		mime = "application/octet-stream"
	}
	url, expires, err := h.svc.PresignUpload(r.Context(), tenantOf(r), req.Path, req.Size, mime)
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	writeJSONOK(w, map[string]any{
		"url":        url,
		"method":     "PUT",
		"path":       req.Path,
		"expires_at": expires.Format(time.RFC3339),
	})
}

// CommitUpload serves POST /presign-commit: confirms the direct-to-S3 upload
// landed (HEAD + size match) and commits the pending metadata row.
func (h *StorageHandler) CommitUpload(w http.ResponseWriter, r *http.Request) {
	req, ok := decodePresignReq(w, r)
	if !ok {
		return
	}
	if err := h.svc.CommitUpload(r.Context(), tenantOf(r), req.Path); err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	writeJSONOK(w, map[string]any{"path": req.Path, "committed": true})
}

// PresignDownload serves POST /presign-download: mints a short-lived presigned GET
// URL for a committed object so the client reads the bytes DIRECTLY from S3.
func (h *StorageHandler) PresignDownload(w http.ResponseWriter, r *http.Request) {
	req, ok := decodePresignReq(w, r)
	if !ok {
		return
	}
	url, expires, err := h.svc.PresignDownload(r.Context(), tenantOf(r), req.Path)
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	writeJSONOK(w, map[string]any{
		"url":        url,
		"method":     "GET",
		"path":       req.Path,
		"expires_at": expires.Format(time.RFC3339),
	})
}

// Download serves GET /v1/storage/objects/{path...} (scope storage:read).
func (h *StorageHandler) Download(w http.ResponseWriter, r *http.Request) {
	rc, meta, err := h.svc.Download(r.Context(), tenantOf(r), chi.URLParam(r, "*"))
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	defer rc.Close()
	writeObjectStream(w, rc, meta, chi.URLParam(r, "*"))
}

// Stat serves GET /v1/storage/stat/{path...} (scope storage:read).
func (h *StorageHandler) Stat(w http.ResponseWriter, r *http.Request) {
	rec, err := h.svc.Stat(r.Context(), tenantOf(r), chi.URLParam(r, "*"))
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	writeJSONOK(w, map[string]any{"path": rec.Name, "size": rec.SizeBytes, "content_type": rec.MimeType})
}

// List serves GET /v1/storage/objects?prefix=&limit=&cursor= (scope storage:read).
func (h *StorageHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	recs, next, err := h.svc.List(r.Context(), tenantOf(r), r.URL.Query().Get("prefix"), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	items := make([]map[string]any, 0, len(recs))
	for _, rec := range recs {
		items = append(items, map[string]any{"path": rec.Name, "size": rec.SizeBytes, "content_type": rec.MimeType})
	}
	writeJSONOK(w, map[string]any{"files": items, "next_cursor": next})
}

// Usage serves GET /v1/dashboard/storage/usage — the tenant's used bytes + plan
// caps (dashboard quota bar). Session-authenticated (requireJWT).
func (h *StorageHandler) Usage(w http.ResponseWriter, r *http.Request) {
	info, err := h.svc.Usage(r.Context(), tenantOf(r))
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	writeJSONOK(w, map[string]any{
		"used_bytes":      info.UsedBytes,
		"aggregate_limit": info.AggregateLimit,
		"per_file_limit":  info.PerFileLimit,
		"tier":            info.Tier,
		"unlimited":       info.AggregateLimit < 0,
	})
}

// Delete serves DELETE /v1/storage/objects/{path...} (scope storage:write).
func (h *StorageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), tenantOf(r), chi.URLParam(r, "*")); err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// bulkDeleteMaxItems bounds the request itself (paths + prefixes) so one call
// cannot enqueue an unbounded amount of work. bulkDeleteMaxBodyBytes bounds the
// raw JSON before it is parsed into memory (DoS guard, mirrors Upload's cap).
// bulkDeleteMaxTotalObjects bounds the TOTAL objects one request may remove
// across all prefixes (a request of N prefixes each near the per-prefix cap could
// otherwise fan out to N×cap deletes in one synchronous call).
const (
	bulkDeleteMaxItems        = 1000
	bulkDeleteMaxBodyBytes    = 1 << 20 // 1 MiB
	bulkDeleteMaxTotalObjects = 10000
)

type bulkDeleteRequest struct {
	Paths    []string `json:"paths"`
	Prefixes []string `json:"prefixes"`
}

// BulkDelete serves POST /v1/dashboard/storage/bulk-delete — deletes a set of
// files (paths) and/or whole folders (prefixes) in one tenant-scoped call. The
// tenant comes from the session (auth.GetUser), never the client (EC-1). A folder
// prefix MUST end with "/" (EC-2). Partial failure is a 200 with failed[] (D4);
// an already-absent object is idempotent success, not a failure (D5/EC-1).
func (h *StorageHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	// Bound the raw body before parsing (DoS guard) — mirrors Upload's MaxBytesReader.
	r.Body = http.MaxBytesReader(w, r.Body, bulkDeleteMaxBodyBytes)
	var req bulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeStorageError(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON with 'paths' and/or 'prefixes'.")
		return
	}
	if len(req.Paths)+len(req.Prefixes) > bulkDeleteMaxItems {
		writeStorageError(w, http.StatusBadRequest, "too_many_items", "Too many items in one request. Delete them in smaller batches.")
		return
	}
	for _, pre := range req.Prefixes {
		if !strings.HasSuffix(pre, "/") {
			writeStorageError(w, http.StatusBadRequest, "invalid_folder", "A folder to delete must end with a slash.")
			return
		}
	}
	tenant := tenantOf(r)
	deleted := 0
	var freed int64
	failed := make([]map[string]any, 0)
	truncated := false
	for _, p := range req.Paths {
		// LOW-1: validate at the boundary so both storage modes reject the same inputs
		// (in-process Delete validates; the thin-proxy Delete does not).
		if err := storage.ValidatePath(p); err != nil {
			failed = append(failed, map[string]any{"path": p, "reason": codeForStorageErr(err)})
			continue
		}
		// D5/EC-1: an already-absent object (overlap / re-click / cross-tab) is success.
		if err := h.svc.Delete(r.Context(), tenant, p); err == nil || errors.Is(err, storage.ErrObjectNotFoundMeta) {
			deleted++
		} else {
			failed = append(failed, map[string]any{"path": p, "reason": codeForStorageErr(err)})
		}
	}
	for _, pre := range req.Prefixes {
		// MEDIUM-2: bound TOTAL objects removed per request across all prefixes.
		if deleted >= bulkDeleteMaxTotalObjects {
			truncated = true
			break
		}
		res, err := h.svc.DeletePrefix(r.Context(), tenant, pre)
		if err != nil {
			failed = append(failed, map[string]any{"path": pre, "reason": codeForStorageErr(err)})
			continue
		}
		deleted += res.Deleted
		freed += res.Freed
		for _, f := range res.Failed {
			failed = append(failed, map[string]any{"path": f.Path, "reason": f.Reason})
		}
		truncated = truncated || res.Truncated
	}
	metrics.AddObjectsDeleted(deleted) // wiring pillar (c): ops can see mass-deletes fire
	writeJSONOK(w, map[string]any{
		"deleted":     deleted,
		"freed_bytes": freed,
		"failed":      failed,
		"truncated":   truncated,
	})
}

type shareRequest struct {
	Path             string `json:"path"`
	ExpiresInSeconds int64  `json:"expires_in_seconds"`
}

// CreateShare serves POST /v1/storage/share (scope storage:write).
func (h *StorageHandler) CreateShare(w http.ResponseWriter, r *http.Request) {
	var req shareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeStorageError(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON with a 'path'.")
		return
	}
	token, exp, err := h.svc.Share(r.Context(), tenantOf(r), req.Path, time.Duration(req.ExpiresInSeconds)*time.Second)
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	writeJSONOK(w, map[string]any{"url": "/v1/storage/shared/" + token, "expires_at": exp.UTC().Format(time.RFC3339)})
}

// RedeemShare serves GET /v1/storage/shared/{token} — UNAUTHENTICATED. The token
// is the authorization. Rate-limited at the router (mounted under the ratelimit
// middleware). Streams with EC-2 security headers.
func (h *StorageHandler) RedeemShare(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	rc, meta, err := h.svc.Redeem(r.Context(), token)
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	defer rc.Close()
	writeObjectStream(w, rc, meta, "download")
}

// writeObjectStream streams the object with EC-2 stored-XSS neutralization: the
// stored Content-Type is client-declared, so we force download (never inline
// render) and disable MIME sniffing. Applied on BOTH download and share redemption.
func writeObjectStream(w http.ResponseWriter, rc io.Reader, meta storage.ObjectMeta, filename string) {
	ct := meta.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+sanitizeFilename(filename)+"\"")
	if meta.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}

func sanitizeFilename(p string) string {
	// Use only the last path segment; strip quotes/control to keep the header safe.
	name := p
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			name = p[i+1:]
			break
		}
	}
	out := make([]byte, 0, len(name))
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c == '"' || c < 0x20 || c == 0x7f {
			continue
		}
		out = append(out, c)
	}
	if len(out) == 0 {
		return "download"
	}
	return string(out)
}

// --- error mapping (typed error → HTTP status/code/message) ---------------

func statusForStorageErr(err error) int {
	var qe *storage.QuotaExceededError
	var fe *storage.FileTooLargeError
	var unc *storage.UploadNotCompletedError
	var sme *storage.SizeMismatchError
	switch {
	case errors.Is(err, storage.ErrInvalidPath), errors.Is(err, storage.ErrShareTTLTooLong):
		return http.StatusBadRequest
	case errors.As(err, &qe):
		return http.StatusPaymentRequired // 402
	case errors.As(err, &fe):
		return http.StatusRequestEntityTooLarge // 413
	case errors.As(err, &unc), errors.As(err, &sme):
		return http.StatusConflict // 409 — presigned upload not completed / size mismatch
	case errors.Is(err, storage.ErrObjectNotFoundMeta):
		return http.StatusNotFound
	case errors.Is(err, share.ErrExpired):
		return http.StatusGone // 410
	case errors.Is(err, share.ErrInvalid):
		return http.StatusForbidden
	default:
		return http.StatusServiceUnavailable // 503 — backend/unknown
	}
}

func codeForStorageErr(err error) string {
	var qe *storage.QuotaExceededError
	var fe *storage.FileTooLargeError
	var unc *storage.UploadNotCompletedError
	var sme *storage.SizeMismatchError
	switch {
	case errors.Is(err, storage.ErrInvalidPath):
		return "invalid_path"
	case errors.Is(err, storage.ErrShareTTLTooLong):
		return "share_ttl_too_long"
	case errors.As(err, &qe):
		return "storage_quota_exceeded"
	case errors.As(err, &fe):
		return "file_too_large"
	case errors.As(err, &unc):
		return "upload_not_completed"
	case errors.As(err, &sme):
		return "upload_size_mismatch"
	case errors.Is(err, storage.ErrObjectNotFoundMeta):
		return "file_not_found"
	case errors.Is(err, share.ErrExpired):
		return "share_expired"
	case errors.Is(err, share.ErrInvalid):
		return "share_invalid"
	default:
		return "storage_unavailable"
	}
}

func messageForStorageErr(err error) string {
	var qe *storage.QuotaExceededError
	var fe *storage.FileTooLargeError
	var unc *storage.UploadNotCompletedError
	var sme *storage.SizeMismatchError
	switch {
	case errors.Is(err, storage.ErrInvalidPath):
		return "The file path is invalid."
	case errors.Is(err, storage.ErrShareTTLTooLong):
		return "The requested share duration exceeds the maximum of 7 days."
	case errors.As(err, &qe):
		return "Your plan's storage limit has been reached. Upgrade your plan or delete files to free space."
	case errors.As(err, &fe):
		return "This file exceeds the maximum file size for your plan."
	case errors.As(err, &unc):
		return "The upload was not completed. Please try uploading the file again."
	case errors.As(err, &sme):
		return "The uploaded file did not match the expected size. Please try again."
	case errors.Is(err, storage.ErrObjectNotFoundMeta):
		return "The requested file was not found."
	case errors.Is(err, share.ErrExpired):
		return "This share link has expired."
	case errors.Is(err, share.ErrInvalid):
		return "This share link is invalid."
	default:
		return "Storage is temporarily unavailable. Please try again."
	}
}

func writeStorageError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": code, "message": message}})
}

func writeJSONOK(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}
