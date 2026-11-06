// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { applyTemplate, WIKI_TEMPLATES } from './wiki-templates';

describe('applyTemplate (KB13 wiki templates)', () => {
  it('ships the Concept, Runbook and API templates', () => {
    expect(WIKI_TEMPLATES.map((t) => t.id)).toEqual(['concept', 'runbook', 'api']);
  });

  it('pre-fills body AND frontmatter (type/tags/description) for a known template', () => {
    const fill = applyTemplate('runbook');
    expect(fill).not.toBeNull();
    expect(fill?.type).toBe('runbook');
    expect(fill?.tags).toContain('ops');
    expect(fill?.description).not.toBe('');
    // the body carries the runbook section shape
    expect(fill?.body).toContain('## Symptom');
    expect(fill?.body).toContain('## Rollback');
  });

  it('the API template body includes a fenced code block (KB10 renders it highlighted)', () => {
    const fill = applyTemplate('api');
    expect(fill?.body).toMatch(/```json/);
  });

  it('returns null for an unknown template id', () => {
    expect(applyTemplate('nope')).toBeNull();
  });
});
