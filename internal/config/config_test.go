// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Per plan dashboard-memory-bff-server-side-key-vault v1.2 § T3.1.
// Plus F-rev-5 fix-cycle absorption (2026-06-08): 4 promised but absent tests.

package config

import (
	"os"
	"testing"
)

// =========================================================================
// envOrInt — promised by plan v1.2 § T3.1 TDD block (4 of 7 tests)
// =========================================================================

func TestConfig_ParsesBFFKeyTTLHoursFromEnv(t *testing.T) {
	t.Setenv("THEOCLOUD_BFF_KEY_TTL_HOURS", "12")
	cfg := Load()
	if cfg.BFFKeyTTLHours != 12 {
		t.Fatalf("expected BFFKeyTTLHours=12; got %d", cfg.BFFKeyTTLHours)
	}
}

func TestConfig_DefaultsBFFKeyTTLHoursTo24WhenEnvUnset(t *testing.T) {
	// Ensure env var absent
	_ = os.Unsetenv("THEOCLOUD_BFF_KEY_TTL_HOURS")
	cfg := Load()
	if cfg.BFFKeyTTLHours != 24 {
		t.Fatalf("expected default BFFKeyTTLHours=24; got %d", cfg.BFFKeyTTLHours)
	}
}

func TestConfig_FallsBackToDefaultOnInvalidEnv(t *testing.T) {
	t.Setenv("THEOCLOUD_BFF_KEY_TTL_HOURS", "not-a-number")
	cfg := Load()
	// envOrInt returns fallback (24) on parse failure; range validation
	// happens in NewBFFKeyVault constructor (fail-loud at consumer).
	if cfg.BFFKeyTTLHours != 24 {
		t.Fatalf("expected fallback BFFKeyTTLHours=24 on parse error; got %d", cfg.BFFKeyTTLHours)
	}
}

func TestConfig_ParsesNumericEdgeValues(t *testing.T) {
	cases := []struct {
		envValue string
		expected int
	}{
		{"1", 1},     // floor
		{"168", 168}, // ceiling (1 week)
		{"24", 24},   // default
		{"0", 0},     // invalid range but parses; vault constructor rejects
		{"-5", -5},   // invalid; vault rejects
		{"1000", 1000}, // invalid; vault rejects
	}
	for _, tc := range cases {
		t.Run(tc.envValue, func(t *testing.T) {
			t.Setenv("THEOCLOUD_BFF_KEY_TTL_HOURS", tc.envValue)
			cfg := Load()
			if cfg.BFFKeyTTLHours != tc.expected {
				t.Fatalf("env=%q: expected %d; got %d", tc.envValue, tc.expected, cfg.BFFKeyTTLHours)
			}
		})
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
