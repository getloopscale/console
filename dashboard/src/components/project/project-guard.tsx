import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FolderKanban, Loader2 } from 'lucide-react';
import { Button, EmptyState, PageShell } from '@getloopscale/ui';
import { useProjects } from '@/hooks/projects/use-projects';

/**
 * ProjectGuard — wraps every per-project sub-route so a non-existent
 * project name in the URL collapses to a clean "Project not found" state
 * INSTEAD of the sub-view rendering functional UI on top of an empty
 * data set.
 *
 * Red Team loop-console#93 absorption (2026-06-27): the Overview already
 * does this check inline (project-detail.tsx:65) but every sibling
 * sub-route (Secrets / Previews / Logs / Status / Scale / Readiness)
 * rendered fully because the backend handlers return 200 + empty list
 * for an unknown project (separately addressed at engine layer per #92).
 * Defense-in-depth: even when the engine ships the proper 404, sub-views
 * MUST not race the data fetch — checking the project list FIRST (which
 * useProjects already caches per QueryClient) gives an instant verdict
 * without an extra network hop.
 *
 * Pattern: identical PageShell + EmptyState + "Back to projects" CTA as
 * `project-detail.tsx` § not-found branch (single source of truth for
 * the not-found shape — invariant per CLAUDE.md "Implemented but not
 * wired" pattern).
 */
export interface ProjectGuardProps {
  children: ReactNode;
}

export function ProjectGuard({ children }: ProjectGuardProps) {
  const { name = '' } = useParams<{ name: string }>();
  const { projects, loading } = useProjects();

  if (loading) {
    return (
      <PageShell title={name}>
        <div className="flex items-center justify-center py-12">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-label="Loading project"
          />
        </div>
      </PageShell>
    );
  }

  const project = projects.find((p) => p.name === name);
  if (!project) {
    return (
      <PageShell title="Project not found">
        <EmptyState
          icon={FolderKanban}
          title={`No project named "${name}"`}
          description="It may have been deleted, or the URL is wrong."
          action={
            <Button asChild variant="secondary">
              <Link to="/projects">
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to projects
              </Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  return <>{children}</>;
}
