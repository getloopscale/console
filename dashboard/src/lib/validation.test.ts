/**
 * T1.3 hermetic test suite for validation helpers.
 *
 * Per plan v1.2 § T1.3 TDD block (post EC-1 + EC-2 absorption).
 * Covers all three pure-function validators with EN-locale expectations.
 */
import { describe, it, expect } from 'vitest';
import { validateRequired, validateEmail, validatePasswordMinLength } from './validation';

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
});
