import { Badge, Card, PageShell, Skeleton } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useServiceVersions, type ServiceStatus } from '@/hooks/use-service-versions';

/**
 * /status (M21) — the detail behind the sidebar's health indicator: one row per
 * data-plane service with its state, its version when there IS one, and when it
 * was built. The aggregate's own collection time is shown once, at the top.
 *
 * The central invariant is structural, not editorial: in the `unreachable` /
 * `timeout` branches below, `s.version` does not EXIST on the narrowed type
 * (ADR D3), so this page cannot show a stale version even by accident.
 */
export function StatusPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  const { data, isPending } = useServiceVersions();

  return (
    <PageShell
      title="Service versions"
      description="What each platform service reports about itself."
      onTitleChange={setPageTitle}
    >
      {isPending ? <Skeleton className="h-24 w-full" /> : <Report data={data} />}
    </PageShell>
  );
}

function Report({ data }: { data: { collected_at: string; services: readonly ServiceStatus[] } | null | undefined }) {
  // Never an empty list in silence: not knowing is itself the news (the failure
  // mode this milestone exists to remove).
  if (!data) {
    return (
      <Card>
        <Card.Body>
          <p role="alert">Could not read service status.</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Body>
        <p className="text-body-sm text-muted-foreground" data-testid="collected-at">
          Checked at {formatInstant(data.collected_at)}
        </p>
        {data.services.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No services configured.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {data.services.map((s) => (
              <li key={s.name} data-testid={`service-row-${s.name}`} className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-label text-foreground">{s.name}</span>
                {renderState(s)}
              </li>
            ))}
          </ul>
        )}
      </Card.Body>
    </Card>
  );
}

/** The state cell of one row. One branch per variant of the union. */
function renderState(s: ServiceStatus) {
  switch (s.state) {
    case 'ok':
      return (
        <>
          <Badge variant="success">ok</Badge>
          <span className="font-mono text-label">v{s.version}</span>
          {s.built_at ? <span className="text-label text-muted-foreground">built {formatInstant(s.built_at)}</span> : null}
        </>
      );
    case 'unreachable':
      return (
        <>
          <Badge variant="destructive">unreachable</Badge>
          <span className="text-label text-muted-foreground">{s.reason}</span>
        </>
      );
    case 'timeout':
      return (
        <>
          <Badge variant="warning">timeout</Badge>
          <span className="text-label text-muted-foreground">{s.reason ?? 'timed out'}</span>
        </>
      );
    case 'not_deployed':
      return <Badge variant="outline">not deployed</Badge>;
    // ADR D11: do NOT throw. The `never` parameter keeps compile-time exhaustiveness
    // (dropping a case above breaks `tsc`), while the runtime degrades to showing the
    // literal state that arrived. Throwing here would blank the entire page — taking
    // the healthy services with it — because this payload comes from the wire.
    default:
      return <Badge variant="outline">{unknownStateOf(s)}</Badge>;
  }
}

function unknownStateOf(s: never): string {
  return (s as { state: string }).state;
}

/**
 * Render an instant as `YYYY-MM-DD HH:mm UTC` — deterministic, and readable next to
 * the other one on the page. A value the gateway could not have produced is shown
 * verbatim rather than crashing the page, for the same reason as D11.
 */
function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
