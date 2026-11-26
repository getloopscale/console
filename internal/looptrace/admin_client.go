// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Model B (edge-integration M38) — AdminClient is the CONTROL-PLANE client the
// gateway uses to provision per-tenant theo_live_* keys against looptrace's admin
// API. It holds the platform-admin credential (observability:platform-admin) and is used
// ONLY to mint keys — NEVER on the data path. This structural separation (NIST
// AC-5/AC-6 control/data split) closes the confused deputy (CWE-441): a data-path
// bug cannot wield provisioning authority.
//
// Mirrors internal/promptly/admin_client.go (Rule 9). looptrace's M22
// POST /v1/admin/keys returns a FLAT body {id,name,key_prefix,scopes,workspace_id,
// secret} at HTTP 200 (like loopmem/loopprompt, NOT looprag's nested
// {"key":{...},"raw_key":...}@201), so MintResult decodes that shape directly and
// maps `secret` -> Secret. Differences from promptly: the path carries /v1
// (looptrace's native prefix) and the response includes scopes (captured).
//
// @see looptrace knowledge-base/plans/m38-lens-broker-forwardauth-plan.md § T2
package looptrace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Error is a typed wrapper for non-2xx upstream responses. The platform key is
// NEVER part of it (only the upstream status + body, body-limited).
type Error struct {
	StatusCode int
	Body       string
}

func (e *Error) Error() string {
	return fmt.Sprintf("looptrace: upstream status %d: %s", e.StatusCode, e.Body)
}

// AdminClient talks to looptrace's admin key-lifecycle API. Construct via
// NewAdminClient. Holds the platform credential so the data path cannot reach it.
type AdminClient struct {
	baseURL     string
	platformKey string
	httpClient  *http.Client
}

// NewAdminClient constructs the control-plane client. platformKey is the
// observability:platform-admin credential (env LENS_PLATFORM_ADMIN_KEY) — held ONLY here.
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

// MintResult is the subset of looptrace's POST /v1/admin/keys response the gateway
// consumes. Secret is the raw theo_live_* key, shown once — the broker caches it;
// it is NEVER logged or returned to the browser.
type MintResult struct {
	ID     string   `json:"id"`
	Secret string   `json:"secret"`
	Scopes []string `json:"scopes"`
}

// MintKey provisions a per-tenant key bound to workspaceID (== cloud tenant id)
// with the given (already intersected) lens:* scopes. Fails closed: a non-2xx
// response OR an empty minted secret returns an error and a nil result, so the
// broker never caches a useless credential.
func (a *AdminClient) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
	reqBody := map[string]any{"name": name, "scopes": scopes, "workspace_id": workspaceID}
	var out MintResult
	if err := a.do(ctx, http.MethodPost, "/v1/admin/keys", reqBody, &out); err != nil {
		return nil, err
	}
	if out.Secret == "" {
		return nil, errors.New("looptrace: mint returned an empty secret")
	}
	return &out, nil
}

// do is the admin request lifecycle. The platform credential goes ONLY in the
// Authorization header; it never appears in any returned error.
func (a *AdminClient) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("looptrace admin: marshal body: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("looptrace admin: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.platformKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("looptrace admin: %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &Error{StatusCode: resp.StatusCode, Body: string(raw)}
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("looptrace admin: decode response: %w", err)
	}
	return nil
}
