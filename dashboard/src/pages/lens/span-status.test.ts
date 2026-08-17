// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isSpanError, ERROR_STATUS } from './span-status';

describe('isSpanError', () => {
  it('ok / unset / undefined statuses are not errors', () => {
    // The #176 bug: `statusCode !== "0"` flagged these as errors.
    expect(isSpanError('0')).toBe(false); // UNSET
    expect(isSpanError('1')).toBe(false); // OK (OTLP numeric)
    expect(isSpanError('STATUS_CODE_OK')).toBe(false);
    expect(isSpanError(undefined)).toBe(false);
    expect(isSpanError('')).toBe(false);
  });

  it('only the sanctioned error tokens are errors', () => {
    expect(isSpanError('2')).toBe(true); // ERROR (OTLP numeric)
    expect(isSpanError('ERROR')).toBe(true);
    expect(isSpanError('STATUS_CODE_ERROR')).toBe(true);
  });

  it('an unknown status is fail-safe (not an error)', () => {
    expect(isSpanError('WEIRD_UNKNOWN')).toBe(false);
    expect(isSpanError('3')).toBe(false);
  });

  it('exposes the canonical error-token set', () => {
    expect(ERROR_STATUS.has('2')).toBe(true);
    expect(ERROR_STATUS.has('STATUS_CODE_ERROR')).toBe(true);
    expect(ERROR_STATUS.has('1')).toBe(false);
  });
});
