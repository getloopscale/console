// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// M22 (loopskills Model B) — AdminClient is the CONTROL-PLANE client the gateway
// uses to provision per-tenant loopscaleskill_live_* keys against loopskills'
// platform API (POST /v1/platform/keys). It holds the platform credential
// (env SKILLS_PLATFORM_ADMIN_KEY) and is used ONLY to mint — NEVER on the data
// path. That structural separation is the NIST AC-5/AC-6 control/data-plane split
// that closes the confused deputy (CWE-441): a data-path bug can no longer wield
// provisioning authority.
//
// WHY A DIFFERENT ROUTE THAN trust/loopmem. loopskills' `POST /v1/admin/keys`
// derives the workspace from the CALLER's principal and requires the target to be
// a member of it — correct for a human administering their own team, and useless
// for a broker, which must mint into an arbitrary tenant. loopskills therefore
// exposes a separate `POST /v1/platform/keys` with its own credential; collapsing
// the two would have weakened the membership and anti-escalation checks on one of
// the paths, and a security check with an "unless" is the one nobody audits.
//
// Ported from internal/trust/admin_client.go — same lifecycle, different contract:
// the request carries `workspace_id` (not `name`) and the response field is
// `token` (not `secret`).
package skills

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Error is a typed wrapper for a non-2xx upstream response. The platform
// credential is NEVER part of it — only the upstream status and a length-limited
// body excerpt.
type Error struct {
	StatusCode int
	Body       string
}

func (e *Error) Error() string {
	return fmt.Sprintf("skills: upstream status %d: %s", e.StatusCode, e.Body)
}

// AdminClient talks to loopskills' platform key-mint API. Construct via
// NewAdminClient. It is the ONLY holder of the platform credential.
type AdminClient struct {
	baseURL     string
	platformKey string
	httpClient  *http.Client
}

// NewAdminClient constructs the control-plane client. platformKey is the
// loopskills platform credential (env SKILLS_PLATFORM_ADMIN_KEY) — held ONLY
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

// MintResult is the subset of loopskills' POST /v1/platform/keys response the
// gateway consumes. Secret is shown once — the broker caches it; it is NEVER
// logged nor returned to the browser.
//
// The upstream field is `token`; it is mapped onto Secret so this type matches
// the shape the shared broker expects.
type MintResult struct {
	ID     string   `json:"key_id"`
	Secret string   `json:"token"`
	Scopes []string `json:"scopes"`
}

// MintKey provisions a per-tenant key bound to workspaceID (== cloud tenant id)
// with the given scopes.
//
// `name` is accepted to satisfy the broker's minter interface and is deliberately
// UNUSED: loopskills binds platform-minted keys to a reserved system user, so a
// caller-supplied label would be a field the upstream ignores — carrying it would
// suggest a naming capability that does not exist.
//
// Fails closed: a non-2xx response OR an empty minted token returns an error and
// a nil result, so the broker never caches a useless credential.
func (a *AdminClient) MintKey(ctx context.Context, workspaceID, _ string, scopes []string) (*MintResult, error) {
	// Guarded here as well as upstream: a mint against workspace "" would create a
	// credential nobody can attribute, and the broker is not the only possible caller.
	if workspaceID == "" {
		return nil, fmt.Errorf("skills: empty workspace id")
	}
	if len(scopes) == 0 {
		return nil, fmt.Errorf("skills: refusing to mint a key with no scopes")
	}
	reqBody := map[string]any{"workspace_id": workspaceID, "scopes": scopes}
	var out MintResult
	if err := a.do(ctx, http.MethodPost, "/v1/platform/keys", reqBody, &out); err != nil {
		return nil, err
	}
	if out.Secret == "" {
		return nil, fmt.Errorf("skills: mint returned an empty token")
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
			return fmt.Errorf("skills admin: marshal body: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("skills admin: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.platformKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("skills admin: %s %s: %w", method, path, err)
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
		return fmt.Errorf("skills admin: decode response: %w", err)
	}
	return nil
}
