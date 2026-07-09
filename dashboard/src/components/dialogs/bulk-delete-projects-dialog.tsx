import { useEffect, useRef, useState } from 'react';

import { Button, Dialog, Input, Label } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { useBulkDeleteProjects } from '@/hooks/use-bulk-delete-projects';

/**
 * BulkDeleteProjectsDialog (J-07 D4) — type-to-confirm bulk delete for the
 * selected projects. Mirrors the DeleteEnvironmentDialog type-to-confirm pattern
 * (J-22), but the confirm phrase is the blast-radius sentence "delete N projects"
 * (case-sensitive) so the user acknowledges HOW MANY before the button enables.
 *
 * Best-effort: the mutation deletes each project independently and reports which
 * failed — the dialog surfaces the partial failure honestly instead of a silent
 * all-or-nothing (never claims success when some deletes failed).
 */
export interface BulkDeleteProjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectNames: string[];
  /** Called after the bulk delete completes with ZERO failures. */
  onDeleted?: () => void;
}

export function confirmPhrase(count: number): string {
  return `delete ${count} project${count === 1 ? '' : 's'}`;
}

export function BulkDeleteProjectsDialog({
  open,
  onOpenChange,
  projectNames,
  onDeleted,
}: BulkDeleteProjectsDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const bulkDelete = useBulkDeleteProjects();

  const phrase = confirmPhrase(projectNames.length);
  const matches = confirmText === phrase;

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setError(null);
    }
  }, [open, projectNames.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    try {
      const result = await bulkDelete.mutateAsync(projectNames);
      if (result.failed.length > 0) {
        const names = result.failed.map((f) => f.name).join(', ');
        setError(
          `Deleted ${result.succeeded.length} of ${projectNames.length}. ` +
            `Couldn't delete: ${names}. They may have an active deploy — try again.`,
        );
        return; // partial failure — keep the dialog open, do NOT claim success
      }
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? `Bulk delete failed: ${err.message}.` : 'Bulk delete failed.');
    }
  };

  const count = projectNames.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <form onSubmit={handleSubmit}>
          <Dialog.Header>
            <Dialog.Title>Delete {count} project{count === 1 ? '' : 's'}?</Dialog.Title>
          </Dialog.Header>
          <div className="space-y-4 py-2">
            <p className="text-body-sm text-muted-foreground">
              This permanently deletes {count === 1 ? 'this project' : `these ${count} projects`} and
              all of their environments, deployments, and domains. This cannot be undone.
            </p>
            {error && <Alert intent="destructive" description={error} />}
            <div className="space-y-1.5">
              <Label htmlFor="bulk-delete-confirm">
                Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to confirm
              </Label>
              <Input
                id="bulk-delete-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                aria-label="Type-to-confirm bulk delete"
              />
            </div>
          </div>
          <Dialog.Footer>
            <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!matches || bulkDelete.isPending}
            >
              {bulkDelete.isPending ? 'Deleting…' : `Delete ${count} project${count === 1 ? '' : 's'}`}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
