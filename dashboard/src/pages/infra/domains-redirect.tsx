import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { useProjects } from '@/hooks/projects/use-projects';

/**
 * /domains was the list of every domain of the organization. A domain only exists attached to
 * an environment of a project, so the list now lives at /projects/:name/domains, and this
 * address sends whoever still has it to the right place.
 *
 * With exactly one project there is one place to go, and the query string goes along so that
 * `?action=add` still opens the form. With none or several the user has to pick, so they land
 * on the list of projects.
 */
export function DomainsRedirect() {
  const { search } = useLocation();
  const { projects, loading } = useProjects();

  // An empty list while loading reads as "no project": wait before choosing.
  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="size-6 animate-spin text-primary" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (projects.length === 1) {
    return <Navigate to={`/projects/${encodeURIComponent(projects[0].name)}/domains${search}`} replace />;
  }
  return <Navigate to="/projects" replace />;
}
