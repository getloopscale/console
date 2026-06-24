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
