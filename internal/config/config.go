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
	"strings"
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

	// TrustBaseURL is the theo-trust REST URL (M10 — Model B L2). Keeps the /v1
	// prefix (memory/rag style): the broker POSTs to {base}/v1/admin/keys directly
	// at the host-run service (e.g. http://host.docker.internal:18085), never via
	// the edge. Empty disables the trust broker + its ForwardAuth handler.
	// Env: TRUST_BASE_URL
	TrustBaseURL string

	// TrustPlatformAdminKey is the CONTROL-PLANE credential (carrying
	// trust:platform-admin) the gateway uses ONLY to mint per-tenant theo-trust
	// keys via POST /v1/admin/keys. NEVER on the data path (Model B). Required when
	// TrustBaseURL is set.
	// Env: TRUST_PLATFORM_ADMIN_KEY
	TrustPlatformAdminKey Secret

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

	// StorageBaseURL is the theo-storage REST URL, probed by the M21 status panel.
	//
	// Diferente das irmãs, esta NÃO cunha credencial: o painel consome apenas
	// `GET /v1/version`, que é auth-exempt por contrato
	// (theo-workspace/docs/service-version-endpoint.md). Não há
	// `StoragePlatformAdminKey` correspondente, e por isso nenhuma regra em
	// Validate() a exige — acrescentar uma sem consumidor seria um gate que só pode
	// reprovar deploy legítimo.
	//
	// Vazia = serviço não configurado NESTE ambiente; o coletor o lista como
	// `not_deployed`, que é informação, não erro.
	// Env: STORAGE_BASE_URL
	StorageBaseURL string

	// SkillsBaseURL is the theo-skills REST URL, probed by the M21 status panel.
	//
	// Mesmo contrato do theo-storage acima: NÃO cunha credencial. O painel consome apenas
	// `GET /v1/version`, auth-exempt por contrato — um endpoint de versão atrás de
	// credencial faz "o serviço caiu" e "minha chave está errada" produzirem a mesma
	// resposta, e o agregador não consegue separar os dois.
	//
	// Vazia = serviço não configurado NESTE ambiente; o coletor o lista como
	// `not_deployed`, que é informação, não erro.
	// Env: SKILLS_BASE_URL
	SkillsBaseURL string

	// SkillsPlatformAdminKey is the CONTROL-PLANE credential the gateway uses ONLY
	// to mint per-tenant theo-skills keys via POST /v1/platform/keys. NEVER on the
	// data path (Model B). Required when SkillsBaseURL is set AND the broker is
	// enabled.
	//
	// theo-skills exposes a route SEPARATE from its human-facing admin one: that
	// route derives the workspace from the caller's principal and requires the
	// target to be a member of it, so a broker cannot use it to mint into an
	// arbitrary tenant.
	// Env: SKILLS_PLATFORM_ADMIN_KEY
	SkillsPlatformAdminKey Secret

	// TraefikMcpBaseURL is the theo-traefik-mcp gateway URL, probed by the status panel.
	//
	// Mesmo contrato dos dois acima: NÃO cunha credencial, e o painel consome apenas
	// `GET /v1/version` — auth-exempt por contrato do lado do gateway.
	//
	// A URL aponta para a RAIZ do gateway, não para a borda `/mcp` do Traefik. O
	// roteador do edge não remove o prefixo (é deliberado: o gateway precisa do path
	// completo para rotear MCP), então `{base}/v1/version` via `/mcp` chegaria como
	// `/mcp/v1/version` e cairia no catch-all do proxy — 404 sobre um serviço saudável.
	//
	// Vazia = serviço não configurado NESTE ambiente; o coletor o lista como
	// `not_deployed`, que é informação, não erro.
	// Env: TRAEFIK_MCP_BASE_URL
	TraefikMcpBaseURL string

	// LensPlatformAdminKey is the CONTROL-PLANE credential (carrying
	// observability:platform-admin) the gateway uses ONLY to mint per-tenant theo-lens keys
	// via POST /v1/admin/keys. NEVER on the data path (Model B). Required when
	// LensBaseURL is set.
	// Env: LENS_PLATFORM_ADMIN_KEY
	LensPlatformAdminKey Secret

	// Storage* configure the M7 tenant blob-storage vertical's S3-compatible
	// backend. All-or-none: setting any one requires all of Endpoint/Bucket/
	// Region/AccessKey/SecretKey/ShareSecret (Validate enforces). Empty disables
	// the storage vertical. Env: STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET,
	// STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY,
	// STORAGE_SHARE_SECRET.
	StorageS3Endpoint string
	// StorageS3PublicEndpoint (STORAGE_S3_PUBLIC_ENDPOINT) is the browser-reachable
	// S3 host used ONLY to mint presigned URLs; empty → same as StorageS3Endpoint.
	StorageS3PublicEndpoint string
	StorageS3Bucket         string
	StorageS3Region         string
	StorageS3AccessKey      Secret
	StorageS3SecretKey      Secret
	StorageShareSecret      Secret

	// StorageUpstreamURL, when set, switches the storage vertical to THIN-PROXY
	// mode: theo-cloud forwards /v1/storage/* to the standalone theo-storage
	// service (injecting the resolved tenant as X-Theo-Tenant) instead of running
	// the vertical in-process. When set, the S3 vars above are NOT required here
	// (theo-storage holds them). Env: STORAGE_UPSTREAM_URL.
	StorageUpstreamURL string

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

	// CloudPublicURL is the user-facing cloud/BFF origin (e.g.
	// https://cloud-dev.usetheo.dev) where browser-redirect endpoints served by
	// THIS process are mounted — the RAG OAuth broker callback in particular.
	// In split-subdomain deployments it differs from AppPublicURL (the SPA origin);
	// the OAuth redirect_uri MUST point at this origin so the callback lands here
	// and the CSRF/PKCE cookies (set on this origin) are delivered on the return.
	// Env: CLOUD_PUBLIC_URL (default: AppPublicURL — correct for single-origin dev).
	CloudPublicURL string

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
	cfg.CloudPublicURL = envOr("CLOUD_PUBLIC_URL", cfg.AppPublicURL)
	cfg.AuthCookieDomain = envOr("AUTH_COOKIE_DOMAIN", "")

	cfg.ThemoryBaseURL = envOr("THEMORY_BASE_URL", "")
	cfg.ThemoryAPIKey = Secret(envOr("THEMORY_API_KEY", ""))
	cfg.ThemoryPlatformAdminKey = Secret(envOr("THEMORY_PLATFORM_ADMIN_KEY", ""))
	cfg.ThemorySkipCapabilityCheck = envOr("THEMORY_SKIP_CAPABILITY_CHECK", "") == "true"
	cfg.PromptlyBaseURL = envOr("PROMPTLY_BASE_URL", "")
	cfg.PromptlyPlatformAdminKey = Secret(envOr("PROMPTLY_PLATFORM_ADMIN_KEY", ""))
	cfg.TrustBaseURL = envOr("TRUST_BASE_URL", "")
	cfg.TrustPlatformAdminKey = Secret(envOr("TRUST_PLATFORM_ADMIN_KEY", ""))
	cfg.RagBaseURL = envOr("RAG_BASE_URL", "")
	cfg.RagPlatformAdminKey = Secret(envOr("RAG_PLATFORM_ADMIN_KEY", ""))
	cfg.LensBaseURL = envOr("LENS_BASE_URL", "")
	cfg.StorageBaseURL = envOr("STORAGE_BASE_URL", "")
	cfg.SkillsBaseURL = envOr("SKILLS_BASE_URL", "")
	cfg.SkillsPlatformAdminKey = Secret(envOr("SKILLS_PLATFORM_ADMIN_KEY", ""))
	cfg.TraefikMcpBaseURL = envOr("TRAEFIK_MCP_BASE_URL", "")
	cfg.LensPlatformAdminKey = Secret(envOr("LENS_PLATFORM_ADMIN_KEY", ""))
	cfg.StorageS3Endpoint = envOr("STORAGE_S3_ENDPOINT", "")
	cfg.StorageS3PublicEndpoint = envOr("STORAGE_S3_PUBLIC_ENDPOINT", "")
	cfg.StorageS3Bucket = envOr("STORAGE_S3_BUCKET", "")
	cfg.StorageS3Region = envOr("STORAGE_S3_REGION", "")
	cfg.StorageS3AccessKey = Secret(envOr("STORAGE_S3_ACCESS_KEY", ""))
	cfg.StorageS3SecretKey = Secret(envOr("STORAGE_S3_SECRET_KEY", ""))
	cfg.StorageShareSecret = Secret(envOr("STORAGE_SHARE_SECRET", ""))
	cfg.StorageUpstreamURL = envOr("STORAGE_UPSTREAM_URL", "")
	return cfg
}

// StorageProxyMode reports whether the storage vertical runs as a thin proxy to
// the standalone theo-storage service (STORAGE_UPSTREAM_URL set). In this mode
// the S3 vars are NOT required here.
func (c Config) StorageProxyMode() bool { return c.StorageUpstreamURL != "" }

// StorageInProcess reports whether the in-process S3-backed vertical is
// configured (any S3 field set). Validate enforces all-or-none once any is set.
func (c Config) StorageInProcess() bool {
	return c.StorageS3Endpoint != "" || c.StorageS3Bucket != "" || c.StorageS3Region != "" ||
		c.StorageS3AccessKey.Value() != "" || c.StorageS3SecretKey.Value() != "" ||
		c.StorageShareSecret.Value() != ""
}

// StorageEnabled reports whether the storage vertical is active in either mode
// (proxy OR in-process).
func (c Config) StorageEnabled() bool { return c.StorageProxyMode() || c.StorageInProcess() }

// Validate checks that required fields are set for production.
func (c Config) Validate() error {
	// #331 — vale em TODO ambiente, e o escopo e o ponto.
	//
	// A checagem existia, mas so dentro do ramo `prod`. Um placeholder setado explicitamente num
	// ambiente de dev passava livre — e `app-dev` esta na internet publica. A cadeia (verificada,
	// nao suposta): este segredo assina o JWT de sessao (cmd/main.go:389), o MESMO emissor o valida
	// no requireJWT (:415), e o grupo /v1/api-keys usa esse middleware para CUNHAR credencial real
	// (:1115, :1122). Chave conhecida => token forjado => chave de API real do tenant. O ForwardAuth
	// da borda nao intercepta: ele resolve chave de API, nao token de sessao.
	//
	// Um default que "funciona" e o que faz o placeholder sobreviver ate producao — entao a recusa
	// e no boot, alto e claro, dizendo qual variavel e por que.
	if err := checkSigningSecret("SESSION_TOKEN_SECRET", c.SessionTokenSecret.Value()); err != nil {
		return err
	}

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
		// M10 (theo-trust Model B): the platform-admin key MUST be present when the
		// trust broker is enabled — otherwise the gateway would try to mint per-tenant
		// keys unauthenticated. Fail-fast at boot.
		if c.TrustBaseURL != "" && c.TrustPlatformAdminKey.Value() == "" {
			return fmt.Errorf("TRUST_PLATFORM_ADMIN_KEY is required in production when TRUST_BASE_URL is set")
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
	// M7 storage vertical: all-or-none across environments (a partial config would
	// leave the vertical half-wired — fail-fast at boot rather than 500 at runtime).
	if err := c.validateStorage(); err != nil {
		return err
	}
	return nil
}

// validateStorage enforces the all-or-none contract for the storage vertical:
// once any storage field is set, every field must be set.
func (c Config) validateStorage() error {
	// Proxy mode holds no S3 config here (theo-storage owns it) — the all-or-none
	// S3 check does not apply. Only the in-process mode validates the S3 vars.
	if c.StorageProxyMode() || !c.StorageInProcess() {
		return nil
	}
	missing := []string{}
	if c.StorageS3Endpoint == "" {
		missing = append(missing, "STORAGE_S3_ENDPOINT")
	}
	if c.StorageS3Bucket == "" {
		missing = append(missing, "STORAGE_S3_BUCKET")
	}
	if c.StorageS3Region == "" {
		missing = append(missing, "STORAGE_S3_REGION")
	}
	if c.StorageS3AccessKey.Value() == "" {
		missing = append(missing, "STORAGE_S3_ACCESS_KEY")
	}
	if c.StorageS3SecretKey.Value() == "" {
		missing = append(missing, "STORAGE_S3_SECRET_KEY")
	}
	if c.StorageShareSecret.Value() == "" {
		missing = append(missing, "STORAGE_SHARE_SECRET")
	}
	if len(missing) > 0 {
		return fmt.Errorf("storage vertical is partially configured — missing: %s (set all storage vars or none)", strings.Join(missing, ", "))
	}
	if len(c.StorageShareSecret.Value()) < 32 {
		return fmt.Errorf("STORAGE_SHARE_SECRET must be at least 32 characters (HMAC key for share tokens)")
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

// placeholderMarkers — fragmentos que denunciam um valor de exemplo. A lista e deliberadamente
// curta: ela existe para pegar o valor que ALGUEM ESCREVEU PARA SER TROCADO, nao para adivinhar
// fraqueza criptografica (disso cuida a entropia abaixo).
var placeholderMarkers = []string{
	"change", "changeme", "placeholder", "example", "sample", "dummy",
	"insecure", "replace", "todo", "xxxx", "your-", "secret-at-least",
	"at-least-32", "not-a-real", "fake",
}

// checkSigningSecret recusa um segredo de assinatura previsivel, em qualquer ambiente.
//
// Tres criterios, e cada um pega o que os outros deixam passar:
//   - COMPRIMENTO: forca bruta.
//   - MARCADOR: o valor anuncia que e de exemplo ("...-at-least-32-characters-long" tem 45 chars
//     e entropia razoavel — so o dicionario o pega).
//   - ENTROPIA: "ababab..." nao casa marcador algum e continua trivial de adivinhar.
//
// O caminho de dev sem a variavel setada NAO passa por aqui como risco: `devSecretFor` sorteia 32
// bytes aleatorios, que tem comprimento, nao casam marcador e tem caracteres distintos de sobra.
// O fallback `dev-fallback-insecure-<pid>` casa "insecure" DE PROPOSITO — se o sorteio falhou, o
// processo tem de parar, nao seguir com uma chave adivinhavel.
func checkSigningSecret(name, value string) error {
	const minLen = 32
	const minDistinct = 12

	if len(value) < minLen {
		return fmt.Errorf("%s must be at least %d characters (got %d) — it signs the dashboard "+
			"session JWT that authorizes API-key minting", name, minLen, len(value))
	}

	lower := strings.ToLower(value)
	for _, marker := range placeholderMarkers {
		if strings.Contains(lower, marker) {
			return fmt.Errorf("%s looks like a placeholder (contains %q) — generate a random "+
				"value per environment and inject it as a secret. A known signing key lets anyone "+
				"forge a session token and mint a real API key", name, marker)
		}
	}

	distinct := map[rune]struct{}{}
	for _, r := range value {
		distinct[r] = struct{}{}
	}
	if len(distinct) < minDistinct {
		return fmt.Errorf("%s has only %d distinct characters (need >= %d) — length is not "+
			"unpredictability; generate it randomly", name, len(distinct), minDistinct)
	}
	return nil
}
