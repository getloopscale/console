/**
 * T1.3 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #28.
 *
 * App-controlled localized validation helpers. Replaces native browser
 * validation (which uses BROWSER locale, NOT the page `lang` attribute)
 * with JS-controlled messages aligned to the UI's `lang="en"`.
 *
 * Per ADR D4 — noValidate + JS messages over native popup.
 *
 * Pure-function module: no React, no DOM, no side effects. Reusable across
 * auth pages (register, login, recovery) + future i18n hook landing-zone.
 *
 * EC-1 + EC-2 of edge-case review absorbed:
 * - `validatePasswordMinLength` covers the password-length case so the
 *   `noValidate` form gate still blocks short passwords (the visible
 *   `minLength={10}` HTML attribute becomes a HINT only after noValidate).
 * - All validators return `string | null` so the calling form's onSubmit
 *   can collect non-null results + `event.preventDefault()` BEFORE
 *   submitting. The "submit short password → form does NOT submit"
 *   contract is asserted in register.test.tsx.
 */

/**
 * Validate a required field. Returns an EN error message if empty, null otherwise.
 * `fieldLabel` is the user-visible label (e.g., "Name", "Email").
 */
export function validateRequired(value: string, fieldLabel: string): string | null {
  if (!value || value.trim().length === 0) {
    return `${fieldLabel} is required.`;
  }
  return null;
}

/**
 * Validate an email address. Returns an EN error message if malformed, null otherwise.
 * Uses a conservative RFC 5322-simplified regex (sufficient for client-side gate;
 * backend Kratos performs canonical RFC validation).
 */
export function validateEmail(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Email is required.';
  }
  const trimmed = value.trim();
  // Simplified RFC 5322 — local-part + @ + domain with TLD.
  const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!re.test(trimmed)) {
    return 'Enter a valid email address.';
  }
  return null;
}

/**
 * Validate a string field does not exceed a maximum character length.
 * Returns an EN error message when `value.length > max`, null otherwise.
 *
 * theo-cloud#65 closure (Red Team 2026-06-26): the Kratos identity schema's
 * `traits.name` was unbounded (`maxLength: -1` per the RegisterFlow probe
 * — JSON Schema default = no cap), allowing 20 000-char display Names to
 * be persisted. That name then embedded verbatim in the session JWT (see
 * #64 root cause: `theo-cloud/internal/routes/session_token.go:117` →
 * `theo-contracts/jwt.SessionTokenIssuer.Issue`), producing a ~27 KB
 * Authorization header. This client-side gate is the FIRST defense; the
 * Kratos schema cap (`theo/infra/helm/ory-kratos/identity.schema.json
 * → traits.name.maxLength: 256`) is the second.
 *
 * `max` MUST mirror the backend Kratos schema `maxLength` so the
 * client error matches the server contract — 256 is the canonical cap
 * (DNS-label / username sized; #65 issue suggestion "100-256 chars").
 */
export function validateMaxLength(value: string, fieldLabel: string, max: number): string | null {
  if (value && value.length > max) {
    return `${fieldLabel} must be ${max} characters or fewer.`;
  }
  return null;
}

/**
 * Validate password meets minimum length. Returns an EN error message if too
 * short, null otherwise. `min` MUST mirror the backend Kratos identity schema
 * `password.min_length` config — typically imported from `auth-policy.ts`.
 */
export function validatePasswordMinLength(value: string, min: number): string | null {
  if (!value) {
    return 'Password is required.';
  }
  if (value.length < min) {
    return `Password must be at least ${min} characters.`;
  }
  return null;
}
