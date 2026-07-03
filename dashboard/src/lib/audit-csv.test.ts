import { describe, it, expect } from 'vitest';
import { auditEntriesToCsv } from './audit-csv';
import type { AuditEntry } from './api/types';

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
