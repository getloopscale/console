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

import { describe, it, expect } from 'vitest';
import { displayAction } from './audit';

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
