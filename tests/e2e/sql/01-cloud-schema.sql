-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2025-2026 The Theo Authors
--
-- Minimal cloud-side schema for the theo-cloud <-> TheMemory e2e harness.
--
-- HONEST FINDING (surfaced while building this harness): theo-cloud ships NO
-- migrations of its own — the production `theo_api_keys` / metering / webhook
-- tables are created by the engine repo's migrations. That makes the cloud
-- non-self-contained for standalone e2e. This file recreates ONLY the table
-- the memory proxy auth path needs (`theo_api_keys`, read by
-- internal/auth/scope.go::RequireScope) so the harness can run hermetically.
-- It is a TEST fixture, not the authoritative schema.
--
-- Column set mirrors internal/auth/bff_key_vault.go (INSERT) +
-- internal/auth/scope.go (SELECT: id, subject, tenant_id, scopes, expires_at,
-- key_hash, revoked_at).

CREATE TABLE IF NOT EXISTS theo_api_keys (
    id           TEXT PRIMARY KEY,
    subject      TEXT        NOT NULL,
    tenant_id    TEXT        NOT NULL,
    key_name     TEXT        NOT NULL DEFAULT 'e2e',
    key_hash     TEXT        NOT NULL UNIQUE,
    key_prefix   TEXT        NOT NULL DEFAULT '',
    scopes       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    expires_at   TIMESTAMPTZ,
    bff_minted   BOOLEAN     NOT NULL DEFAULT false,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_theo_api_keys_key_hash ON theo_api_keys (key_hash);
