// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	theojwt "github.com/usetheoai/theo-contracts/jwt"
)

// UserContext holds authenticated user info, set by the auth middleware.
type UserContext struct {
	Subject   string
	Email     string
	Name      string
	TenantID  string
	AccountID string // M0: the Account ("Cliente Theo") owning this tenant; "" for legacy keys (NULL-tolerant)
	Role      string // owner, admin, member (§5.1)
}

type contextKey string

const userCtxKey contextKey = "user"

// GetUser extracts the authenticated user from the request context.
func GetUser(ctx context.Context) *UserContext {
	uc, ok := ctx.Value(userCtxKey).(*UserContext)
	if !ok {
		return nil
	}
	return uc
}

// WithUser returns a copy of ctx with the given UserContext attached, using the
// same key that RequireJWT + RequireScope populate. Tests in other packages
// (cloud/tests/unit/) use this to construct authenticated requests without
// reaching for the unexported userCtxKey. Plan 0 / T0.3-T0.6 test support.
func WithUser(ctx context.Context, u *UserContext) context.Context {
	return context.WithValue(ctx, userCtxKey, u)
}

// RequireJWT returns middleware that authenticates a Bearer token only — a
// Hydra RS256 JWT (CLI) or an HS256 session JWT. It is RequireCaller without a
// session authenticator, kept for callers that have no browser surface.
func RequireJWT(rsaValidator *theojwt.Validator, sessValidator *theojwt.SessionTokenIssuer) func(http.Handler) http.Handler {
	return RequireCaller(rsaValidator, sessValidator, nil)
}

// RequireCaller returns middleware that authenticates the caller of a request
// by exactly one of two credentials:
//
//   - `Authorization: Bearer <jwt>` — the CLI (Hydra RS256) and, until
//     usetheoai/theo#477 step 4 deletes it, the HS256 session JWT that
//     `/v1/auth/session/token` still issues to the scripts that call it.
//   - the Kratos session cookie — the dashboard. theo-cloud is its Backend for
//     Frontend (usetheoai/theo#477 step 3): the browser holds no token, and the
//     cookie is checked server-side on every request.
//
// A credential in the query string is NOT one of them. The `?token=` fallback
// existed because the native EventSource cannot set headers; the dashboard
// stream is now cookie-authenticated, and a token in a URL reaches access logs,
// proxy logs, browser history and the Referer header.
//
// Cross-site request forgery. A cookie travels with requests the dashboard did
// not make, so an unsafe method on the cookie path must come from this origin.
// The check is `http.CrossOriginProtection`: Fetch Metadata (`Sec-Fetch-Site`)
// with an `Origin`-vs-`Host` fallback for browsers that predate it. Chosen over
// a synchronizer token because it needs no state and no client cooperation, and
// over SameSite alone because the Kratos cookie is scoped to the parent domain,
// so SameSite=Lax still lets a sibling subdomain send it. A Bearer request is
// not checked: a browser never attaches that header on its own.
//
// The tenant always comes from the credential — never from a header, a query
// parameter, or a body the request carries.
func RequireCaller(rsaValidator *theojwt.Validator, sessValidator *theojwt.SessionTokenIssuer, sessions SessionAuthenticator) func(http.Handler) http.Handler {
	crossOrigin := http.NewCrossOriginProtection()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token := bearerToken(r); token != "" {
				authenticateBearer(w, r, next, token, rsaValidator, sessValidator)
				return
			}
			if sessions == nil || len(r.Cookies()) == 0 {
				slog.Warn("auth: rejected — no credential", "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, "Not authenticated. Run: loopscale login")
				return
			}
			if err := crossOrigin.Check(r); err != nil {
				slog.Warn("auth: rejected — cross-origin request with a session cookie",
					"method", r.Method, "path", r.URL.Path, "sec_fetch_site", r.Header.Get("Sec-Fetch-Site"))
				writeJSONError(w, http.StatusForbidden, "CROSS_ORIGIN_REJECTED",
					"This request did not come from the Theo dashboard.")
				return
			}
			user, err := sessions.Authenticate(r)
			switch {
			case err == nil:
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, user)))
			case errors.Is(err, ErrNoSession):
				writeAuthError(w, "Session expired. Please sign in again.")
			case errors.Is(err, ErrIdentityProviderUnavailable):
				slog.Warn("auth: session could not be checked", "path", r.URL.Path, "error", err)
				writeJSONError(w, http.StatusBadGateway, "AUTH_SERVICE_UNAVAILABLE",
					"Authentication service unavailable. Try again.")
			default:
				slog.Error("auth: session tenant could not be resolved", "path", r.URL.Path, "error", err)
				writeJSONError(w, http.StatusInternalServerError, "TENANT_ERROR",
					"Failed to set up your account. Try again or contact support.")
			}
		})
	}
}

func authenticateBearer(w http.ResponseWriter, r *http.Request, next http.Handler, token string, rsaValidator *theojwt.Validator, sessValidator *theojwt.SessionTokenIssuer) {
	// Try RSA JWT (Hydra — CLI)
	if rsaValidator != nil {
		claims, err := rsaValidator.Validate(token)
		if err == nil {
			email := claims.Email
			if email == "" {
				email = claims.Ext.Email
			}
			name := claims.Name
			if name == "" {
				name = claims.Ext.Name
			}
			tenantID := claims.ResolvedTenantID()
			if tenantID == "" {
				// MEET-2026-04-07-039 B7: never fall back to "default" tenant.
				slog.Warn("auth: JWT has no tenant_id", "sub", claims.Subject, "path", r.URL.Path)
				writeAuthError(w, "Account setup required. Please try logging in again.")
				return
			}
			ctx := context.WithValue(r.Context(), userCtxKey, &UserContext{
				Subject:  claims.Subject,
				Email:    email,
				Name:     name,
				TenantID: tenantID,
				// usetheoai/theo#477: without this, every consumer gating on
				// AccountID (the M1 cross-account guard) skipped the check for
				// a Hydra caller. Top-level first, ext fallback; "" for a token
				// minted before the claim existed.
				AccountID: claims.ResolvedAccountID(),
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
	}

	// Try HMAC session JWT — issued by /v1/auth/session/token, removed in step 4.
	if sessValidator != nil {
		claims, err := sessValidator.ValidateSession(token)
		if err == nil {
			tenantID := claims.TenantID
			if tenantID == "" {
				// MEET-2026-04-07-039 B7: never fall back to "default" tenant.
				slog.Warn("auth: session JWT has no tenant_id", "sub", claims.Subject, "path", r.URL.Path)
				writeAuthError(w, "Account setup required. Please try logging in again.")
				return
			}
			ctx := context.WithValue(r.Context(), userCtxKey, &UserContext{
				Subject:  claims.Subject,
				Email:    claims.Email,
				Name:     claims.Name,
				TenantID: tenantID,
				// M3: surface account_id from the session JWT (additive).
				// Legacy tokens without the claim yield "" — still authorized.
				AccountID: claims.AccountID,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
	}

	slog.Warn("auth: all JWT validators failed", "path", r.URL.Path, "token_len", len(token))
	writeAuthError(w, "Invalid or expired token. Run: loopscale login")
}

// bearerToken returns the JWT in `Authorization: Bearer`, or "" when absent.
func bearerToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return auth[7:]
	}
	return ""
}

// writeAuthError writes a JSON error response with request_id for tracing (§4.3).
func writeAuthError(w http.ResponseWriter, message string) {
	writeJSONError(w, http.StatusUnauthorized, "AUTH_REQUIRED", message)
}

// writeJSONError writes the service's error shape with the request_id (§4.3).
func writeJSONError(w http.ResponseWriter, status int, code, message string) {
	requestID := w.Header().Get("X-Request-Id")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := map[string]string{
		"code":    code,
		"message": message,
	}
	if requestID != "" {
		resp["request_id"] = requestID
	}
	_ = json.NewEncoder(w).Encode(resp)
}
