// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Model B slice 2 (ADR D1) — AdminClient is the CONTROL-PLANE client the gateway
// uses to provision per-tenant theo_live_* keys against TheMemory's admin API.
// It holds the platform-admin credential (memory:platform-admin) and is used
// ONLY to mint / revoke keys — NEVER on the data path. The data-plane Client
// (client.go) has no reference to the platform key; this structural separation
// is the NIST AC-5/AC-6 control/data-plane split that closes the confused deputy
// (CWE-441): a data-path bug can no longer wield provisioning authority.
//
// @see .claude/knowledge-base/plans/model-b-credential-broker-plan.md § T1.1
package themory

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// AdminClient talks to TheMemory's admin key-lifecycle API. Construct via
// NewAdminClient. Distinct type from Client so the data path cannot reach the
// platform credential.
type AdminClient struct {
	baseURL     string
	platformKey string
	httpClient  *http.Client
}

// NewAdminClient constructs the control-plane client. platformKey is the
// memory:platform-admin credential (env THEMORY_PLATFORM_ADMIN_KEY) — held ONLY
// here. httpClient may be nil (uses http.DefaultClient).
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

// MintResult is the subset of TheMemory's POST /v1/admin/keys response the
// gateway consumes. Secret is shown once — the broker caches it; it is NEVER
// logged or returned to the browser.
type MintResult struct {
	ID     string   `json:"id"`
	Secret string   `json:"secret"`
	Scopes []string `json:"scopes"`
}

// MintKey provisions a per-tenant key bound to workspaceID (== cloud tenant id)
// with the given scopes. Requires the platform-admin credential server-side.
func (a *AdminClient) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
	reqBody := map[string]any{"name": name, "scopes": scopes, "workspace_id": workspaceID}
	var out MintResult
	if err := a.do(ctx, http.MethodPost, "/v1/admin/keys", reqBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
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

// do is the admin request lifecycle. Mirrors Client.do but with the platform
// credential. Reuses the shared Error / ErrNotFound types from client.go.
func (a *AdminClient) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("themory admin: marshal body: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("themory admin: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.platformKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("themory admin: %s %s: %w", method, path, err)
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
		return fmt.Errorf("themory admin: decode response: %w", err)
	}
	return nil
}
