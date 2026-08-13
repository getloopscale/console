// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { lensErrorMessage } from './lens-error';

describe('lensErrorMessage', () => {
  const messages = { 403: 'forbidden', 404: 'gone', 429: 'slow down' };

  it('maps a known status to its message', () => {
    expect(lensErrorMessage({ status: 404 }, messages, 'fallback')).toBe('gone');
    expect(lensErrorMessage({ status: 429 }, messages, 'fallback')).toBe('slow down');
  });

  it('falls back for an unmapped status', () => {
    expect(lensErrorMessage({ status: 500 }, messages, 'fallback')).toBe('fallback');
  });

  it('falls back for a non-error / missing status (null, undefined, no status)', () => {
    expect(lensErrorMessage(null, messages, 'fallback')).toBe('fallback');
    expect(lensErrorMessage(undefined, messages, 'fallback')).toBe('fallback');
    expect(lensErrorMessage({}, messages, 'fallback')).toBe('fallback');
  });
});
