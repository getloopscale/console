// @vitest-environment node
/**
 * T1.3 hermetic test suite for validation helpers.
 *
 * Per plan v1.2 § T1.3 TDD block (post EC-1 + EC-2 absorption).
 * Covers all three pure-function validators with EN-locale expectations.
 */
import { describe, it, expect } from 'vitest';
import { validateRequired, validateEmail, validatePasswordMinLength, validateMaxLength } from './validation';

describe('T1.3 #28 + EC-1 validation helpers (EN messages)', () => {
  it('validateRequired returns EN error when empty', () => {
    expect(validateRequired('', 'Name')).toBe('Name is required.');
  });

  it('validateRequired returns EN error when whitespace-only', () => {
    expect(validateRequired('   ', 'Name')).toBe('Name is required.');
  });

  it('validateRequired returns null when value present', () => {
    expect(validateRequired('Alice', 'Name')).toBeNull();
  });

  it('validateEmail returns EN error on empty', () => {
    expect(validateEmail('')).toBe('Email is required.');
  });

  it('validateEmail returns EN error on malformed', () => {
    expect(validateEmail('not-an-email')).toBe('Enter a valid email address.');
  });

  it('validateEmail returns EN error on missing TLD', () => {
    expect(validateEmail('a@b')).toBe('Enter a valid email address.');
  });

  it('validateEmail returns null on valid email', () => {
    expect(validateEmail('a@b.co')).toBeNull();
  });

  it('validatePasswordMinLength returns EN error on empty', () => {
    expect(validatePasswordMinLength('', 10)).toBe('Password is required.');
  });

  it('validatePasswordMinLength returns EN error below threshold', () => {
    expect(validatePasswordMinLength('short', 10)).toBe('Password must be at least 10 characters.');
  });

  it('validatePasswordMinLength returns EN error at exactly N-1', () => {
    expect(validatePasswordMinLength('123456789', 10)).toBe('Password must be at least 10 characters.');
  });

  it('validatePasswordMinLength returns null at threshold', () => {
    expect(validatePasswordMinLength('1234567890', 10)).toBeNull();
  });

  it('validatePasswordMinLength returns null above threshold', () => {
    expect(validatePasswordMinLength('A1234567890123', 10)).toBeNull();
  });

  // theo-cloud#65 closure (Red Team 2026-06-26): the Kratos identity schema's
  // traits.name was unbounded (maxLength: -1), so /register accepted 20 000-
  // char Names that then bloated the session JWT to ~27 KB (root cause of
  // #64). This client gate is the FIRST defense; the schema cap is the
  // second. Canonical limit 256 chars per #65 suggestion "100-256 chars".
  it('validateMaxLength_returns_null_at_threshold_closes_65', () => {
    expect(validateMaxLength('a'.repeat(256), 'Name', 256)).toBeNull();
  });

  it('validateMaxLength_returns_EN_error_above_threshold_closes_65', () => {
    expect(validateMaxLength('a'.repeat(257), 'Name', 256)).toBe('Name must be 256 characters or fewer.');
  });

  it('validateMaxLength_rejects_red_team_20k_chars_closes_65', () => {
    // The exact Red Team adversarial input from #65 verbatim repro step:
    // "Preencher Name com 20000 caracteres (ex: 'A' repetido 20000x)".
    expect(validateMaxLength('A'.repeat(20000), 'Name', 256)).toBe('Name must be 256 characters or fewer.');
  });

  it('validateMaxLength_passes_short_values', () => {
    // Backward-compat — short values must continue to pass.
    expect(validateMaxLength('Alice', 'Name', 256)).toBeNull();
    expect(validateMaxLength('', 'Name', 256)).toBeNull(); // empty handled by validateRequired separately
  });
});
