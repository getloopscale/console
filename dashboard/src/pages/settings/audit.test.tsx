// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * Tests for the audit page defenses landed in
 * qa-dogfood-cleanup-2026-06-21 T5.1 + T5.2.
 *
 * Closes:
 *   - #125 (React key uniqueness on Table.Body — composite key fallback
 *     when audit row IDs are absent)
 *   - #126 (display-side fallback for unmapped raw SQL ops; ACTOR
 *     "[unknown]" fallback)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';

vi.mock('@/hooks/use-auth', async (orig) => ({
  ...(await orig<typeof import('@/hooks/use-auth')>()),
  useRequireAuth: () => ({ active: true }),
}));
vi.mock('@/hooks/use-page-meta', async (orig) => ({
  ...(await orig<typeof import('@/hooks/use-page-meta')>()),
  useSetPageTitle: () => {},
}));

const mockEngineFetch = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  engineFetch: (...args: unknown[]) => mockEngineFetch(...args),
}));

const mockTriggerCsv = vi.fn();
vi.mock('@/pages/settings/audit-csv', async (orig) => ({
  ...(await orig<typeof import('@/pages/settings/audit-csv')>()),
  triggerAuditCsvDownload: (...args: unknown[]) => mockTriggerCsv(...args),
}));

import { AuditPage, displayAction } from './audit';

describe('displayAction (#126 dashboard fallback for raw SQL leak)', () => {
  it('returns the original action for canonical domain events', () => {
    expect(displayAction('project.created')).toBe('project.created');
    expect(displayAction('tenant.member.added')).toBe('tenant.member.added');
    expect(displayAction('secret.set')).toBe('secret.set');
  });

  it('remaps INSERT/DELETE on tenant_members to domain events', () => {
    expect(displayAction('INSERT', 'tenant_members')).toBe('tenant.member.added');
    expect(displayAction('DELETE', 'tenant_members')).toBe('tenant.member.removed');
  });

  it('remaps INSERT/DELETE on projects to domain events', () => {
    expect(displayAction('INSERT', 'projects')).toBe('project.created');
    expect(displayAction('DELETE', 'projects')).toBe('project.deleted');
  });

  it('marks unmapped raw SQL ops explicitly (never silently leak verb)', () => {
    expect(displayAction('UPDATE', 'audit_entries')).toBe('[unmapped: update audit_entries]');
    expect(displayAction('DELETE', 'unknown_table')).toBe('[unmapped: delete unknown_table]');
    expect(displayAction('INSERT', null)).toBe('[unmapped: insert]');
  });

  it('handles empty/null action gracefully', () => {
    expect(displayAction('')).toBe('[unmapped]');
  });
});

// J-14 CSV export — the audit log's "Export CSV" primary action.
describe('AuditPage CSV export (J-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an Export CSV action and downloads the visible entries', async () => {
    mockEngineFetch.mockResolvedValue({
      entries: [
        { action: 'project.created', actor: 'a@x.com', timestamp: '2026-07-03T10:00:00Z', resource_type: 'projects' },
        { action: 'secret.set', actor: 'b@x.com', timestamp: '2026-07-03T11:00:00Z', resource_type: 'secrets' },
      ],
    });
    render(<AuditPage />);
    const btn = await screen.findByRole('button', { name: /export csv/i });
    fireEvent.click(btn);
    await waitFor(() => expect(mockTriggerCsv).toHaveBeenCalledTimes(1));
    // The visible (loaded) entries are handed to the CSV exporter.
    expect(mockTriggerCsv).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action: 'project.created' }),
        expect.objectContaining({ action: 'secret.set' }),
      ]),
    );
  });

  it('omits the Export CSV action when there are no entries', async () => {
    mockEngineFetch.mockResolvedValue({ entries: [] });
    render(<AuditPage />);
    await waitFor(() => expect(mockEngineFetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
  });
});
