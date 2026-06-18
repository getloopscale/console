import { useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { Alert, Button, Dialog, Input, Label } from '@usetheo/ui';
import { ensureSSEToken } from '@/lib/api';
import { API_URL } from '@/lib/config';
import type { Build, RollbackResponse } from '@/lib/api/types';

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  targetBuild: Build;
  onRolledBack?: (response: RollbackResponse) => void;
}

const CONFIRMATION_PHRASE = 'rollback production';

export function RollbackDialog({
  open,
  onOpenChange,
  projectName,
  targetBuild,
  onRolledBack,
}: RollbackDialogProps) {
  const [phrase, setPhrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProd = targetBuild.environment === 'production';
  const requiresPhrase = isProd;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requiresPhrase && phrase !== CONFIRMATION_PHRASE) {
      setError(`Type "${CONFIRMATION_PHRASE}" exactly to confirm.`);
      return;
    }
    setSubmitting(true);
    try {
      // LIVE-caught 2026-06-18: engineFetch swallows non-OK responses
      // → "Couldn't trigger rollback" generic message. Rollback is a
      // critical destructive op; the user MUST see why it failed
      // (sync timeout, no previous release, network error, etc).
      // Direct fetch + parse the canonical TheoError body so the user
      // gets actionable feedback.
      const token = await ensureSSEToken();
      if (!token) {
        setError('Session expired. Sign in again and retry the rollback.');
        return;
      }
      const resp = await fetch(
        `${API_URL}/engine/api/v1/projects/${encodeURIComponent(projectName)}/rollback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            environment: targetBuild.environment,
            build_id: targetBuild.build_id,
          }),
          credentials: 'include',
        },
      );
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null) as
          | { message?: string; code?: string; error?: string }
          | null;
        setError(formatRollbackError(resp.status, errBody));
        return;
      }
      const res = (await resp.json()) as RollbackResponse;
      onRolledBack?.(res);
      setPhrase('');
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Rollback failed: ${e.message}. The current release remains active. Retry, or contact support if it persists.`
          : 'Rollback failed: network error. The current release remains active. Check connection and retry.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const sha = targetBuild.commit_sha.slice(0, 7);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title className="inline-flex items-center gap-2">
            <Undo2 className="size-5 text-warning" aria-hidden="true" />
            Rollback to {sha}
          </Dialog.Title>
          <Dialog.Description>
            This will replace the current release in <span className="font-mono">{targetBuild.environment}</span> with the build from commit <span className="font-mono">{sha}</span>.
          </Dialog.Description>
        </Dialog.Header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Alert
            intent="warning"
            description={`Traffic will switch within a few seconds. Existing connections drain gracefully.`}
          />

          {requiresPhrase && (
            <div>
              <Label htmlFor="rollback-phrase">
                Type <span className="font-mono">{CONFIRMATION_PHRASE}</span> to confirm
              </Label>
              <Input
                id="rollback-phrase"
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          {error && <Alert intent="destructive" description={error} />}

          <Dialog.Footer>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitting || (requiresPhrase && phrase !== CONFIRMATION_PHRASE)}
            >
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {submitting ? 'Rolling back…' : `Rollback to ${sha}`}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}

/**
 * Translate a canonical TheoError body into actionable user-facing copy.
 * Uses product-language only (no internal terms per Cross-Project Rule 9):
 * we say "deployment infrastructure", never "ArgoCD" or "Kubernetes".
 */
function formatRollbackError(
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const code = body?.code ?? '';
  const detail = body?.message ?? body?.error ?? '';

  // Canonical codes mapped to actionable copy.
  if (code === 'NO_ACTIVE_RELEASE' || /no active release/i.test(detail)) {
    return 'No active release to rollback. Deploy something first, then try again.';
  }
  if (code === 'NO_PREVIOUS_RELEASE' || /no previous release/i.test(detail)) {
    return 'No previous release available. This build is the first deploy — nothing to fall back to.';
  }
  if (/sync wait failed/i.test(detail) || /sync timeout/i.test(detail)) {
    return 'Rollback started but the deployment infrastructure did not finish in time. The current release is in a degraded state — please retry in a few seconds. If the issue persists, contact support.';
  }
  if (/sync trigger failed/i.test(detail)) {
    return 'Rollback could not contact the deployment infrastructure. The current release remains active. Retry, or contact support if it persists.';
  }
  if (code === 'MISSING_FIELD' || status === 400) {
    return detail
      ? `Rollback rejected: ${detail}. Refresh the page and retry.`
      : 'Rollback rejected: the request was malformed. Refresh the page and retry.';
  }
  if (status === 401) {
    return 'Session expired. Sign in again and retry the rollback.';
  }
  if (status === 403) {
    return 'You do not have permission to rollback this project.';
  }
  if (status === 404) {
    return 'Project or build not found. The build may have been deleted — refresh the page.';
  }
  if (status >= 500) {
    return detail
      ? `Rollback failed (HTTP ${status}): ${detail}. The current release remains active. Retry, or contact support if it persists.`
      : `Rollback failed (HTTP ${status}). The current release remains active. Retry, or contact support if it persists.`;
  }
  return detail
    ? `Rollback failed (HTTP ${status}): ${detail}`
    : `Rollback failed (HTTP ${status}). Please retry.`;
}
