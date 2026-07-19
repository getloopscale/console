import { describe, it, expect } from 'vitest';
import { tagColorClasses, parseTags } from './tag-color';

describe('tag colors — deterministic per name', () => {
  it('returns the same colour classes for the same tag every time', () => {
    expect(tagColorClasses('api')).toBe(tagColorClasses('api'));
    expect(tagColorClasses('API')).toBe(tagColorClasses('api')); // case-insensitive
  });

  it('assigns from the curated palette (bg + text + border)', () => {
    const cls = tagColorClasses('auth');
    expect(cls).toMatch(/bg-\w+-500\/15/);
    expect(cls).toMatch(/text-\w+-\d{3}/);
    expect(cls).toMatch(/border-\w+-500\/30/);
  });

  it('different tags generally get different colours', () => {
    const names = ['api', 'auth', 'billing', 'deploy', 'infra', 'security', 'docs', 'ui'];
    const colours = new Set(names.map(tagColorClasses));
    expect(colours.size).toBeGreaterThan(1);
  });
});

describe('parseTags', () => {
  it('trims, drops empties, de-duplicates (case-insensitive)', () => {
    expect(parseTags('api, auth ,, api,  AUTH')).toEqual(['api', 'auth']);
  });
  it('empty string → empty list', () => {
    expect(parseTags('  ')).toEqual([]);
  });
});
