/**
 * Wiki starter templates (KB13). Picking a template pre-fills the create form's body AND
 * its OKF frontmatter (type / tags / description) so a new page starts from a real shape
 * instead of a blank editor. Kept as data + a pure `applyTemplate` so the fill logic is
 * unit-testable independent of the React form.
 */

export interface WikiTemplate {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly tags: string;
  readonly description: string;
  readonly body: string;
}

export interface TemplateFill {
  readonly type: string;
  readonly tags: string;
  readonly description: string;
  readonly body: string;
}

export const WIKI_TEMPLATES: readonly WikiTemplate[] = [
  {
    id: 'concept',
    label: 'Concept',
    type: 'concept',
    tags: '',
    description: 'A concept or domain idea.',
    body: [
      '## Overview',
      '',
      'What this is, in one or two sentences.',
      '',
      '## Details',
      '',
      '- Key point',
      '- Key point',
      '',
      '## Related',
      '',
      '- Link to related pages',
      '',
    ].join('\n'),
  },
  {
    id: 'runbook',
    label: 'Runbook',
    type: 'runbook',
    tags: 'ops, runbook',
    description: 'Operational runbook for an incident or task.',
    body: [
      '## Symptom',
      '',
      'What the operator observes.',
      '',
      '## Diagnosis',
      '',
      '- [ ] Check X',
      '- [ ] Check Y',
      '',
      '## Resolution',
      '',
      '1. Step one',
      '2. Step two',
      '',
      '## Rollback',
      '',
      'How to undo the change if it makes things worse.',
      '',
    ].join('\n'),
  },
  {
    id: 'api',
    label: 'API',
    type: 'api',
    tags: 'api, reference',
    description: 'API endpoint reference.',
    body: [
      '## Endpoint',
      '',
      '`POST /v1/resource`',
      '',
      '## Request',
      '',
      '```json',
      '{',
      '  "field": "value"',
      '}',
      '```',
      '',
      '## Response',
      '',
      '```json',
      '{',
      '  "id": "res_123",',
      '  "status": "ok"',
      '}',
      '```',
      '',
      '## Errors',
      '',
      '| Code | Meaning |',
      '| --- | --- |',
      '| 400 | Invalid request |',
      '| 404 | Not found |',
      '',
    ].join('\n'),
  },
];

/** Return the field values a template pre-fills, or null for an unknown id. */
export function applyTemplate(id: string): TemplateFill | null {
  const t = WIKI_TEMPLATES.find((x) => x.id === id);
  if (t === undefined) return null;
  return { type: t.type, tags: t.tags, description: t.description, body: t.body };
}
