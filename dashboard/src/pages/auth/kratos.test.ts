import { describe, it, expect } from 'vitest';
import { enrichKratosError } from './kratos';

describe('enrichKratosError (T0.1 EC-02)', () => {
  it('test_enrichKratosError_passes_through_specific_messages', () => {
    // Specific messages already actionable — don't append extra action
    const out = enrichKratosError('Invalid email address.', 'login');
    expect(out).toBe('Invalid email address.');
  });

  it('test_enrichKratosError_enriches_generic_unexpected_error', () => {
    const out = enrichKratosError('An unexpected error occurred', 'recovery');
    expect(out).toContain('An unexpected error occurred');
    expect(out.toLowerCase()).toContain('check your email');
  });

  it('test_enrichKratosError_enriches_internal_server_error', () => {
    const out = enrichKratosError('Internal server error', 'verification');
    expect(out.toLowerCase()).toContain('request a new verification link');
  });

  it('test_enrichKratosError_is_case_insensitive', () => {
    const out = enrichKratosError('AN UNEXPECTED ERROR OCCURRED', 'login');
    expect(out.toLowerCase()).toContain('check your credentials');
  });

  it('test_enrichKratosError_handles_empty_string', () => {
    const out = enrichKratosError('', 'login');
    // Empty isn't matched as generic; pass-through
    expect(out).toBe('');
  });

  // Red Team theo-cloud#75 closure: the raw Kratos duplicate-account
  // message references phone/username fields the /register form
  // never collects. Override with copy scoped to the actual fields
  // (email) plus an inline retry path.
  it('rewrites duplicate-account error to email-only copy with CTA hints (#75)', () => {
    const raw =
      'An account with the same identifier (email, phone, username, ...) exists already.';
    const out = enrichKratosError(raw, 'registration');
    // Phone + username MUST NOT appear in user-facing copy for the
    // /register flow.
    expect(out.toLowerCase()).not.toContain('phone');
    expect(out.toLowerCase()).not.toContain('username');
    expect(out.toLowerCase()).toContain('this email already exists');
    // Inline next-step CTAs.
    expect(out.toLowerCase()).toContain('sign in');
    expect(out.toLowerCase()).toContain('reset');
  });
});
