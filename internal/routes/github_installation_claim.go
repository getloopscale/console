// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/getloopscale/loop-console/internal/auth"
)

const engineClaimPath = "/api/v1/integrations/github/installations/claim"

// maxClaimResponseBytes bounds what is read from the engine's answer.
const maxClaimResponseBytes = 1 << 20

// GitHubClaimError is a failed claim. Code is the engine's error code, or one
// of SERVICE_UNAVAILABLE and INTERNAL_ERROR when the engine gave none. The
// engine's message is not kept: it may quote what GitHub answered.
type GitHubClaimError struct {
	Code string
	Err  error
}

func (e *GitHubClaimError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("github installation claim failed (%s): %v", e.Code, e.Err)
	}
	return fmt.Sprintf("github installation claim failed (%s)", e.Code)
}

func (e *GitHubClaimError) Unwrap() error { return e.Err }

// EngineRequestSigner adds the dual-control signature to a request bound for
// the engine. *auth.ServiceSigner implements it.
type EngineRequestSigner interface {
	Attach(r *http.Request) error
}

// EngineGitHubClaimer calls the engine's claim endpoint the way the /engine
// proxy calls the engine: the shared service secret, the caller's identity
// headers and, when a signer is configured, the request signature.
type EngineGitHubClaimer struct {
	engineURL     string
	client        *http.Client
	serviceSecret string
	signer        EngineRequestSigner
}

var _ GitHubInstallationClaimer = (*EngineGitHubClaimer)(nil)

// NewEngineGitHubClaimer wires the claimer. signer may be nil.
func NewEngineGitHubClaimer(engineURL string, client *http.Client, serviceSecret string, signer EngineRequestSigner) *EngineGitHubClaimer {
	return &EngineGitHubClaimer{engineURL: engineURL, client: client, serviceSecret: serviceSecret, signer: signer}
}

// ClaimInstallations posts the authorization code to the engine as user and
// returns how many installations the user's tenant has afterwards.
func (c *EngineGitHubClaimer) ClaimInstallations(ctx context.Context, user *auth.UserContext, code string) (int, error) {
	if user == nil || user.Subject == "" || user.TenantID == "" {
		return 0, &GitHubClaimError{Code: "UNAUTHORIZED", Err: errors.New("no caller identity")}
	}
	payload, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return 0, &GitHubClaimError{Code: githubErrorInternal, Err: errors.New("encode claim request")}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.engineURL+engineClaimPath, bytes.NewReader(payload))
	if err != nil {
		return 0, &GitHubClaimError{Code: githubErrorInternal, Err: errors.New("build claim request")}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Auth", c.serviceSecret)
	auth.SetEngineIdentity(req.Header, user)
	if c.signer != nil {
		if sErr := c.signer.Attach(req); sErr != nil {
			return 0, &GitHubClaimError{Code: githubErrorInternal, Err: fmt.Errorf("sign claim request: %w", sErr)}
		}
	}

	// #nosec G704 -- the host is the operator-configured engine URL and the path is a constant.
	resp, err := c.client.Do(req)
	if err != nil {
		// The transport error names the engine URL, never the request body.
		return 0, &GitHubClaimError{Code: githubErrorServiceUnavailable, Err: err}
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxClaimResponseBytes))
	if err != nil {
		return 0, &GitHubClaimError{Code: githubErrorServiceUnavailable, Err: errors.New("read claim response")}
	}

	if resp.StatusCode != http.StatusOK {
		var failure struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(body, &failure) != nil || failure.Code == "" {
			failure.Code = githubErrorInternal
		}
		return 0, &GitHubClaimError{Code: failure.Code, Err: fmt.Errorf("engine answered %d", resp.StatusCode)}
	}

	var claimed struct {
		Installations []json.RawMessage `json:"installations"`
	}
	if err := json.Unmarshal(body, &claimed); err != nil {
		return 0, &GitHubClaimError{Code: githubErrorInternal, Err: errors.New("decode claim response")}
	}
	return len(claimed.Installations), nil
}
