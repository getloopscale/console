// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { neutralizeFormula, csvField, toCsv } from './csv';

describe('csv primitives (shared — one source for audit + traces export)', () => {
  describe('neutralizeFormula (CWE-1236 / OWASP CSV injection)', () => {
    it('prefixes an apostrophe to a value starting with a formula char', () => {
      expect(neutralizeFormula('=HYPERLINK("http://evil","x")')).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
      for (const c of ['=', '+', '-', '@', '\t', '\r']) {
        expect(neutralizeFormula(`${c}cmd`)).toBe(`'${c}cmd`);
      }
    });
    it('leaves a benign value unchanged', () => {
      expect(neutralizeFormula('checkout flow')).toBe('checkout flow');
      expect(neutralizeFormula('tr_123')).toBe('tr_123');
    });
  });

  describe('csvField (RFC 4180)', () => {
    it('quotes a field with a comma / quote / newline and doubles embedded quotes', () => {
      expect(csvField('a,b')).toBe('"a,b"');
      expect(csvField('he"llo')).toBe('"he""llo"');
      expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    });
    it('leaves a plain field unquoted', () => {
      expect(csvField('plain')).toBe('plain');
    });
  });

  describe('toCsv', () => {
    it('joins the header + rows RFC-4180, CRLF-separated, guarding + escaping each cell', () => {
      const csv = toCsv(['A', 'B'], [['=cmd', 'x,y'], ['plain', 'ok']]);
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('A,B');
      expect(lines[1]).toBe("'=cmd,\"x,y\""); // formula neutralized THEN RFC-escaped
      expect(lines[2]).toBe('plain,ok');
    });
    it('emits only the header for an empty row set', () => {
      expect(toCsv(['A', 'B'], [])).toBe('A,B');
    });
  });
});
