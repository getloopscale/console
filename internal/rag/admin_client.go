// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Model B (edge-integration M14) — AdminClient is the CONTROL-PLANE client the
// gateway uses to provision per-tenant rag_live_* keys against theo-rag's admin
// API. It holds the platform-admin credential (rag:platform-admin) and is used
// ONLY to mint keys — NEVER on the data path. The Broker (broker.go) holds no
// reference to the platform key; this structural separation is the NIST
// AC-5/AC-6 control/data-plane split that closes the confused deputy (CWE-441):
// a data-path bug can no longer wield provisioning authority.
//
// Adapted from internal/themory/admin_client.go (Rule 9). The ONE deviation:
// theo-rag's M12 POST /v1/admin/keys returns a NESTED envelope
// {"key":{"id","scopes"},"raw_key":"rag_live_..."} (not TheMemory's flat
// {"id","secret"}), so MintKey unmarshals that shape and maps raw_key -> Secret.
//
// @see .claude/knowledge-base/discoveries/blueprints/edge-rag-broker-blueprint.md § D2
package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// ErrNotFound is returned for 404 responses.
var ErrNotFound = errors.New("rag: not found")

// IsNotFound reports whether err is or wraps ErrNotFound.
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

// Error is a typed wrapper for non-2xx responses other than 404.
type Error struct {
	StatusCode int
	Body       string
}

func (e *Error) Error() string {
	return fmt.Sprintf("rag: upstream status %d: %s", e.StatusCode, e.Body)
}

// AdminClient talks to theo-rag's admin key-lifecycle API. Construct via
// NewAdminClient. Holds the platform credential so the data path cannot reach it.
type AdminClient struct {
	baseURL     string
	platformKey string
	httpClient  *http.Client
}

// NewAdminClient constructs the control-plane client. platformKey is the
// rag:platform-admin credential (env RAG_PLATFORM_ADMIN_KEY) — held ONLY here.
// httpClient may be nil (uses http.DefaultClient).
func NewAdminClient(baseURL, platformKey string, httpClient *http.Client) *AdminClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &AdminClient{
		baseURL:     strings.TrimRight(baseURL, "/"),
		platformKey: platformKey,
		httpClient:  httpClient,
	}
}

// MintResult is the subset of theo-rag's mint response the gateway consumes.
// Secret is the raw rag_live_* key, shown once — the broker caches it; it is
// NEVER logged or returned to the browser.
type MintResult struct {
	ID     string
	Secret string
	Scopes []string
}

// mintResponse mirrors theo-rag's M12 POST /v1/admin/keys response envelope
// ({"key":{...},"raw_key":"..."}). Kept private — callers see MintResult.
type mintResponse struct {
	Key struct {
		ID     string   `json:"id"`
		Scopes []string `json:"scopes"`
	} `json:"key"`
	RawKey string `json:"raw_key"`
}

// MintKey provisions a per-tenant key bound to workspaceID (== cloud tenant id)
// with the given scopes. Requires the platform-admin credential server-side.
// Fails closed on a malformed body: a 2xx without raw_key is an error (EC-1) —
// never a MintResult with an empty Secret the broker would cache for the full TTL.
func (a *AdminClient) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
	reqBody := map[string]any{"name": name, "scopes": scopes, "workspace_id": workspaceID}
	var resp mintResponse
	if err := a.do(ctx, http.MethodPost, "/v1/admin/keys", reqBody, &resp); err != nil {
		return nil, err
	}
	if resp.RawKey == "" {
		return nil, fmt.Errorf("rag admin: mint response missing raw_key")
	}
	return &MintResult{ID: resp.Key.ID, Secret: resp.RawKey, Scopes: resp.Key.Scopes}, nil
}

// RevokeKey soft-deletes a previously-minted key by id (tenant offboarding /
// rotation). Idempotent from the caller's view: 404 is treated as already-gone.
func (a *AdminClient) RevokeKey(ctx context.Context, id string) error {
	err := a.do(ctx, http.MethodDelete, "/v1/admin/keys/"+url.PathEscape(id), nil, nil)
	if IsNotFound(err) {
		return nil
	}
	return err
}

// do is the admin request lifecycle: attaches the platform credential, maps
// 404 -> ErrNotFound, other 4xx/5xx -> *Error, decodes 2xx into out.
func (a *AdminClient) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("rag admin: marshal body: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("rag admin: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.platformKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("rag admin: %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &Error{StatusCode: resp.StatusCode, Body: string(raw)}
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("rag admin: decode response: %w", err)
	}
	return nil
}
