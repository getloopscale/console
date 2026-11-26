-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2025-2026 The LoopScale Authors
-- Separate database for Ory Kratos (keeps its tables out of the engine schema).
-- Runs at initdb time (superuser) before kratos-migrate.
CREATE DATABASE kratos;
