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
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
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
	Share(ctx context.Context, tenantID, path string, ttl time.Duration) (token string, expires time.Time, err error)
	Redeem(ctx context.Context, token string) (io.ReadCloser, storage.ObjectMeta, error)
	Usage(ctx context.Context, tenantID string) (storage.UsageInfo, error)
}

// StorageHandler serves the /v1/storage/* API. Product language only in every
// user-visible message (public-copy.md — never "S3"/"bucket").
type StorageHandler struct {
	svc StorageService
}

// NewStorageHandler builds the handler.
func NewStorageHandler(svc StorageService) *StorageHandler { return &StorageHandler{svc: svc} }

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
	err := h.svc.Upload(r.Context(), tenantOf(r), path, r.Body, r.ContentLength, mime)
	if err != nil {
		writeStorageError(w, statusForStorageErr(err), codeForStorageErr(err), messageForStorageErr(err))
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"path": path, "size": r.ContentLength})
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
	switch {
	case errors.Is(err, storage.ErrInvalidPath), errors.Is(err, storage.ErrShareTTLTooLong):
		return http.StatusBadRequest
	case errors.As(err, &qe):
		return http.StatusPaymentRequired // 402
	case errors.As(err, &fe):
		return http.StatusRequestEntityTooLarge // 413
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
	switch {
	case errors.Is(err, storage.ErrInvalidPath):
		return "invalid_path"
	case errors.Is(err, storage.ErrShareTTLTooLong):
		return "share_ttl_too_long"
	case errors.As(err, &qe):
		return "storage_quota_exceeded"
	case errors.As(err, &fe):
		return "file_too_large"
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
	switch {
	case errors.Is(err, storage.ErrInvalidPath):
		return "The file path is invalid."
	case errors.Is(err, storage.ErrShareTTLTooLong):
		return "The requested share duration exceeds the maximum of 7 days."
	case errors.As(err, &qe):
		return "Your plan's storage limit has been reached. Upgrade your plan or delete files to free space."
	case errors.As(err, &fe):
		return "This file exceeds the maximum file size for your plan."
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
