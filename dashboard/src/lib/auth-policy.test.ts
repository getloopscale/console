/**
 * T1.2 hermetic test for auth-policy constants.
 *
 * Per ADR D3 — locks the documented Kratos backend value to prevent silent
 * drift on either side. If backend Kratos min_length changes, this test fails
 * and forces operator to update BOTH (constant + ConfigMap) atomically.
 */
import { describe, it, expect } from 'vitest';
import { KRATOS_PASSWORD_MIN_LENGTH } from './auth-policy';

describe('T1.2 #18 auth-policy constants', () => {
  it('KRATOS_PASSWORD_MIN_LENGTH is 10 (matches Kratos backend identity schema)', () => {
    expect(KRATOS_PASSWORD_MIN_LENGTH).toBe(10);
  });

  it('KRATOS_PASSWORD_MIN_LENGTH is a positive integer (defensive)', () => {
    expect(Number.isInteger(KRATOS_PASSWORD_MIN_LENGTH)).toBe(true);
    expect(KRATOS_PASSWORD_MIN_LENGTH).toBeGreaterThan(0);
  });
});
