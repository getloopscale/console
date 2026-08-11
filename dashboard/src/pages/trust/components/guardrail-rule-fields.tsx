import { Card, FormField, Input, Select, Textarea } from '@usetheo/ui';

import type { DraftField, GuardrailDraft } from './guardrail-draft';

/**
 * M24 — os campos que descrevem a regra: nome, termos, ação e (quando aplicável) substituto.
 *
 * Vive fora da página porque a página tem outra responsabilidade — orquestrar o dry-run
 * obrigatório e a gravação (ADR D1). Aqui só há entrada de dados.
 *
 * O erro de um campo só é renderizado quando o pai o considera **visitado**: quem decide isso é
 * `visibleFieldProblems`, e este componente apenas exibe o que recebe. Por isso o `onBlur` reporta
 * a visita para cima em vez de guardar estado próprio — dois donos do mesmo `touched` divergiriam.
 */
export interface GuardrailRuleFieldsProps {
  readonly draft: GuardrailDraft;
  readonly termsText: string;
  /** Apenas os problemas dos campos já visitados. */
  readonly fieldProblems: Partial<Record<DraftField, string>>;
  readonly onDraftChange: (patch: Partial<GuardrailDraft>) => void;
  readonly onTermsTextChange: (value: string) => void;
  readonly onFieldTouched: (field: DraftField) => void;
}

export function GuardrailRuleFields(props: GuardrailRuleFieldsProps) {
  const { draft, termsText, fieldProblems, onDraftChange, onTermsTextChange, onFieldTouched } = props;

  return (
    <Card>
      <Card.Header>
        {/* asChild → <h2>: o PageShell já rende o <h1> (WCAG 1.3.1). */}
        <Card.Title asChild>
          <h2>A regra</h2>
        </Card.Title>
        <Card.Description>
          The name identifies the guardrail in the catalog and in the audit trail; the terms are what it looks for.
        </Card.Description>
      </Card.Header>

      <Card.Body className="space-y-5">
        <FormField id="guardrail-name" invalid={Boolean(fieldProblems.name)}>
          <FormField.Label>Name</FormField.Label>
          <FormField.Control>
            <Input
              aria-label="Name"
              size="md"
              value={draft.name}
              placeholder="termos-internos"
              onChange={(e) => onDraftChange({ name: e.target.value })}
              onBlur={() => onFieldTouched('name')}
            />
          </FormField.Control>
          {fieldProblems.name ? <FormField.Error>{fieldProblems.name}</FormField.Error> : null}
        </FormField>

        <FormField id="guardrail-terms" invalid={Boolean(fieldProblems.terms)}>
          <FormField.Label>Terms to block</FormField.Label>
          <FormField.Control>
            <Textarea
              aria-label="Terms to block"
              rows={4}
              className="font-mono"
              value={termsText}
              placeholder={'projeto-fenix\ncodinome-interno'}
              onChange={(e) => onTermsTextChange(e.target.value)}
              onBlur={() => onFieldTouched('terms')}
            />
          </FormField.Control>
          {fieldProblems.terms ? (
            <FormField.Error>{fieldProblems.terms}</FormField.Error>
          ) : (
            <FormField.Hint>One term per line.</FormField.Hint>
          )}
        </FormField>

        <FormField id="guardrail-action">
          <FormField.Label>What to do on a match</FormField.Label>
          <FormField.Control>
            <Select
              value={draft.action}
              onValueChange={(v) => onDraftChange({ action: v as GuardrailDraft['action'] })}
            >
              <Select.Trigger aria-label="What to do on a match">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="block">Block the message</Select.Item>
                <Select.Item value="modify">Substituir o termo</Select.Item>
              </Select.Content>
            </Select>
          </FormField.Control>
        </FormField>

        {/* Só existe quando a ação é `modify`: um campo cinza aqui sugeriria que a substituição
            vale mesmo quando a regra bloqueia. */}
        {draft.action === 'modify' ? (
          <FormField id="guardrail-replacement" invalid={Boolean(fieldProblems.replacement)}>
            <FormField.Label>Substituir por</FormField.Label>
            <FormField.Control>
              <Input
                aria-label="Substituir por"
                size="md"
                value={draft.replacement}
                onChange={(e) => onDraftChange({ replacement: e.target.value })}
                onBlur={() => onFieldTouched('replacement')}
              />
            </FormField.Control>
            {fieldProblems.replacement ? (
              <FormField.Error>{fieldProblems.replacement}</FormField.Error>
            ) : null}
          </FormField>
        ) : null}
      </Card.Body>
    </Card>
  );
}
