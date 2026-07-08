import { describe, it, expect } from 'vitest';
import {
  formatCost,
  formatDate,
  formatDuration,
  formatNumber,
  formatTokens,
  humanizeAuthor,
  isZeroTime,
  maskEmail,
  shortId,
  formatScore,
} from './format';

describe('isZeroTime (#118, qa-dogfood-cleanup-2026-06-21 T3.1)', () => {
  it('returns true for nullish + empty', () => {
    expect(isZeroTime(undefined)).toBe(true);
    expect(isZeroTime(null)).toBe(true);
    expect(isZeroTime('')).toBe(true);
  });

  it('returns true for the canonical Go zero-time JSON literal', () => {
    expect(isZeroTime('0001-01-01T00:00:00Z')).toBe(true);
  });

  // EC-4 — prefix-match handles RFC3339Nano + +00:00 suffix variants
  it('returns true for RFC3339Nano / suffix variants of the zero literal', () => {
    expect(isZeroTime('0001-01-01T00:00:00.000000000Z')).toBe(true);
    expect(isZeroTime('0001-01-01T00:00:00+00:00')).toBe(true);
    expect(isZeroTime('0001-01-01T00:00:00.123+02:00')).toBe(true);
  });

  it('returns false for non-zero ISO strings', () => {
    expect(isZeroTime('2026-05-25T06:42:00Z')).toBe(false);
    expect(isZeroTime('2025-12-31T23:59:59Z')).toBe(false);
  });
});

describe('formatDate handles Go zero-time as em-dash (#118)', () => {
  it('test_format_date_zero_time_to_em_dash', () => {
    expect(formatDate('0001-01-01T00:00:00Z', 'date')).toBe('—');
    expect(formatDate('0001-01-01T00:00:00Z', 'relative')).toBe('—');
    expect(formatDate('0001-01-01T00:00:00.000000000Z', 'datetime')).toBe('—');
  });
});

describe('formatDate', () => {
  it('test_format_date_handles_4_intents', () => {
    const iso = '2026-05-25T06:42:00Z';
    // en-US locale per ADR-D1; exact format depends on Intl but key tokens
    // (May, 25, 2026) must be present in date/datetime/long intents.
    expect(formatDate(iso, 'date')).toMatch(/May 25, 2026/);
    expect(formatDate(iso, 'datetime')).toMatch(/May 25, 2026/);
    expect(formatDate(iso, 'long')).toMatch(/Monday, May 25, 2026/);
    expect(formatDate(iso, 'relative')).toMatch(/(year|month|day|ago|in)/);
  });

  it('test_format_date_returns_em_dash_for_null', () => {
    expect(formatDate(null, 'date')).toBe('—');
    expect(formatDate(undefined, 'date')).toBe('—');
  });

  // EC-2 (MUST FIX): empty string defensive guard
  it('test_format_date_returns_em_dash_for_empty_string', () => {
    // Today `!''` is true so guard catches; this test pins the invariant
    // in case future refactor changes the guard to `=== null/undefined`.
    expect(formatDate('', 'date')).toBe('—');
    expect(formatDate('', 'datetime')).toBe('—');
    expect(formatDate('', 'relative')).toBe('—');
    expect(formatDate('', 'long')).toBe('—');
  });

  it('test_format_date_returns_em_dash_for_invalid_iso', () => {
    // new Date('not-a-date') → Invalid Date → guard returns em-dash
    expect(formatDate('not-a-date', 'date')).toBe('—');
    expect(formatDate('2026-13-99', 'date')).toBe('—');
  });
});

describe('formatNumber', () => {
  it('test_format_number_compact_formats_millions', () => {
    expect(formatNumber(1_240_000, 'compact')).toBe('1.24M');
    expect(formatNumber(1_500_000_000, 'compact')).toBe('1.5B');
    expect(formatNumber(500, 'compact')).toBe('500');
  });

  it('test_format_number_grouped_uses_thousand_separator', () => {
    expect(formatNumber(1_240_000, 'grouped')).toBe('1,240,000');
    expect(formatNumber(0, 'grouped')).toBe('0');
  });

  it('test_format_number_bytes_handles_KB_MB_GB', () => {
    // SI 1000-base per ADR-D4
    expect(formatNumber(500, 'bytes')).toBe('500 B');
    expect(formatNumber(1500, 'bytes')).toBe('1.5 KB');
    expect(formatNumber(1_500_000, 'bytes')).toBe('1.5 MB');
    expect(formatNumber(412_000_000_000, 'bytes')).toBe('412 GB');
  });

  it('test_format_number_returns_em_dash_for_NaN', () => {
    expect(formatNumber(NaN, 'compact')).toBe('—');
    expect(formatNumber(NaN, 'grouped')).toBe('—');
    expect(formatNumber(NaN, 'bytes')).toBe('—');
    expect(formatNumber(NaN, 'percent')).toBe('—');
  });

  // EC-8 (SHOULD TEST): Infinity guard — same family as NaN
  it('test_format_number_returns_em_dash_for_Infinity', () => {
    expect(formatNumber(Infinity, 'compact')).toBe('—');
    expect(formatNumber(-Infinity, 'compact')).toBe('—');
    expect(formatNumber(Infinity, 'bytes')).toBe('—');
  });

  it('test_format_number_percent_handles_fraction', () => {
    expect(formatNumber(0.423, 'percent')).toBe('42.3%');
    expect(formatNumber(0, 'percent')).toBe('0%');
    expect(formatNumber(1, 'percent')).toBe('100%');
  });
});

describe('maskEmail (T-D.1 / P-3 / EC-10)', () => {
  it('test_mask_email_preserves_domain', () => {
    // Plan v1.1 T-D.1: preserve full domain, redact only local part
    expect(maskEmail('demo@usetheo.dev')).toBe('d***@usetheo.dev');
    expect(maskEmail('paulo@example.com')).toBe('p****@example.com');
  });

  it('test_mask_email_handles_single_char_local', () => {
    expect(maskEmail('a@b.com')).toBe('*@b.com');
    expect(maskEmail('x@example.org')).toBe('*@example.org');
  });

  it('test_mask_email_caps_mask_length', () => {
    // Local "verylonglocalpart" = 17 chars → 1 + min(16, 8) = 1 + 8 = 9 chars
    expect(maskEmail('verylonglocalpart@x.com')).toBe('v********@x.com');
  });

  // EC-10 (SHOULD TEST): defensive passthrough for malformed emails
  it('test_mask_email_handles_multiple_at_signs', () => {
    expect(maskEmail('a@b@c.com')).toBe('a@b@c.com');
    expect(maskEmail('john@doe@malformed.com')).toBe('john@doe@malformed.com');
  });

  it('test_mask_email_handles_missing_domain', () => {
    expect(maskEmail('x@')).toBe('x@');
    expect(maskEmail('@y.com')).toBe('@y.com');
  });
});

// Red Team theo-cloud#52/#78 closure: the /deployments table used to
// render the backend `created_by` UUID verbatim. humanizeAuthor maps a
// UUID to its first 8 chars, an email to its local-part, and passes
// through anything else.
describe('humanizeAuthor (#52/#78)', () => {
  it('collapses a UUID to its first 8 chars', () => {
    expect(humanizeAuthor('4d6ae2dd-baa2-4c01-8d33-a96e20c23d1a')).toBe('4d6ae2dd');
  });

  it('keeps the local-part of an email', () => {
    expect(humanizeAuthor('paulo@usetheo.dev')).toBe('paulo');
  });

  it('passes through a real name', () => {
    expect(humanizeAuthor('Paulo Henrique')).toBe('Paulo Henrique');
  });

  it('falls back to em-dash for null / empty', () => {
    expect(humanizeAuthor('')).toBe('—');
    expect(humanizeAuthor(null)).toBe('—');
    expect(humanizeAuthor(undefined)).toBe('—');
    expect(humanizeAuthor('   ')).toBe('—');
  });

  it('passes through a malformed multi-@ string', () => {
    // The maskEmail defensive passthrough is reused here: if the
    // string isn't a clean email, leave it alone.
    expect(humanizeAuthor('a@b@c')).toBe('a@b@c');
  });
});

// M57 craft-system floor — metric formatters (plan m57-craft-system-floor T0.1)
describe('formatDuration (M57 T0.1)', () => {
  it('renders integer ms below 1s', () => {
    expect(formatDuration(846)).toBe('846ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('renders one-decimal seconds between 1s and 1min', () => {
    expect(formatDuration(5846)).toBe('5.8s');
    expect(formatDuration(1000)).toBe('1.0s');
  });

  it('renders m + s at or above 1 minute', () => {
    expect(formatDuration(105304)).toBe('1m 45s');
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  it('renders "<1ms" for sub-millisecond positive values', () => {
    expect(formatDuration(0.4)).toBe('<1ms');
  });

  // negative case (testing.md §4.1) — invalid/non-finite input never throws
  it('returns the em-dash for non-finite or negative input', () => {
    expect(formatDuration(NaN)).toBe('—');
    expect(formatDuration(Infinity)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    // @ts-expect-error — defensive against untyped callers
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatTokens (M57 T0.1)', () => {
  it('groups thousands', () => {
    expect(formatTokens(1285)).toBe('1,285');
    expect(formatTokens(285)).toBe('285');
  });

  it('returns the em-dash for non-finite input', () => {
    expect(formatTokens(NaN)).toBe('—');
    // @ts-expect-error — defensive against untyped callers
    expect(formatTokens(undefined)).toBe('—');
  });
});

describe('formatCost (M57 T0.1)', () => {
  it('uses 4 decimals below one cent', () => {
    expect(formatCost(0.0009)).toBe('$0.0009');
    expect(formatCost(0)).toBe('$0.0000');
  });

  it('uses 2 decimals at or above one cent', () => {
    expect(formatCost(1.23)).toBe('$1.23');
    expect(formatCost(0.01)).toBe('$0.01');
  });

  it('forces a fixed precision when fractionDigits is given (compare screen)', () => {
    expect(formatCost(0.0123, 4)).toBe('$0.0123');
    expect(formatCost(0.0145, 4)).toBe('$0.0145');
    expect(formatCost(1.2, 4)).toBe('$1.2000');
  });

  it('returns the em-dash for non-finite or negative input', () => {
    expect(formatCost(NaN)).toBe('—');
    expect(formatCost(Infinity)).toBe('—');
    expect(formatCost(-0.5)).toBe('—');
  });
});

describe('shortId (M57 T0.1)', () => {
  it('truncates a long id to an 8-char prefix + ellipsis', () => {
    expect(shortId('dbbbfe6f3fda53662c57ef875f0191f8')).toBe('dbbbfe6f…');
  });

  it('returns a short id unchanged', () => {
    expect(shortId('abc123')).toBe('abc123');
    expect(shortId('12345678')).toBe('12345678');
  });

  it('returns the em-dash for empty or nullish id', () => {
    expect(shortId('')).toBe('—');
    expect(shortId(null)).toBe('—');
    expect(shortId(undefined)).toBe('—');
  });
});

describe('formatScore (M72)', () => {
  it('formats a finite score to fixed precision', () => {
    expect(formatScore(0.8)).toBe('0.80');
    expect(formatScore(1)).toBe('1.00');
    expect(formatScore(0)).toBe('0.00'); // a real 0 is an honest score
  });
  it('returns em-dash for an absent / non-finite score (never a fabricated 0.00)', () => {
    expect(formatScore(undefined)).toBe('—');
    expect(formatScore(null)).toBe('—');
    expect(formatScore(NaN)).toBe('—');
    expect(formatScore(Infinity)).toBe('—');
  });
});
