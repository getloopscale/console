// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package storageproxy is the thin-proxy implementation of the storage vertical:
// it satisfies the same interface routes.NewStorageHandler consumes, but instead
// of running the in-process storage.Service it forwards each op to the standalone
// theo-storage service. theo-cloud is the trusted edge here — it has already
// authenticated the client's theo_live_* key + scope, so it injects the resolved
// tenant as X-Theo-Tenant (theo-storage's `header` auth mode trusts it, exactly
// like the Model B ForwardAuth trust boundary the other data services use).
//
// This is the strangler-fig endgame: the in-process vertical and this proxy are
// interchangeable behind the interface (DIP), so cmd/main.go swaps by config —
// STORAGE_UPSTREAM_URL set → proxy; else → in-process.
package storageproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/usetheodev/theo-cloud/internal/storage"
	"github.com/usetheodev/theo-cloud/internal/storage/share"
)

const (
	tenantHeader = "X-Theo-Tenant"
	scopeHeader  = "X-Theo-Scopes"
	fullScopes   = "storage:read storage:write"
	sharedPrefix = "/v1/storage/shared/"
)

// Client forwards storage ops to a theo-storage upstream. It holds no standing
// credential — the tenant is injected per request from the arg the handler
// already resolved from the client's authenticated key.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a proxy client. baseURL is theo-storage's root (e.g.
// http://theo-storage:8080). hc may be nil (http.DefaultClient).
func New(baseURL string, hc *http.Client) *Client {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), http: hc}
}

func (c *Client) newReq(ctx context.Context, method, tenant, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set(tenantHeader, tenant)
	req.Header.Set(scopeHeader, fullScopes)
	return req, nil
}

// errFromResponse maps an upstream non-2xx response back to the SAME typed errors
// the in-process service returns, so the handler's error mapping is identical
// whether it wraps the in-process service or this proxy. Mapping is by HTTP
// status (the canonical contract); the 400 case reads the body code to pick
// between the two 400-class errors.
func errFromResponse(resp *http.Response) error {
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	_ = json.Unmarshal(body, &payload)
	code := payload.Error.Code
	switch resp.StatusCode {
	case http.StatusPaymentRequired:
		return &storage.QuotaExceededError{}
	case http.StatusRequestEntityTooLarge:
		return &storage.FileTooLargeError{}
	case http.StatusNotFound:
		return storage.ErrObjectNotFoundMeta
	case http.StatusGone:
		return share.ErrExpired
	case http.StatusForbidden:
		return share.ErrInvalid
	case http.StatusBadRequest:
		if code == "share_ttl_too_long" {
			return storage.ErrShareTTLTooLong
		}
		return storage.ErrInvalidPath
	default:
		// Anything else (503, 5xx, unexpected) surfaces as a generic error so
		// the handler's default branch maps it to 503.
		msg := payload.Error.Message
		if msg == "" {
			msg = resp.Status
		}
		return fmt.Errorf("theo-storage upstream: %s (%s)", msg, code)
	}
}

// Upload streams the body to theo-storage's PUT, injecting the tenant.
func (c *Client) Upload(ctx context.Context, tenantID, path string, body io.Reader, size int64, mime string) error {
	// A 0-byte object must forward with a clean Content-Length: 0 — an arbitrary
	// non-nil reader of unknown length makes Go emit chunked Transfer-Encoding,
	// which corrupts the size the upstream reads (r.ContentLength becomes -1). Force
	// http.NoBody for empty objects so empty files round-trip in proxy mode too.
	// Mirrors the same guard in s3x.Client.PutObject (in-process mode).
	if size == 0 {
		body = http.NoBody
	}
	req, err := c.newReq(ctx, http.MethodPut, tenantID, "/v1/storage/objects/"+path, body)
	if err != nil {
		return err
	}
	req.ContentLength = size
	if mime != "" {
		req.Header.Set("Content-Type", mime)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	return errFromResponse(resp)
}

// Download opens a stream of the object from theo-storage. The caller closes rc.
func (c *Client) Download(ctx context.Context, tenantID, path string) (io.ReadCloser, storage.ObjectMeta, error) {
	return c.stream(ctx, http.MethodGet, tenantID, "/v1/storage/objects/"+path)
}

// stream is the shared GET-and-return-body path for Download + Redeem.
func (c *Client) stream(ctx context.Context, method, tenant, path string) (io.ReadCloser, storage.ObjectMeta, error) {
	req, err := c.newReq(ctx, method, tenant, path, nil)
	if err != nil {
		return nil, storage.ObjectMeta{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, storage.ObjectMeta{}, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, storage.ObjectMeta{}, errFromResponse(resp)
	}
	size, _ := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	return resp.Body, storage.ObjectMeta{Size: size, ContentType: resp.Header.Get("Content-Type")}, nil
}

// Stat fetches object metadata.
func (c *Client) Stat(ctx context.Context, tenantID, path string) (storage.ObjectRecord, error) {
	req, err := c.newReq(ctx, http.MethodGet, tenantID, "/v1/storage/stat/"+path, nil)
	if err != nil {
		return storage.ObjectRecord{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return storage.ObjectRecord{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return storage.ObjectRecord{}, errFromResponse(resp)
	}
	var body struct {
		Path        string `json:"path"`
		Size        int64  `json:"size"`
		ContentType string `json:"content_type"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return storage.ObjectRecord{}, err
	}
	return storage.ObjectRecord{Name: body.Path, SizeBytes: body.Size, MimeType: body.ContentType}, nil
}

// List fetches one page of objects under a prefix.
func (c *Client) List(ctx context.Context, tenantID, prefix string, limit int, cursor string) ([]storage.ObjectRecord, string, error) {
	q := url.Values{}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	p := "/v1/storage/objects"
	if len(q) > 0 {
		p += "?" + q.Encode()
	}
	req, err := c.newReq(ctx, http.MethodGet, tenantID, p, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", errFromResponse(resp)
	}
	var body struct {
		Files []struct {
			Path        string `json:"path"`
			Size        int64  `json:"size"`
			ContentType string `json:"content_type"`
		} `json:"files"`
		NextCursor string `json:"next_cursor"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, "", err
	}
	recs := make([]storage.ObjectRecord, 0, len(body.Files))
	for _, f := range body.Files {
		recs = append(recs, storage.ObjectRecord{Name: f.Path, SizeBytes: f.Size, MimeType: f.ContentType})
	}
	return recs, body.NextCursor, nil
}

// Delete removes an object.
func (c *Client) Delete(ctx context.Context, tenantID, path string) error {
	req, err := c.newReq(ctx, http.MethodDelete, tenantID, "/v1/storage/objects/"+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
		return nil
	}
	return errFromResponse(resp)
}

// DeletePrefix deletes a whole folder by enumerating (List) + deleting each object
// upstream, reusing the shared loop so bulk-delete behaves identically to the
// in-process mode (same safePrefix guard, bound, idempotency, partial-failure).
// No new upstream endpoint is needed — it composes the existing List + Delete.
func (c *Client) DeletePrefix(ctx context.Context, tenantID, prefix string) (storage.BulkDeleteResult, error) {
	return storage.DeletePrefixOver(ctx, tenantID, prefix, c.List, c.Delete)
}

// Share mints a share link upstream and returns just the token (the handler
// re-wraps it into theo-cloud's own /v1/storage/shared/{token} URL).
func (c *Client) Share(ctx context.Context, tenantID, path string, ttl time.Duration) (string, time.Time, error) {
	reqBody, _ := json.Marshal(map[string]any{
		"path":               path,
		"expires_in_seconds": int64(ttl / time.Second),
	})
	req, err := c.newReq(ctx, http.MethodPost, tenantID, "/v1/storage/share", strings.NewReader(string(reqBody)))
	if err != nil {
		return "", time.Time{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", time.Time{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", time.Time{}, errFromResponse(resp)
	}
	var body struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", time.Time{}, err
	}
	token := strings.TrimPrefix(body.URL, sharedPrefix)
	exp, _ := time.Parse(time.RFC3339, body.ExpiresAt)
	return token, exp, nil
}

// Redeem streams the shared object. It carries no tenant header — the token is
// the capability, resolved entirely upstream (same as the in-process Redeem).
func (c *Client) Redeem(ctx context.Context, token string) (io.ReadCloser, storage.ObjectMeta, error) {
	return c.stream(ctx, http.MethodGet, "", sharedPrefix+token)
}

// Usage fetches the tenant's used bytes + plan caps.
func (c *Client) Usage(ctx context.Context, tenantID string) (storage.UsageInfo, error) {
	req, err := c.newReq(ctx, http.MethodGet, tenantID, "/v1/storage/usage", nil)
	if err != nil {
		return storage.UsageInfo{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return storage.UsageInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return storage.UsageInfo{}, errFromResponse(resp)
	}
	var body struct {
		UsedBytes      int64  `json:"used_bytes"`
		AggregateLimit int64  `json:"aggregate_limit"`
		PerFileLimit   int64  `json:"per_file_limit"`
		Tier           string `json:"tier"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return storage.UsageInfo{}, err
	}
	return storage.UsageInfo{
		UsedBytes:      body.UsedBytes,
		AggregateLimit: body.AggregateLimit,
		PerFileLimit:   body.PerFileLimit,
		Tier:           body.Tier,
	}, nil
}

// presignPost forwards a presign mint (upload/download) to the upstream storage
// service and decodes the {url, expires_at} envelope. The upstream owns the S3
// signing; theo-cloud only relays the already-authenticated tenant.
func (c *Client) presignPost(ctx context.Context, tenantID, endpoint string, reqBody any) (string, time.Time, error) {
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return "", time.Time{}, err
	}
	req, err := c.newReq(ctx, http.MethodPost, tenantID, endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", time.Time{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", time.Time{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", time.Time{}, errFromResponse(resp)
	}
	var out struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", time.Time{}, err
	}
	exp, _ := time.Parse(time.RFC3339, out.ExpiresAt)
	return out.URL, exp, nil
}

// PresignUpload forwards POST /v1/storage/presign-upload.
func (c *Client) PresignUpload(ctx context.Context, tenantID, path string, size int64, mime string) (string, time.Time, error) {
	return c.presignPost(ctx, tenantID, "/v1/storage/presign-upload",
		map[string]any{"path": path, "size": size, "content_type": mime})
}

// PresignDownload forwards POST /v1/storage/presign-download.
func (c *Client) PresignDownload(ctx context.Context, tenantID, path string) (string, time.Time, error) {
	return c.presignPost(ctx, tenantID, "/v1/storage/presign-download", map[string]any{"path": path})
}

// CommitUpload forwards POST /v1/storage/presign-commit.
func (c *Client) CommitUpload(ctx context.Context, tenantID, path string) error {
	raw, _ := json.Marshal(map[string]any{"path": path})
	req, err := c.newReq(ctx, http.MethodPost, tenantID, "/v1/storage/presign-commit", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errFromResponse(resp)
	}
	return nil
}
