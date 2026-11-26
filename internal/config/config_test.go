// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Per plan dashboard-memory-bff-server-side-key-vault v1.2 § T3.1.
// Plus F-rev-5 fix-cycle absorption (2026-06-08): 4 promised but absent tests.

package config

import (
	"strings"
	"testing"
)

func TestConfig_ParsesThemorySkipCapabilityCheck(t *testing.T) {
	t.Setenv("LOOPMEM_SKIP_CAPABILITY_CHECK", "true")
	if cfg := Load(); !cfg.ThemorySkipCapabilityCheck {
		t.Fatal("expected ThemorySkipCapabilityCheck=true when env is \"true\"")
	}
	// Any non-"true" value (incl. unset) must default to the safe false posture.
	t.Setenv("LOOPMEM_SKIP_CAPABILITY_CHECK", "1")
	if cfg := Load(); cfg.ThemorySkipCapabilityCheck {
		t.Fatal("expected ThemorySkipCapabilityCheck=false for non-\"true\" value")
	}
}

// =========================================================================
// Validate() fail-fast coverage — install-config-contract Slice 1 T4.1.
// Gap: config.go documents LOOPMEM_API_KEY as "required when ThemoryBaseURL is
// set in prod" but Validate() did not enforce it — the proxy would call loopscale-data
// unauthenticated. These tests lock the fail-fast.
// =========================================================================

func prodValidBaseline() Config {
	return Config{
		Environment:         "prod",
		HydraPublicURL:      "https://hydra.example",
		HydraAdminURL:       "http://ory-hydra-admin:4445",
		KratosPublicURL:     "https://kratos.example",
		KratosAdminURL:      "http://ory-kratos-admin:80",
		DatabaseURL:         "postgres://u:p@db:5432/loopscale",
		StripeAPIKey:        Secret("sk_live_x"),
		StripeWebhookSecret: Secret("whsec_x"),
		// #331: a fixture antiga era "0123456789..." — 10 caracteres distintos, o tipo de valor
		// que o novo checkSigningSecret recusa com razao. Trocada por algo com a forma de um
		// segredo de verdade; nenhum teste depende do valor.
		SessionTokenSecret: Secret("9f3ac81e5b70d24c6ae1f085b3d7920ce46815af"),
		ServiceAuthSecret:  Secret("0123456789012345678901234567890123"),
	}
}

func TestValidate_prod_requires_loopmem_api_key_when_loopmem_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.ThemoryBaseURL = "http://loopmem:3000"
	c.ThemoryAPIKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when LOOPMEM_BASE_URL is set but LOOPMEM_API_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_loopmem_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.ThemoryBaseURL = "http://loopmem:3000"
	c.ThemoryAPIKey = Secret("master-bearer")
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when loopmem fully configured; got %v", err)
	}
}

func TestValidate_prod_passes_when_loopmem_disabled(t *testing.T) {
	c := prodValidBaseline() // ThemoryBaseURL empty → loopmem check must not fire
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when loopmem disabled; got %v", err)
	}
}

// M11 (loopprompt L2 broker): mirror the loopmem base-url ⇒ key invariant.
func TestValidate_prod_requires_promptly_key_when_promptly_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.PromptlyBaseURL = "http://host.docker.internal:18083"
	c.PromptlyPlatformAdminKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when PROMPTLY_BASE_URL is set but PROMPTLY_PLATFORM_ADMIN_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_promptly_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.PromptlyBaseURL = "http://host.docker.internal:18083"
	c.PromptlyPlatformAdminKey = Secret("promptly_live_platform_admin")
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when promptly fully configured; got %v", err)
	}
}

func TestValidate_prod_requires_trust_key_when_trust_base_url_set(t *testing.T) {
	// M10: the trust broker cannot mint per-tenant keys without the platform-admin
	// credential — fail-fast at boot rather than mint unauthenticated.
	c := prodValidBaseline()
	c.TrustBaseURL = "http://host.docker.internal:18085"
	c.TrustPlatformAdminKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when TRUST_BASE_URL is set but TRUST_PLATFORM_ADMIN_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_trust_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.TrustBaseURL = "http://host.docker.internal:18085"
	c.TrustPlatformAdminKey = Secret("trust_live_platform_admin")
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when trust fully configured; got %v", err)
	}
}

func TestValidate_prod_passes_when_promptly_disabled(t *testing.T) {
	c := prodValidBaseline() // PromptlyBaseURL empty → promptly check must not fire
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when promptly disabled; got %v", err)
	}
}

// M14 edge-rag-broker — RAG_PLATFORM_ADMIN_KEY required in prod when RAG_BASE_URL set.
func TestValidate_prod_requires_rag_admin_key_when_rag_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.RagBaseURL = "http://looprag:8787"
	c.RagPlatformAdminKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when RAG_BASE_URL is set but RAG_PLATFORM_ADMIN_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_rag_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.RagBaseURL = "http://looprag:8787"
	c.RagPlatformAdminKey = Secret("rag_live_platform_admin")
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when rag fully configured; got %v", err)
	}
}

func TestValidate_prod_passes_when_rag_disabled(t *testing.T) {
	c := prodValidBaseline() // RagBaseURL empty → rag check must not fire
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when rag disabled; got %v", err)
	}
}

// M14 — Load() reads RAG_BASE_URL / RAG_PLATFORM_ADMIN_KEY into the fields
// (guards against an envOr key typo that struct-only Validate tests would miss).
func TestLoad_RagFields(t *testing.T) {
	t.Setenv("RAG_BASE_URL", "http://looprag:8787")
	t.Setenv("RAG_PLATFORM_ADMIN_KEY", "rag_live_platform_env")
	c := Load()
	if c.RagBaseURL != "http://looprag:8787" {
		t.Errorf("RagBaseURL = %q, want http://looprag:8787 (RAG_BASE_URL not read)", c.RagBaseURL)
	}
	if c.RagPlatformAdminKey.Value() != "rag_live_platform_env" {
		t.Errorf("RagPlatformAdminKey = %q, want rag_live_platform_env (RAG_PLATFORM_ADMIN_KEY not read)", c.RagPlatformAdminKey.Value())
	}
}

// M38 edge-lens-broker — LENS_PLATFORM_ADMIN_KEY required in prod when LENS_BASE_URL set.
func TestValidate_prod_requires_lens_admin_key_when_lens_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.LensBaseURL = "http://looptrace:18082"
	c.LensPlatformAdminKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when LENS_BASE_URL is set but LENS_PLATFORM_ADMIN_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_lens_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.LensBaseURL = "http://looptrace:18082"
	c.LensPlatformAdminKey = Secret("theo_live_platform_admin")
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when lens fully configured; got %v", err)
	}
}

func TestValidate_prod_passes_when_lens_disabled(t *testing.T) {
	c := prodValidBaseline() // LensBaseURL empty → lens check must not fire
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when lens disabled; got %v", err)
	}
}

// M38 — Load() reads LENS_BASE_URL / LENS_PLATFORM_ADMIN_KEY into the fields
// (guards against an envOr key typo that struct-only Validate tests would miss).
func TestLoad_LensFields(t *testing.T) {
	t.Setenv("LENS_BASE_URL", "http://looptrace:18082")
	t.Setenv("LENS_PLATFORM_ADMIN_KEY", "theo_live_platform_env")
	c := Load()
	if c.LensBaseURL != "http://looptrace:18082" {
		t.Errorf("LensBaseURL = %q, want http://looptrace:18082 (LENS_BASE_URL not read)", c.LensBaseURL)
	}
	if c.LensPlatformAdminKey.Value() != "theo_live_platform_env" {
		t.Errorf("LensPlatformAdminKey = %q, want theo_live_platform_env (LENS_PLATFORM_ADMIN_KEY not read)", c.LensPlatformAdminKey.Value())
	}
}

// TestValidateStorage_AllOrNone — M7: a partial storage config must fail fast.
func TestValidateStorage_AllOrNone(t *testing.T) {
	// #331: o assunto deste teste e a config de storage, nao o segredo de sessao — mas
	// `Validate()` agora recusa segredo previsivel em qualquer ambiente, entao a baseline
	// precisa de um valido para medir o que ela se propoe a medir.
	base := Config{
		Environment:        "dev",
		SessionTokenSecret: Secret("9f3ac81e5b70d24c6ae1f085b3d7920ce46815af"),
	}

	// none set → valid (vertical disabled)
	if err := base.Validate(); err != nil {
		t.Fatalf("empty storage config should be valid: %v", err)
	}

	// only endpoint set → partial → error naming the missing vars
	partial := base
	partial.StorageS3Endpoint = "http://minio:9000"
	if err := partial.validateStorage(); err == nil {
		t.Error("partial storage config must be rejected")
	}

	// all set with a >=32 char share secret → valid
	full := base
	full.StorageS3Endpoint = "http://minio:9000"
	full.StorageS3Bucket = "loopstore"
	full.StorageS3Region = "us-east-1"
	full.StorageS3AccessKey = Secret("AK")
	full.StorageS3SecretKey = Secret("SK")
	full.StorageShareSecret = Secret("this-is-a-32-char-minimum-secret!")
	if err := full.validateStorage(); err != nil {
		t.Errorf("complete storage config should be valid: %v", err)
	}

	// short share secret → error
	shortSecret := full
	shortSecret.StorageShareSecret = Secret("too-short")
	if err := shortSecret.validateStorage(); err == nil {
		t.Error("share secret < 32 chars must be rejected")
	}
}

// =========================================================================
// #331 — o segredo que assina a sessao do dashboard nao pode ser um placeholder,
// em NENHUM ambiente.
//
// A cadeia foi verificada no codigo, nao suposta:
//
//   cmd/main.go:389  sessIssuer := loopscalejwt.NewSessionTokenIssuer(cfg.SessionTokenSecret...)
//   cmd/main.go:415  requireJWT := auth.RequireJWT(jwtValidator, sessIssuer)   <- MESMO emissor valida
//   cmd/main.go:1115 r.Route("/v1/api-keys", ...) { r.Use(requireJWT)
//   cmd/main.go:1122   r.Post("/", apiKeysHandler.CreateKey)                   <- CUNHA credencial real
//
// Logo: quem conhece a chave HMAC forja um token de sessao, atravessa o requireJWT e emite uma
// chave de API real do tenant. A borda nao barra — o ForwardAuth dela resolve chave de API
// (APIKeyResolver), nao token de sessao; sao caminhos distintos.
//
// O buraco era de ESCOPO, nao de ausencia: `Validate()` so checava comprimento em `prod`, entao
// um placeholder setado explicitamente num ambiente de dev exposto na internet passava livre.
// =========================================================================

// devBaseline — um ambiente NAO-prod, que e exatamente onde o buraco estava.
func devBaseline() Config {
	return Config{
		Environment:        "dev",
		SessionTokenSecret: Secret("f2c1a9e70b4d63815a7e0c2fd94b6a3e18d5027cbf6491ae"),
		ServiceAuthSecret:  Secret("0123456789012345678901234567890123"),
	}
}

// O POSITIVO. Sem ele, uma implementacao que recusa TUDO passaria na metade "recusa" e
// derrubaria o ambiente inteiro — que e precisamente o risco desta correcao.
func TestValidate_dev_accepts_a_strong_session_secret(t *testing.T) {
	if err := devBaseline().Validate(); err != nil {
		t.Fatalf("um segredo forte tem de SUBIR em dev; Validate() recusou: %v", err)
	}
}

func TestValidate_prod_accepts_a_strong_session_secret(t *testing.T) {
	if err := prodValidBaseline().Validate(); err != nil {
		t.Fatalf("um segredo forte tem de SUBIR em prod; Validate() recusou: %v", err)
	}
}

// O NEGATIVO, com o valor que app-dev de fato roda (a FORMA dele — nao o valor do host).
func TestValidate_refuses_a_self_describing_placeholder_in_any_environment(t *testing.T) {
	placeholders := []string{
		"dev-session-secret-at-least-32-characters-long",
		"e2e-session-secret-at-least-32-characters-long",
		"changeme-changeme-changeme-changeme-changeme",
		"please-replace-this-example-secret-value-now",
		"dev-fallback-insecure-12345678901234567890123",
	}
	for _, env := range []string{"dev", "staging", "prod"} {
		for _, ph := range placeholders {
			// prod exige um punhado de URLs; sem elas Validate() falharia ANTES de olhar o
			// segredo, e o teste mediria a checagem errada.
			c := devBaseline()
			if env == "prod" {
				c = prodValidBaseline()
			}
			c.Environment = env
			c.SessionTokenSecret = Secret(ph)
			err := c.Validate()
			if err == nil {
				t.Errorf("env=%s: Validate() aceitou o placeholder %q. Quem conhece essa chave "+
					"forja token de sessao e emite chave de API real via POST /v1/api-keys", env, ph)
				continue
			}
			// A mensagem tem de dizer QUAL variavel e POR QUE — senao o operador nao sabe o que trocar.
			if !strings.Contains(err.Error(), "SESSION_TOKEN_SECRET") {
				t.Errorf("env=%s: a recusa nao nomeia a variavel: %v", env, err)
			}
		}
	}
}

// Entropia, nao so o dicionario de placeholders: uma string longa e repetitiva nao casa nenhuma
// palavra da lista e continua trivial de adivinhar.
func TestValidate_refuses_a_low_entropy_session_secret(t *testing.T) {
	c := devBaseline()
	c.SessionTokenSecret = Secret(strings.Repeat("ab", 24))
	if err := c.Validate(); err == nil {
		t.Error("Validate() aceitou um segredo de 48 chars com 2 caracteres distintos — " +
			"passar no comprimento nao e o mesmo que ser imprevisivel")
	}
}

// O comprimento minimo passa a valer FORA de prod tambem: era esse o escopo que faltava.
func TestValidate_enforces_minimum_length_outside_prod(t *testing.T) {
	c := devBaseline()
	c.SessionTokenSecret = Secret("f2c1a9e70b4d6381")
	if err := c.Validate(); err == nil {
		t.Error("Validate() aceitou um segredo de 16 chars em dev — o comprimento minimo era " +
			"checado so em prod, e app-dev esta na internet publica")
	}
}

// A guarda do #331 nao pode quebrar o caminho normal de dev: sem SESSION_TOKEN_SECRET no
// ambiente, `Load()` sorteia 32 bytes (hex = 64 chars, 16 distintos) e o boot TEM de seguir.
// Sem este teste a correcao derrubaria toda maquina de dev que nao define a variavel — que e o
// caso comum, e exatamente o modo de falha que o coordenador alertou para app-dev.
func TestLoad_dev_without_the_env_var_still_boots(t *testing.T) {
	t.Setenv("LOOP_RUNTIME_ENV", "dev")
	c := Load()
	if err := checkSigningSecret("SESSION_TOKEN_SECRET", c.SessionTokenSecret.Value()); err != nil {
		t.Fatalf("dev sem a variavel tem de subir; a guarda recusou o segredo sorteado: %v", err)
	}
}
