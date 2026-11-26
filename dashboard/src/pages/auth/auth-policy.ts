/**
 * T1.2 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #18.
 *
 * Single source of truth for password policy on the dashboard side. The
 * backend canonical (Ory Kratos identity schema config) lives at
 * `loopscale/infra/helm/ory-kratos/values.yaml.gotmpl` (`identity.default_schema.password.min_length`).
 * This constant MUST track that backend value — update both atomically
 * when changing policy (test `auth-policy.test.ts` asserts the documented
 * value to prevent silent drift).
 *
 * Per ADR D3 of the plan (constant, not magic number).
 */

/** Minimum password length enforced by Ory Kratos backend. Mirrors loopscale-auth/ory-kratos-config. */
export const KRATOS_PASSWORD_MIN_LENGTH = 10;
