import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Skeleton,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/traces. Read the workspace's traces and manage their human-in-the-loop
 * metadata: tags + annotations (create/delete) via the read+write lens BFF
 * (`/v1/dashboard/lens/traces/{id}/tags|annotations`). The trace/session BODY is read-only
 * (spans arrive via OTLP) — ADR-3: only the metadata is browser-authored.
 */

interface Trace {
  traceId: string;
  name?: string;
  status?: string;
}
interface TracesResult {
  traces: Trace[];
}
interface TagsResult {
  tags: string[];
}

export function LensTracesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Lens · Traces'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [openID, setOpenID] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces'] as const,
    queryFn: () => cloudFetch<TracesResult>('/v1/dashboard/lens/traces'),
  });

  const tagsKey = ['cloud', '/v1/dashboard/lens/traces', openID, 'tags'] as const;
  const tags = useQuery({
    queryKey: tagsKey,
    queryFn: () => cloudFetch<TagsResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/tags`),
    enabled: openID !== null,
  });
  const invalidateTags = () => void queryClient.invalidateQueries({ queryKey: tagsKey });

  const addTag = useMutation({
    mutationFn: (t: string) =>
      cloudFetch<TagsResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tag: t }),
      }),
    onSuccess: () => {
      setTag('');
      invalidateTags();
    },
  });

  const removeTag = useMutation({
    mutationFn: (t: string) =>
      cloudFetch<TagsResult>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/tags?tag=${encodeURIComponent(t)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      setPendingTag(null);
      invalidateTags();
    },
  });

  const addAnnotation = useMutation({
    mutationFn: (n: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/annotations`, {
        method: 'POST',
        body: JSON.stringify({ note: n }),
      }),
    onSuccess: () => setNote(''),
  });

  const columns: DataTableColumn<Trace>[] = [
    {
      key: 'traceId',
      label: 'Trace',
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setOpenID(row.traceId)} aria-label={`Open ${row.traceId}`}>
          <span className="font-mono text-sm">{row.traceId}</span>
        </Button>
      ),
    },
    { key: 'name', label: 'Name', render: (row) => <span>{row.name ?? '—'}</span> },
    { key: 'status', label: 'Status', render: (row) => <span>{row.status ?? '—'}</span> },
  ];

  const traces = query.data?.traces ?? [];
  const currentTags = tags.data?.tags ?? [];

  return (
    <>
      <PageShell title="Traces" description="Explore executions and manage their tags & annotations.">
        <div className="space-y-6">
          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load traces">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : traces.length === 0 ? (
            <EmptyState title="No traces yet" description="Instrument an agent and send spans to see executions here." />
          ) : (
            <Card>
              <DataTable columns={columns} data={traces} rowKey={(row) => row.traceId} />
            </Card>
          )}

          {openID !== null ? (
            <Card>
              <Card.Header>
                <h2 className="text-sm font-medium">Metadata · {openID}</h2>
                <Button variant="ghost" size="sm" onClick={() => setOpenID(null)} aria-label="Close metadata">
                  Close
                </Button>
              </Card.Header>
              <Card.Body>
                <div className="space-y-4">
                  <div>
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (tag.trim()) addTag.mutate(tag.trim());
                      }}
                    >
                      <div className="flex-1">
                        <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add a tag" aria-label="New tag" />
                      </div>
                      <Button type="submit" disabled={!tag.trim() || addTag.isPending}>
                        Add tag
                      </Button>
                    </form>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {currentTags.map((t) => (
                        <li key={t} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
                          <span>{t}</span>
                          <Button variant="ghost" size="sm" onClick={() => setPendingTag(t)} aria-label={`Remove tag ${t}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (note.trim()) addAnnotation.mutate(note.trim());
                    }}
                  >
                    <div className="flex-1">
                      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an annotation note" aria-label="New annotation" />
                    </div>
                    <Button type="submit" disabled={!note.trim() || addAnnotation.isPending}>
                      Add note
                    </Button>
                  </form>
                </div>
              </Card.Body>
            </Card>
          ) : null}
        </div>
      </PageShell>

      {pendingTag !== null ? (
        <ConfirmDialog
          open={pendingTag !== null}
          onOpenChange={(o) => !o && setPendingTag(null)}
          title={`Remove tag "${pendingTag}"?`}
          description={<p className="text-sm">This removes the tag from the trace.</p>}
          confirmLabel={removeTag.isPending ? 'Removing…' : 'Remove tag'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={removeTag.isPending}
          onConfirm={() => removeTag.mutate(pendingTag)}
        />
      ) : null}
    </>
  );
}
