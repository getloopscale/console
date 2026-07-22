import { AnnotationInput, Button } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { SCORE_CONFIGS, type ScoreConfig } from './score-configs';
import type { AnnotationValues } from './to-resolve-body';

/**
 * M12 — the resolve modal body: one `@usetheo/ui` AnnotationInput per
 * score-config (replaces the bespoke label/score/note inputs). Fully
 * controlled — the parent owns the `values` map and the resolve submission.
 * Rendered inside the centered `AppModal` (Evaluate UX standardization —
 * resolve is a centered modal, not a lateral Sheet).
 */
interface ResolveFormProps {
  values: AnnotationValues;
  onChange: (next: AnnotationValues) => void;
  /** The assembled body has a non-empty required label (gates the Resolve button). */
  canResolve: boolean;
  pending: boolean;
  /** Typed error message to surface, or null. */
  error: string | null;
  onCancel: () => void;
  onResolve: () => void;
}

/** Render one AnnotationInput bound to the value held under its config key. */
function renderInput(sc: ScoreConfig, values: AnnotationValues, onChange: (next: AnnotationValues) => void) {
  const set = (value: string | number | null) => onChange({ ...values, [sc.key]: value });
  const common = { name: sc.name, id: `resolve-${sc.key}`, description: sc.description, required: sc.required } as const;

  if (sc.config.type === 'categorical') {
    const value = typeof values[sc.key] === 'string' ? (values[sc.key] as string) : null;
    return <AnnotationInput key={sc.key} {...common} config={sc.config} value={value} onValueChange={set} />;
  }
  if (sc.config.type === 'continuous') {
    const value = typeof values[sc.key] === 'number' ? (values[sc.key] as number) : null;
    return <AnnotationInput key={sc.key} {...common} config={sc.config} value={value} onValueChange={set} />;
  }
  const value = typeof values[sc.key] === 'string' ? (values[sc.key] as string) : null;
  return <AnnotationInput key={sc.key} {...common} config={sc.config} value={value} onValueChange={set} />;
}

export function ResolveForm({ values, onChange, canResolve, pending, error, onCancel, onResolve }: ResolveFormProps) {
  return (
    <div className="space-y-4">
      {SCORE_CONFIGS.map((sc) => renderInput(sc, values, onChange))}
      {error !== null ? (
        <Alert intent="warning" title="Could not resolve" data-testid="resolve-error">
          {error}
        </Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canResolve || pending} onClick={onResolve}>
          {pending ? 'Resolving…' : 'Resolve'}
        </Button>
      </div>
    </div>
  );
}
