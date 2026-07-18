// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package s3x

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Sentinel errors let callers branch on failure kind without string matching
// (error-handling.md — typed errors). Callers map these to HTTP status.
var (
	ErrObjectNotFound     = errors.New("s3x: object not found")
	ErrStorageAuth        = errors.New("s3x: storage auth rejected")
	ErrStorageUnavailable = errors.New("s3x: storage backend unavailable")
)

// Config declares the connection to an S3-compatible endpoint. All fields are
// required; New validates them.
type Config struct {
	Endpoint  string // e.g. "https://nyc3.digitaloceanspaces.com" or "http://minio:9000"
	Bucket    string
	Region    string
	AccessKey string
	SecretKey string
	// PublicEndpoint is the browser-reachable S3 host used ONLY when minting
	// presigned URLs (the SigV4 signature binds the host, so it must be the host
	// the client actually hits). The BFF's own server-side ops keep using Endpoint
	// (typically the fast in-cluster address). Empty → falls back to Endpoint.
	PublicEndpoint string
}

// ObjectInfo is the metadata returned by Head/Get.
type ObjectInfo struct {
	Size        int64
	ContentType string
}

// Client is a minimal S3-compatible object client. It is stateless after
// construction and safe for concurrent use.
type Client struct {
	endpoint       string // normalized, no trailing slash — used for server-side ops
	publicEndpoint string // normalized — used only to mint presigned URLs
	bucket         string
	signer         *Signer
	http           *http.Client
}

// New validates cfg and returns a Client. Path-style addressing is used so the
// same code path works for MinIO (local) and AWS S3 (prod).
func New(cfg Config) (*Client, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.Region == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("s3x: incomplete config (endpoint/bucket/region/accessKey/secretKey all required)")
	}
	normalize := func(ep string) string {
		ep = strings.TrimRight(ep, "/")
		if ep != "" && !strings.HasPrefix(ep, "http://") && !strings.HasPrefix(ep, "https://") {
			ep = "http://" + ep
		}
		return ep
	}
	endpoint := normalize(cfg.Endpoint)
	publicEndpoint := normalize(cfg.PublicEndpoint)
	if publicEndpoint == "" {
		publicEndpoint = endpoint // no separate public host → sign against the same host
	}
	return &Client{
		endpoint:       endpoint,
		publicEndpoint: publicEndpoint,
		bucket:         cfg.Bucket,
		signer:         &Signer{Region: cfg.Region, AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey},
		http:           &http.Client{Timeout: 60 * time.Second},
	}, nil
}

func (c *Client) objectURL(key string) string {
	return c.endpoint + "/" + c.bucket + "/" + strings.TrimPrefix(key, "/")
}

// publicObjectURL is objectURL against the browser-reachable host — used only when
// minting presigned URLs so the SigV4-signed host matches what the client hits.
func (c *Client) publicObjectURL(key string) string {
	return c.publicEndpoint + "/" + c.bucket + "/" + strings.TrimPrefix(key, "/")
}

// PutObject streams body (of the given size) to the object at key.
func (c *Client) PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	// A 0-byte object (empty __init__.py / .gitkeep / placeholder) must PUT with a
	// clean Content-Length: 0 and an empty payload. For an ARBITRARY non-nil reader
	// (e.g. the http.MaxBytesReader the Upload handler streams) Go cannot know the
	// length, so it sends chunked Transfer-Encoding — which S3/MinIO rejects under
	// SigV4 single-payload signing, surfacing as ErrStorageUnavailable (503). Only
	// *bytes/*strings.Reader get auto-normalized to http.NoBody; the real path does
	// not. Force NoBody here so empty objects round-trip. (Regression: a real
	// `theo storage sync` of a .claude/ skipped 15 empty package markers on 503.)
	if size == 0 {
		body = http.NoBody
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, c.objectURL(key), body)
	if err != nil {
		return err
	}
	req.ContentLength = size
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	c.signer.Sign(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	defer drainClose(resp.Body)
	return statusError(resp.StatusCode)
}

// GetObject returns a streaming reader for the object and its metadata. The
// caller MUST Close the returned reader.
func (c *Client) GetObject(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.objectURL(key), nil)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	c.signer.Sign(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, ObjectInfo{}, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	if err := statusError(resp.StatusCode); err != nil {
		drainClose(resp.Body)
		return nil, ObjectInfo{}, err
	}
	return resp.Body, infoFromHeader(resp.Header), nil
}

// HeadObject returns object metadata without the body.
func (c *Client) HeadObject(ctx context.Context, key string) (ObjectInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, c.objectURL(key), nil)
	if err != nil {
		return ObjectInfo{}, err
	}
	c.signer.Sign(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	defer drainClose(resp.Body)
	if err := statusError(resp.StatusCode); err != nil {
		return ObjectInfo{}, err
	}
	return infoFromHeader(resp.Header), nil
}

// DeleteObject removes the object at key. Deleting a missing object is not an
// error (S3 delete is idempotent — returns 204).
func (c *Client) DeleteObject(ctx context.Context, key string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.objectURL(key), nil)
	if err != nil {
		return err
	}
	c.signer.Sign(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	defer drainClose(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return nil // idempotent delete
	}
	return statusError(resp.StatusCode)
}

func statusError(code int) error {
	switch {
	case code >= 200 && code < 300:
		return nil
	case code == http.StatusNotFound:
		return ErrObjectNotFound
	case code == http.StatusForbidden || code == http.StatusUnauthorized:
		return ErrStorageAuth
	default:
		return fmt.Errorf("%w: status %d", ErrStorageUnavailable, code)
	}
}

func infoFromHeader(h http.Header) ObjectInfo {
	size, _ := strconv.ParseInt(h.Get("Content-Length"), 10, 64)
	return ObjectInfo{Size: size, ContentType: h.Get("Content-Type")}
}

func drainClose(rc io.ReadCloser) {
	_, _ = io.Copy(io.Discard, rc)
	_ = rc.Close()
}
