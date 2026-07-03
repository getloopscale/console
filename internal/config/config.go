// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package config loads and validates the cloud control-plane configuration
// from the environment, enforcing production-safety invariants at startup.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
)

// Secret is a string that redacts itself in logs, fmt output, and JSON serialization.
type Secret string

func (s Secret) String() string               { return "***" }
func (s Secret) GoString() string             { return "***" }
func (s Secret) MarshalJSON() ([]byte, error) { return []byte(`"***"`), nil }
func (s Secret) MarshalText() ([]byte, error) { return []byte("***"), nil }
func (s Secret) Value() string                { return string(s) }

// Config holds all configuration for the cloud auth service.
// All fields are loaded from environment variables.
type Config struct {
	// ListenAddr is the address the cloud service listens on.
	// Env: CLOUD_LISTEN_ADDR (default: ":13002")
	ListenAddr string

	// KratosPublicURL is the browser-facing Kratos URL (used for redirects).
	// Env: KRATOS_PUBLIC_URL
	KratosPublicURL string

	// KratosInternalURL is the cluster-internal Kratos public URL (server-to-server).
	// Used for session validation (whoami) without going through external TLS/proxy.
	// Env: KRATOS_INTERNAL_URL (default: same as KRATOS_PUBLIC_URL)
	KratosInternalURL string

	// KratosAdminURL is the Ory Kratos admin API URL (identity management).
	// Env: KRATOS_ADMIN_URL (default: "http://ory-kratos-admin.theo-system:80")
	KratosAdminURL string

	// HydraPublicURL is the Ory Hydra public API URL (OAuth2 endpoints).
	// Env: HYDRA_PUBLIC_URL (default: "http://ory-hydra-public.theo-system:4444")
	HydraPublicURL string

	// HydraAdminURL is the Ory Hydra admin API URL (client management, consent).
	// Env: HYDRA_ADMIN_URL (default: "http://ory-hydra-admin.theo-system:4445")
	HydraAdminURL string

	// HydraClientID is the OAuth2 client ID for the CLI (public client).
	// Env: HYDRA_CLIENT_ID (default: "theo-cli")
	HydraClientID string

	// EngineAPIURL is the internal URL of the Theo engine API (for proxy).
	// Env: ENGINE_API_URL (default: "http://theo-api.theo-system:8080")
	EngineAPIURL string

	// JWTIssuer is the expected issuer in JWT tokens (must match Hydra config).
	// Env: JWT_ISSUER (default: HydraPublicURL + "/")
	JWTIssuer string

	// Environment is the deployment environment (dev, staging, prod).
	// Env: THEO_ENV (default: "dev")
	Environment string

	// StripeAPIKey is the Stripe secret key for API calls.
	// Env: STRIPE_API_KEY (required in production)
	StripeAPIKey Secret

	// StripeWebhookSecret is the webhook signing secret for verifying Stripe events.
	// Env: STRIPE_WEBHOOK_SECRET (required in production)
	StripeWebhookSecret Secret

	// BillingReturnURL is the URL users return to after Stripe portal/checkout.
	// Env: BILLING_RETURN_URL (default: "http://localhost:3000")
	BillingReturnURL string

	// DatabaseURL is the PostgreSQL connection string.
	// Shared with the engine API (same DB, cloud service does NOT run migrations).
	// Env: DATABASE_URL (required in production, optional in dev for graceful degradation)
	DatabaseURL string

	// SessionTokenSecret is the HMAC key for signing dashboard session tokens.
	// Used by /v1/auth/session/token to issue JWTs for dashboard users.
	// Env: SESSION_TOKEN_SECRET (required in production, auto-generated in dev)
	SessionTokenSecret Secret

	// ServiceAuthSecret is the shared secret for cloud→engine service-to-service calls.
	// Used by the /engine/* proxy to authenticate with the engine API.
	// Env: THEO_SERVICE_AUTH_SECRET (must match the engine's value)
	ServiceAuthSecret Secret

	// ThemoryBaseURL is the OSS TheMemory REST URL (Plan 1 of dashboard-memory-section).
	// Env: THEMORY_BASE_URL (default: "http://themory:3000" — operator overrides in prod)
	ThemoryBaseURL string

	// ThemoryAPIKey is the LEGACY master Bearer. Model B (credential-broker)
	// demotes it OFF the data path; it remains a transition fallback for the
	// control-plane (admin/probe) client when ThemoryPlatformAdminKey is unset.
	// Env: THEMORY_API_KEY
	ThemoryAPIKey Secret

	// ThemoryPlatformAdminKey is the CONTROL-PLANE credential (carrying
	// memory:platform-admin) the gateway uses ONLY to mint/rotate/revoke
	// per-tenant data keys via TheMemory's admin API. NEVER on the data path
	// (Model B ADR D1). When unset, falls back to ThemoryAPIKey during transition.
	// Env: THEMORY_PLATFORM_ADMIN_KEY
	ThemoryPlatformAdminKey Secret

	// ThemorySkipCapabilityCheck disables the boot-time provider-capability guard
	// (themory-gateway-provider-capability-guard F1). Default false (safe prod
	// posture). Escape hatch for emergencies (e.g. provider openapi shape change).
	// Env: THEMORY_SKIP_CAPABILITY_CHECK ("true" to skip).
	ThemorySkipCapabilityCheck bool

	// PromptlyBaseURL is the theo-promptly REST URL (M11 — Model B L2). Native
	// path, NO /v1 prefix: the broker POSTs to {base}/admin/keys directly at the
	// host-run service (e.g. http://host.docker.internal:18083), never via the
	// edge. Empty disables the promptly broker + its ForwardAuth handler.
	// Env: PROMPTLY_BASE_URL
	PromptlyBaseURL string

	// PromptlyPlatformAdminKey is the CONTROL-PLANE credential (carrying
	// prompt:platform-admin) the gateway uses ONLY to mint per-tenant theo-promptly
	// keys via POST /admin/keys. NEVER on the data path (Model B). Required when
	// PromptlyBaseURL is set.
	// Env: PROMPTLY_PLATFORM_ADMIN_KEY
	PromptlyPlatformAdminKey Secret

	// RagBaseURL is the theo-rag REST URL (M14 — Model B). The broker POSTs to
	// {base}/v1/admin/keys (theo-rag's mint endpoint carries the /v1 prefix). Empty
	// disables the rag broker + its ForwardAuth handler.
	// Env: RAG_BASE_URL
	RagBaseURL string

	// RagPlatformAdminKey is the CONTROL-PLANE credential (carrying
	// rag:platform-admin) the gateway uses ONLY to mint per-tenant theo-rag keys
	// via POST /v1/admin/keys. NEVER on the data path (Model B). Required when
	// RagBaseURL is set.
	// Env: RAG_PLATFORM_ADMIN_KEY
	RagPlatformAdminKey Secret

	// LensBaseURL is the theo-lens REST URL (M38 — Model B). The broker POSTs to
	// {base}/v1/admin/keys (theo-lens's mint endpoint carries the /v1 prefix). Empty
	// disables the lens broker + its ForwardAuth handler.
	// Env: LENS_BASE_URL
	LensBaseURL string

	// LensPlatformAdminKey is the CONTROL-PLANE credential (carrying
	// lens:platform-admin) the gateway uses ONLY to mint per-tenant theo-lens keys
	// via POST /v1/admin/keys. NEVER on the data path (Model B). Required when
	// LensBaseURL is set.
	// Env: LENS_PLATFORM_ADMIN_KEY
	LensPlatformAdminKey Secret

	// SessionTokenSecretPrevious is the previous HMAC key for zero-downtime rotation (§2.2).
	// Tokens signed with this key are accepted during the rotation window.
	// Env: SESSION_TOKEN_SECRET_PREVIOUS (optional)
	SessionTokenSecretPrevious Secret

	// GitHubAppSlug is the slug of the Theo GitHub App (e.g. "theo-platform").
	// Used to construct the install URL https://github.com/apps/{slug}/installations/new.
	// Env: GITHUB_APP_SLUG (default: "theo-platform")
	GitHubAppSlug string

	// AppPublicURL is the user-facing dashboard origin
	// (e.g. https://app-dev.usetheo.dev). The GitHub App callback redirects
	// the browser back to this origin + the return_to path.
	// Env: APP_PUBLIC_URL (default: BillingReturnURL)
	AppPublicURL string

	// AuthCookieDomain is the explicit Domain= attribute for browser
	// state cookies. Setting it host-only (Domain unset) is the safest
	// default — see EC-2 of plan J-09 (subdomain cookie leak defense).
	// In dev-public the dashboard and cloud share usetheo.dev so the
	// operator must set this to "usetheo.dev"; locally we leave it
	// empty so the cookie is host-only on localhost.
	// Env: AUTH_COOKIE_DOMAIN (default: "")
	AuthCookieDomain string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() Config {
	cfg := Config{
		ListenAddr:        envOr("CLOUD_LISTEN_ADDR", ":13002"),
		KratosPublicURL:   envOr("KRATOS_PUBLIC_URL", "http://ory-kratos-public.theo-system:80"),
		KratosInternalURL: envOr("KRATOS_INTERNAL_URL", envOr("KRATOS_PUBLIC_URL", "http://ory-kratos-public.theo-system:80")),
		KratosAdminURL:    envOr("KRATOS_ADMIN_URL", "http://ory-kratos-admin.theo-system:80"),
		HydraPublicURL:    envOr("HYDRA_PUBLIC_URL", "http://ory-hydra-public.theo-system:4444"),
		HydraAdminURL:     envOr("HYDRA_ADMIN_URL", "http://ory-hydra-admin.theo-system:4445"),
		HydraClientID:     envOr("HYDRA_CLIENT_ID", "theo-cli"),
		EngineAPIURL:      envOr("ENGINE_API_URL", "http://theo-api.theo-system:8080"),
		Environment:       envOr("THEO_ENV", "dev"),
	}
	cfg.JWTIssuer = envOr("JWT_ISSUER", cfg.HydraPublicURL+"/")
	cfg.StripeAPIKey = Secret(envOr("STRIPE_API_KEY", ""))
	cfg.StripeWebhookSecret = Secret(envOr("STRIPE_WEBHOOK_SECRET", ""))
	cfg.BillingReturnURL = envOr("BILLING_RETURN_URL", "http://localhost:3000")
	cfg.DatabaseURL = envOr("DATABASE_URL", "")
	// Secrets are auto-generated only in non-production. In production they MUST
	// be set explicitly — a per-pod random secret breaks multi-replica auth
	// non-deterministically (different replicas reject each other's tokens).
	cfg.SessionTokenSecret = Secret(envOr("SESSION_TOKEN_SECRET", devSecretFor(cfg.Environment)))
	cfg.SessionTokenSecretPrevious = Secret(envOr("SESSION_TOKEN_SECRET_PREVIOUS", ""))
	cfg.ServiceAuthSecret = Secret(envOr("THEO_SERVICE_AUTH_SECRET", devSecretFor(cfg.Environment)))
	// J-09 T1.1 — GitHub App install handshake.
	cfg.GitHubAppSlug = envOr("GITHUB_APP_SLUG", "theo-platform")
	cfg.AppPublicURL = envOr("APP_PUBLIC_URL", cfg.BillingReturnURL)
	cfg.AuthCookieDomain = envOr("AUTH_COOKIE_DOMAIN", "")

	cfg.ThemoryBaseURL = envOr("THEMORY_BASE_URL", "")
	cfg.ThemoryAPIKey = Secret(envOr("THEMORY_API_KEY", ""))
	cfg.ThemoryPlatformAdminKey = Secret(envOr("THEMORY_PLATFORM_ADMIN_KEY", ""))
	cfg.ThemorySkipCapabilityCheck = envOr("THEMORY_SKIP_CAPABILITY_CHECK", "") == "true"
	cfg.PromptlyBaseURL = envOr("PROMPTLY_BASE_URL", "")
	cfg.PromptlyPlatformAdminKey = Secret(envOr("PROMPTLY_PLATFORM_ADMIN_KEY", ""))
	cfg.RagBaseURL = envOr("RAG_BASE_URL", "")
	cfg.RagPlatformAdminKey = Secret(envOr("RAG_PLATFORM_ADMIN_KEY", ""))
	cfg.LensBaseURL = envOr("LENS_BASE_URL", "")
	cfg.LensPlatformAdminKey = Secret(envOr("LENS_PLATFORM_ADMIN_KEY", ""))
	return cfg
}

// Validate checks that required fields are set for production.
func (c Config) Validate() error {
	if c.Environment == "prod" {
		if c.HydraPublicURL == "" {
			return fmt.Errorf("HYDRA_PUBLIC_URL is required in production")
		}
		if c.KratosPublicURL == "" {
			return fmt.Errorf("KRATOS_PUBLIC_URL is required in production")
		}
		if c.DatabaseURL == "" {
			return fmt.Errorf("DATABASE_URL is required in production")
		}
		if c.StripeAPIKey.Value() == "" {
			return fmt.Errorf("STRIPE_API_KEY is required in production")
		}
		if c.StripeWebhookSecret.Value() == "" {
			return fmt.Errorf("STRIPE_WEBHOOK_SECRET is required in production")
		}
		if len(c.SessionTokenSecret.Value()) < 32 {
			return fmt.Errorf("SESSION_TOKEN_SECRET must be at least 32 characters in production")
		}
		if len(c.ServiceAuthSecret.Value()) < 32 {
			return fmt.Errorf("THEO_SERVICE_AUTH_SECRET must be set (>=32 chars) in production — a per-pod random secret breaks multi-replica auth")
		}
		if c.KratosAdminURL == "" {
			return fmt.Errorf("KRATOS_ADMIN_URL is required in production")
		}
		if c.HydraAdminURL == "" {
			return fmt.Errorf("HYDRA_ADMIN_URL is required in production")
		}
		// install-config-contract Slice 1 T4.1: when the memory proxy is enabled
		// (ThemoryBaseURL set), its master bearer MUST be present — otherwise the
		// proxy would call theo-data unauthenticated. Documented as required on the
		// ThemoryAPIKey field; now enforced fail-fast at boot.
		if c.ThemoryBaseURL != "" && c.ThemoryAPIKey.Value() == "" {
			return fmt.Errorf("THEMORY_API_KEY is required in production when THEMORY_BASE_URL is set")
		}
		// M11 (theo-promptly Model B L2): the platform-admin key MUST be present
		// when the promptly broker is enabled — otherwise the gateway would try
		// to mint per-tenant keys unauthenticated. Fail-fast at boot.
		if c.PromptlyBaseURL != "" && c.PromptlyPlatformAdminKey.Value() == "" {
			return fmt.Errorf("PROMPTLY_PLATFORM_ADMIN_KEY is required in production when PROMPTLY_BASE_URL is set")
		}
		// M14 (theo-rag Model B): the platform-admin key MUST be present when the
		// rag broker is enabled — otherwise the gateway would try to mint per-tenant
		// keys unauthenticated. Fail-fast at boot.
		if c.RagBaseURL != "" && c.RagPlatformAdminKey.Value() == "" {
			return fmt.Errorf("RAG_PLATFORM_ADMIN_KEY is required in production when RAG_BASE_URL is set")
		}
		// M38 (theo-lens Model B): the platform-admin key MUST be present when the
		// lens broker is enabled — otherwise the gateway would try to mint per-tenant
		// keys unauthenticated. Fail-fast at boot.
		if c.LensBaseURL != "" && c.LensPlatformAdminKey.Value() == "" {
			return fmt.Errorf("LENS_PLATFORM_ADMIN_KEY is required in production when LENS_BASE_URL is set")
		}
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// devSecretFor returns an auto-generated secret in non-production environments,
// and an empty string in production (forcing Validate() to require an explicit
// secret). This prevents per-pod random secrets in multi-replica production.
func devSecretFor(environment string) string {
	if environment == "prod" {
		return ""
	}
	return generateDevSecret()
}

// generateDevSecret creates a random secret for development.
// Each startup gets a different secret — sessions don't survive restarts (fine for dev).
func generateDevSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "dev-fallback-insecure-" + fmt.Sprintf("%d", os.Getpid())
	}
	return hex.EncodeToString(b)
}
