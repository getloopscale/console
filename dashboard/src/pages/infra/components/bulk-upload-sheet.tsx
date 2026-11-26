import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Sheet, Textarea } from '@getloopscale/ui';
import { Alert } from '@/components/ui/alert-guard';
import {
  useBulkUploadSecrets,
  type BulkUploadResult,
} from '@/hooks/mutations/use-secrets-mutations';
import { parseDotenv, type DotenvParseResult } from '@/pages/infra/components/dotenv';

interface BulkUploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  /** Default env(s) the bulk entries get scoped to. */
  defaultEnvs?: string[];
  availableEnvs?: string[];
  onUploaded?: (createdCount: number) => void;
}

type DotenvEntry = DotenvParseResult['entries'][number];

/** What the API said about one key, across the first upload and any retries. */
type KeyOutcome = { saved: true } | { saved: false; error: string };

/**
 * POST /secrets/bulk answers 200 and reports each item's own status, so a key is saved only when
 * its item says `created`. A key the answer does not mention was not saved either.
 */
function outcomesFor(
  sent: readonly DotenvEntry[],
  result: BulkUploadResult | null,
): Record<string, KeyOutcome> {
  const items = new Map((result?.results ?? []).map((r) => [r.name, r]));
  const outcomes: Record<string, KeyOutcome> = {};
  for (const entry of sent) {
    const item = items.get(entry.key);
    if (item?.status === 'created') {
      outcomes[entry.key] = { saved: true };
    } else {
      outcomes[entry.key] = {
        saved: false,
        error: item ? (item.error ?? 'the API gave no reason') : 'the API did not answer for this key',
      };
    }
  }
  return outcomes;
}

/**
 * J-22 T3.5 — BulkUploadSheet.
 *
 * Client-side `.env` parser (lib/dotenv.ts) renders a preview with per-key
 * status + warnings BEFORE the user submits. Submit calls the T1.1 bulk
 * endpoint via useBulkUploadSecrets (T2.2) — atomic per-key savepoints
 * (EC-9), size cap 100 (EC-18), plan limit gate (T1.3) all enforced
 * server-side.
 *
 * EC-17 quoted values + comments handled by the parser.
 * EC-14 duplicate-key pre-flight warning surfaced as inline warning row.
 *
 * When the API reports some keys failed, the sheet stays open with a saved/failed row per key and
 * the primary button retries only the failed keys, so a saved key is never sent twice. The .env
 * content and env scope are locked until every key is saved or the sheet is closed.
 */
export function BulkUploadSheet({
  open,
  onOpenChange,
  project,
  defaultEnvs = ['production'],
  // Canonical PaaS lexicon (ADR-Q6 of qa-dogfood-cleanup-2026-06-21):
  // preview + production are the two permanent envs per project.
  // Legacy `'staging'` was off-model (#127, 2026-06-21 QA dogfooding).
  availableEnvs = ['preview', 'production'],
  onUploaded,
}: BulkUploadSheetProps) {
  const [source, setSource] = useState('');
  const [selectedEnvs, setSelectedEnvs] = useState<string[]>(defaultEnvs);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, KeyOutcome> | null>(null);
  const bulkUpload = useBulkUploadSecrets();
  const submitting = bulkUpload.isPending;

  const parsed = useMemo(() => parseDotenv(source), [source]);
  const canSubmit = parsed.entries.length > 0 && selectedEnvs.length > 0;
  const failedCount = outcomes ? Object.values(outcomes).filter((o) => !o.saved).length : 0;

  const handleOpenChange = (next: boolean) => {
    if (!next && outcomes) {
      // Some keys are already saved: reopening must not offer to upload them again.
      setOutcomes(null);
      setSource('');
    }
    onOpenChange(next);
  };

  const toggleEnv = (env: string) => {
    setSelectedEnvs((current) =>
      current.includes(env) ? current.filter((e) => e !== env) : [...current, env],
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);
    const toSend = outcomes
      ? parsed.entries.filter((e) => outcomes[e.key]?.saved === false)
      : parsed.entries;
    try {
      const result = await bulkUpload.mutateAsync({
        project,
        secrets: toSend.map((e) => ({
          name: e.key,
          value: e.value,
          envs: selectedEnvs,
        })),
      });
      const merged = { ...outcomes, ...outcomesFor(toSend, result) };
      const all = Object.values(merged);
      if (all.some((o) => !o.saved)) {
        setOutcomes(merged);
        return;
      }
      setOutcomes(null);
      setSource('');
      onOpenChange(false);
      onUploaded?.(all.length);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `Bulk upload failed: ${err.message}. No partial entries were stored.`
          : 'Bulk upload failed.',
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Sheet.Content side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <Sheet.Header className="px-6 py-5 border-b border-border/60">
          <Sheet.Title>Bulk upload .env</Sheet.Title>
          <Sheet.Description>
            Paste your .env content. We preview before posting; max 100 keys per batch.
          </Sheet.Description>
        </Sheet.Header>

        <Sheet.Body className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label htmlFor="dotenv-source" className="text-body-sm font-medium">
              .env content
            </label>
            <Textarea
              id="dotenv-source"
              rows={10}
              placeholder={'DATABASE_URL=postgres://...\nSTRIPE_KEY="sk_live_..."'}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              readOnly={outcomes !== null}
              className="mt-1 font-mono text-body-sm"
            />
          </div>

          <fieldset>
            <legend className="text-body-sm font-medium">Scope to envs</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {availableEnvs.map((env) => (
                <label key={env} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={selectedEnvs.includes(env)}
                    onChange={() => toggleEnv(env)}
                    disabled={outcomes !== null}
                    aria-label={`Scope to ${env}`}
                  />
                  {env}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2" aria-label="Preview">
            <div className="text-body-sm font-medium">
              Preview: {parsed.entries.length} entries · {parsed.warnings.length} warnings
            </div>
            {parsed.warnings.map((w) => (
              <div
                key={`${w.line}-${w.message}`}
                className="text-label text-amber-600 dark:text-amber-400"
              >
                Line {w.line}: {w.message}
              </div>
            ))}
            {outcomes ? (
              <ul aria-label="Upload results" className="text-label font-mono">
                {Object.entries(outcomes).map(([key, outcome]) => (
                  <li
                    key={key}
                    className={outcome.saved ? 'text-muted-foreground' : 'text-destructive'}
                  >
                    {outcome.saved ? `${key}: saved` : `${key}: failed, ${outcome.error}`}
                  </li>
                ))}
              </ul>
            ) : parsed.entries.length > 0 && (
              <ul className="text-label font-mono text-muted-foreground">
                {parsed.entries.map((e) => (
                  <li key={e.key}>
                    {e.key}=••••••••
                  </li>
                ))}
              </ul>
            )}
          </div>

          {submitError && <Alert intent="destructive" description={submitError} />}
        </Sheet.Body>

        <Sheet.Footer className="px-6 py-4 border-t border-border/60 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Uploading…
              </>
            ) : outcomes ? (
              `Retry failed (${failedCount})`
            ) : (
              `Upload ${parsed.entries.length} secret(s)`
            )}
          </Button>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet>
  );
}
