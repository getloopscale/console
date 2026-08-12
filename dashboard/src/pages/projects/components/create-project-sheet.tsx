import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Input, Label } from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { useCreateProject } from '@/hooks/projects/use-create-project';
import type { Project } from '@/lib/api/types';

interface CreateProjectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: Project) => void;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * CreateProjectSheet — the "New project" form, rendered as a centered AppModal
 * (M17: migrated off the lateral Sheet per the owner's "no lateral panels"
 * mandate). The name is kept for import stability; the surface is a modal.
 */
export function CreateProjectSheet({ open, onOpenChange, onCreated }: CreateProjectSheetProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // B-244 — the request lives in the domain hook. `isPending` replaces a hand-kept
  // `submitting` flag, and the hook invalidates the projects list on success, which this form
  // used to leave to whoever passed `onCreated`.
  const createProject = useCreateProject();
  const submitting = createProject.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!SLUG_PATTERN.test(name)) {
      setError('Name must be lowercase, 3-40 chars, start with letter, hyphens allowed.');
      return;
    }
    try {
      // B-260 — typed with `ProjectCreateInput`, the type that described this payload and was
      // imported by nobody. The description is now checked against what is sent.
      const res = await createProject.mutateAsync({ name });
      onCreated?.(res);
      setName('');
      onOpenChange(false);
    } catch (e) {
      // T0.1 TCIA — sponsor critério #6. With `throwOnError` the failure ARRIVES here instead
      // of resolving `null`, so the message can name it rather than guess (B-235).
      setError(
        e instanceof Error
          ? `Create project failed: ${e.message}. No project was created. Retry, or contact support if it persists.`
          : 'Create project failed. No project was created. Retry, or contact support if it persists.',
      );
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title="New project"
      description="Give your project a name. Connect it to a repository in the next step."
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-project-form" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                type="text"
                placeholder="my-app"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                autoFocus
                required
                // Red Team theo-cloud#83 closure: tie the input to its
                // inline help + (when present) the destructive Alert so
                // screen readers announce the validation error when the
                // field has focus instead of forcing the user to hunt
                // for the detached Alert region.
                aria-invalid={error ? true : undefined}
                aria-describedby={
                  error
                    ? 'project-name-help project-name-error'
                    : 'project-name-help'
                }
              />
              <p
                id="project-name-help"
                className="mt-1 text-label text-muted-foreground"
              >
                Lowercase, 3-40 chars, hyphens allowed. Used in URLs.
              </p>
            </div>

        {error && (
          <Alert
            id="project-name-error"
            intent="destructive"
            description={error}
          />
        )}
      </form>
    </AppModal>
  );
}
