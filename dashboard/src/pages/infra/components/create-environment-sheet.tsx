import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button, Checkbox, Input, Label, Select } from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { useCreateEnvironment } from '@/hooks/mutations/use-environments';
import { useEngineApi } from '@/hooks/use-api';
import type { Environment, Project } from '@/lib/api/types';

interface CreateEnvironmentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * M20: when the modal opens from a project-scoped page
   * (/projects/:name/environments), the project is fixed by the route —
   * pre-select it and lock the picker instead of asking the user to pick a
   * project they're already inside.
   */
  defaultProject?: string;
  onCreated?: (env: Environment) => void;
}

const NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * CreateEnvironmentSheet — M2 v1.2 T5.1 (2026-06-07).
 *
 * Adds a project picker (canonical 3-segment namespace requires
 * `project` post-M2). Behaviour:
 *
 *   - 0 projects → EC-2 empty state: Alert + CTA "Create a project →"
 *     route to /projects. Submit button absent (the form is meaningless
 *     without a project).
 *   - 1 project  → auto-fill the picker + disable change. User just
 *     types the env name; one click less for the common case.
 *   - ≥2 projects → user MUST pick. Submit disabled until a non-empty
 *     project is selected.
 *
 * Body POST now includes `project` (per T4.1 backend contract). Empty
 * project would return 400 MISSING_FIELD from the backend; the front-end
 * gate prevents that round-trip.
 */
export function CreateEnvironmentSheet({ open, onOpenChange, defaultProject, onCreated }: CreateEnvironmentSheetProps) {
  const createEnvironment = useCreateEnvironment();
  const projectLocked = !!defaultProject;
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [isProtected, setIsProtected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: projectsData, error: projectsError } = useEngineApi<{ projects: Project[] }>('/api/v1/projects');
  const projects = projectsData?.projects ?? [];
  const hasProjects = projects.length > 0;
  const singleProject = projects.length === 1;

  // Auto-fill when exactly 1 project. Reset when the sheet re-opens.
  useEffect(() => {
    if (open && projectLocked) {
      // M20: project fixed by the route — always pre-select it.
      setProject(defaultProject);
      return;
    }
    if (open && singleProject) {
      setProject(projects[0]!.name);
    }
    if (open && !singleProject) {
      // Don't clobber a previously-picked value mid-session, but reset
      // when the sheet re-opens on a tenant with multiple projects.
      setProject((curr) => (curr && projects.some((p) => p.name === curr) ? curr : ''));
    }
  }, [open, singleProject, projects, projectLocked, defaultProject]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!NAME_PATTERN.test(name)) {
      setError('Name must be lowercase, 3-40 chars, hyphens allowed.');
      return;
    }
    if (!project) {
      setError('Pick a project for the environment.');
      return;
    }
    setSubmitting(true);
    try {
      // B-059 — passa pelo hook de mutation em vez do engineFetch cru. O POST era
      // identico; o que faltava era o onSuccess que invalida as DUAS arvores de
      // chave (queryKeys.environments e o legado ['engine', ...] que as paginas
      // ainda leem). Sem ele, criar um environment nao atualizava a tabela.
      const res = await createEnvironment.mutateAsync({ name, project, protected: isProtected });
      if (res === null) {
        setError("Couldn't create environment. Try again in a moment.");
        return;
      }
      onCreated?.(res);
      setName('');
      setProject(defaultProject ?? (singleProject ? projects[0]!.name : ''));
      setIsProtected(false);
      onOpenChange(false);
    } catch (e) {
      // T0.1 TCIA — sponsor critério #6
      setError(
        e instanceof Error
          ? `Create environment failed: ${e.message}. No environment was created. Retry, or contact support if it persists.`
          : 'Create environment failed. No environment was created. Retry, or contact support if it persists.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // T4.1 finding 1.1 (P1): projects fetch failed → render error state
  // BEFORE the empty/form decision. Without this branch a 5xx from
  // /api/v1/projects renders an empty form the user can't submit (no
  // project to pick), masking the true root cause.
  if (projectsError) {
    return (
      <AppModal
        open={open}
        onClose={() => onOpenChange(false)}
        title="New environment"
        description="We couldn't load the project list."
        size="md"
        footer={
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        }
      >
        <Alert
          intent="destructive"
          title="Couldn't load projects"
          description="The dashboard couldn't fetch your projects. Check connectivity and reopen this panel."
        />
      </AppModal>
    );
  }

  // EC-2: zero projects → render an actionable empty state instead of
  // a form the user cannot submit.
  if (!hasProjects && projectsData !== undefined) {
    return (
      <AppModal
        open={open}
        onClose={() => onOpenChange(false)}
        title="New environment"
        description="You need a project before creating an environment."
        size="md"
        footer={
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-4">
          <Alert
            intent="info"
            title="No projects yet"
            description="Environments live inside projects. Create your first project to add an environment to it."
          />
          <div data-testid="create-env-empty-state-cta">
            <Button asChild>
              <Link to="/projects">Create a project →</Link>
            </Button>
          </div>
        </div>
      </AppModal>
    );
  }

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title="New environment"
      description="Environments are isolated namespaces for your deployments."
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-env-form" disabled={submitting || !project || !name}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Creating…' : 'Create environment'}
          </Button>
        </>
      }
    >
      <form id="create-env-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="env-project">Project</Label>
              <Select
                value={project}
                onValueChange={(v) => setProject(v)}
                disabled={projectLocked || singleProject || submitting}
              >
                <Select.Trigger id="env-project" data-testid="env-project-trigger">
                  <Select.Value placeholder="Pick a project" />
                </Select.Trigger>
                <Select.Content>
                  {projects.map((p) => (
                    <Select.Item key={p.name} value={p.name}>
                      {p.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              {projectLocked ? (
                <p className="text-label text-muted-foreground mt-1">
                  Creating in {defaultProject}.
                </p>
              ) : singleProject ? (
                <p className="text-label text-muted-foreground mt-1">
                  Only one project — auto-selected.
                </p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="env-name">Name</Label>
              <Input
                id="env-name"
                type="text"
                placeholder="staging"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                autoFocus
                required
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="env-protected"
                checked={isProtected}
                onCheckedChange={(c) => setIsProtected(c === true)}
              />
              <div>
                <Label htmlFor="env-protected">Protected</Label>
                <p className="text-label text-muted-foreground">
                  Requires explicit promote/rollback confirmation. Use for production-like envs.
                </p>
              </div>
            </div>

        {error && <Alert intent="destructive" description={error} />}
      </form>
    </AppModal>
  );
}
