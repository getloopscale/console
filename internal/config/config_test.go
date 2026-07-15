// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Per plan dashboard-memory-bff-server-side-key-vault v1.2 § T3.1.
// Plus F-rev-5 fix-cycle absorption (2026-06-08): 4 promised but absent tests.

package config

import (
	"testing"
)

func TestConfig_ParsesThemorySkipCapabilityCheck(t *testing.T) {
	t.Setenv("THEMORY_SKIP_CAPABILITY_CHECK", "true")
	if cfg := Load(); !cfg.ThemorySkipCapabilityCheck {
		t.Fatal("expected ThemorySkipCapabilityCheck=true when env is \"true\"")
	}
	// Any non-"true" value (incl. unset) must default to the safe false posture.
	t.Setenv("THEMORY_SKIP_CAPABILITY_CHECK", "1")
	if cfg := Load(); cfg.ThemorySkipCapabilityCheck {
		t.Fatal("expected ThemorySkipCapabilityCheck=false for non-\"true\" value")
	}
}

// =========================================================================
// Validate() fail-fast coverage — install-config-contract Slice 1 T4.1.
// Gap: config.go documents THEMORY_API_KEY as "required when ThemoryBaseURL is
// set in prod" but Validate() did not enforce it — the proxy would call theo-data
// unauthenticated. These tests lock the fail-fast.
// =========================================================================

func prodValidBaseline() Config {
	return Config{
		Environment:         "prod",
		HydraPublicURL:      "https://hydra.example",
		HydraAdminURL:       "http://ory-hydra-admin:4445",
		KratosPublicURL:     "https://kratos.example",
		KratosAdminURL:      "http://ory-kratos-admin:80",
		DatabaseURL:         "postgres://u:p@db:5432/theo",
		StripeAPIKey:        Secret("sk_live_x"),
		StripeWebhookSecret: Secret("whsec_x"),
		SessionTokenSecret:  Secret("0123456789012345678901234567890123"),
		ServiceAuthSecret:   Secret("0123456789012345678901234567890123"),
	}
}

func TestValidate_prod_requires_themory_api_key_when_themory_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.ThemoryBaseURL = "http://themory:3000"
	c.ThemoryAPIKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when THEMORY_BASE_URL is set but THEMORY_API_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_themory_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.ThemoryBaseURL = "http://themory:3000"
	c.ThemoryAPIKey = Secret("master-bearer")
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when themory fully configured; got %v", err)
	}
}

func TestValidate_prod_passes_when_themory_disabled(t *testing.T) {
	c := prodValidBaseline() // ThemoryBaseURL empty → themory check must not fire
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when themory disabled; got %v", err)
	}
}

// M11 (theo-promptly L2 broker): mirror the themory base-url ⇒ key invariant.
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

func TestValidate_prod_passes_when_promptly_disabled(t *testing.T) {
	c := prodValidBaseline() // PromptlyBaseURL empty → promptly check must not fire
	if err := c.Validate(); err != nil {
		t.Fatalf("expected Validate() to pass when promptly disabled; got %v", err)
	}
}

// M14 edge-rag-broker — RAG_PLATFORM_ADMIN_KEY required in prod when RAG_BASE_URL set.
func TestValidate_prod_requires_rag_admin_key_when_rag_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.RagBaseURL = "http://theo-rag:8787"
	c.RagPlatformAdminKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when RAG_BASE_URL is set but RAG_PLATFORM_ADMIN_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_rag_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.RagBaseURL = "http://theo-rag:8787"
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
	t.Setenv("RAG_BASE_URL", "http://theo-rag:8787")
	t.Setenv("RAG_PLATFORM_ADMIN_KEY", "rag_live_platform_env")
	c := Load()
	if c.RagBaseURL != "http://theo-rag:8787" {
		t.Errorf("RagBaseURL = %q, want http://theo-rag:8787 (RAG_BASE_URL not read)", c.RagBaseURL)
	}
	if c.RagPlatformAdminKey.Value() != "rag_live_platform_env" {
		t.Errorf("RagPlatformAdminKey = %q, want rag_live_platform_env (RAG_PLATFORM_ADMIN_KEY not read)", c.RagPlatformAdminKey.Value())
	}
}

// M38 edge-lens-broker — LENS_PLATFORM_ADMIN_KEY required in prod when LENS_BASE_URL set.
func TestValidate_prod_requires_lens_admin_key_when_lens_base_url_set(t *testing.T) {
	c := prodValidBaseline()
	c.LensBaseURL = "http://theo-lens:18082"
	c.LensPlatformAdminKey = Secret("")
	if err := c.Validate(); err == nil {
		t.Fatal("expected Validate() to fail when LENS_BASE_URL is set but LENS_PLATFORM_ADMIN_KEY is empty in prod")
	}
}

func TestValidate_prod_passes_when_lens_fully_configured(t *testing.T) {
	c := prodValidBaseline()
	c.LensBaseURL = "http://theo-lens:18082"
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
	t.Setenv("LENS_BASE_URL", "http://theo-lens:18082")
	t.Setenv("LENS_PLATFORM_ADMIN_KEY", "theo_live_platform_env")
	c := Load()
	if c.LensBaseURL != "http://theo-lens:18082" {
		t.Errorf("LensBaseURL = %q, want http://theo-lens:18082 (LENS_BASE_URL not read)", c.LensBaseURL)
	}
	if c.LensPlatformAdminKey.Value() != "theo_live_platform_env" {
		t.Errorf("LensPlatformAdminKey = %q, want theo_live_platform_env (LENS_PLATFORM_ADMIN_KEY not read)", c.LensPlatformAdminKey.Value())
	}
}

// TestValidateStorage_AllOrNone — M7: a partial storage config must fail fast.
func TestValidateStorage_AllOrNone(t *testing.T) {
	base := Config{Environment: "dev"}

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
	full.StorageS3Bucket = "theo-storage"
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
