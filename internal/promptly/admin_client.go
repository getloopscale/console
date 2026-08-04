// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M11 (theo-promptly Model B L2) — AdminClient is the CONTROL-PLANE client the
// gateway uses to provision per-tenant promptly_live_* keys against
// theo-promptly's admin API. It holds the platform-admin credential
// (prompt:platform-admin) and is used ONLY to mint keys — NEVER on the data path.
// This structural separation (NIST AC-5/AC-6 control/data split) closes the
// confused deputy (CWE-441): a data-path bug cannot wield provisioning authority.
//
// Mirrors internal/themory/admin_client.go. Differences (plan ADR D2/D4):
//   - POSTs to /admin/keys (theo-promptly's NATIVE path, no /v1 — M5 ADR D2),
//     directly at the host-run service, never via the edge.
//   - MintResult is {ID, Secret} (theo-promptly returns {id, secret, keyPrefix},
//     not scopes).
//
// @see .claude/knowledge-base/plans/m11-integration-l2-plan.md § T2.1
package promptly

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

// Error is a typed wrapper for non-2xx upstream responses. The platform key is
// NEVER part of it (only the upstream status + body, body-limited).
type Error struct {
	StatusCode int
	Body       string
}

func (e *Error) Error() string {
	return fmt.Sprintf("promptly: upstream status %d: %s", e.StatusCode, e.Body)
}

// AdminClient talks to theo-promptly's admin key-lifecycle API. Construct via
// NewAdminClient.
type AdminClient struct {
	baseURL     string
	platformKey string
	httpClient  *http.Client
}

// NewAdminClient constructs the control-plane client. platformKey is the
// prompt:platform-admin credential (env PROMPTLY_PLATFORM_ADMIN_KEY) — held ONLY
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

// MintResult is the subset of theo-promptly's POST /admin/keys response the
// gateway consumes. Secret is shown once — the broker caches it; it is NEVER
// logged or returned to the browser.
type MintResult struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
}

// MintKey provisions a per-tenant key bound to workspaceID (== cloud tenant id)
// with the given (already translated + intersected) prompt:* scopes. Fails
// closed: a non-2xx response OR an empty minted secret (EC-1) returns an error
// and a nil result, so the broker never caches a useless credential.
func (a *AdminClient) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
	reqBody := map[string]any{"name": name, "scopes": scopes, "workspace_id": workspaceID}
	var out MintResult
	if err := a.do(ctx, http.MethodPost, "/admin/keys", reqBody, &out); err != nil {
		return nil, err
	}
	if out.Secret == "" {
		return nil, errors.New("promptly: mint returned an empty secret")
	}
	return &out, nil
}

// MintKeyForUser provisiona uma chave VINCULADA a uma pessoa — M18.
//
// A diferença para `MintKey` é um campo, e a consequência é a autoridade: sem `user_id` o serviço
// não encontra membership, e todo papel cai no teto `member`. Foi assim que o gate de promoção do
// M18 nasceu inarmável e a discussão nasceu sem autor.
//
// Falha fechada pelo mesmo motivo da irmã: sem segredo, sem cache, sem requisição com credencial
// errada.
func (a *AdminClient) MintKeyForUser(ctx context.Context, workspaceID, name string, scopes []string, userID string) (*MintResult, error) {
	reqBody := map[string]any{"name": name, "scopes": scopes, "workspace_id": workspaceID, "user_id": userID}
	var out MintResult
	if err := a.do(ctx, http.MethodPost, "/admin/keys", reqBody, &out); err != nil {
		return nil, err
	}
	if out.Secret == "" {
		return nil, errors.New("promptly: mint returned an empty secret")
	}
	return &out, nil
}

// DeclareMember declara o papel de uma pessoa no workspace — M18.
//
// Precede o mint vinculado porque o serviço recusa vincular chave a quem não é membro, e a recusa
// é a guarda que impede um chamador de afirmar o próprio rank. Quem declara é a autoridade sobre o
// workspace, e o plano de controle é ela: os inquilinos são dele.
//
// Idempotente do outro lado — declarar de novo com papel diferente ATUALIZA, que é o que acontece
// quando alguém é promovido.
func (a *AdminClient) DeclareMember(ctx context.Context, workspaceID, userID, role, email string) error {
	path := "/admin/workspaces/" + url.PathEscape(workspaceID) + "/members/" + url.PathEscape(userID)
	return a.do(ctx, http.MethodPut, path, map[string]any{"role": role, "email": email}, nil)
}

// do is the admin request lifecycle. The platform credential goes ONLY in the
// Authorization header; it never appears in any returned error.
func (a *AdminClient) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("promptly admin: marshal body: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("promptly admin: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.platformKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("promptly admin: %s %s: %w", method, path, err)
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
		return fmt.Errorf("promptly admin: decode response: %w", err)
	}
	return nil
}
