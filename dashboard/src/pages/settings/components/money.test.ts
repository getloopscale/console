// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatMinor } from './money';

// J-13 (MEET-2026-07-03-004) — money is integer minor units + currency; the
// display divides by 100 only at render. A test MUST prove 2900 → "$29.00"
// (never a float artifact like "$29" or "$29.0000001").
describe('formatMinor', () => {
  it('formats USD minor units as $X.XX', () => {
    expect(formatMinor(2900, 'usd')).toBe('$29.00');
  });

  it('keeps two decimals for non-round amounts', () => {
    expect(formatMinor(2999, 'USD')).toBe('$29.99');
  });

  it('renders zero honestly', () => {
    expect(formatMinor(0, 'usd')).toBe('$0.00');
  });

  it('supports other ISO currencies', () => {
    // EUR symbol placement is locale-dependent; assert the amount + code appear.
    const out = formatMinor(9900, 'eur');
    expect(out).toContain('99.00');
  });

  it('falls back to USD when currency is empty (never throws)', () => {
    expect(formatMinor(500, '')).toBe('$5.00');
  });
});
