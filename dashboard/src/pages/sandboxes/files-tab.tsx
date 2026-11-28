import { useState } from 'react';
import { Download, File, Folder } from 'lucide-react';
import { Card, Table } from '@getloopscale/ui';
import { useSandboxFiles } from '@/hooks/sandboxes/use-sandboxes';
import { getApiBase } from '@/lib/http/api';
import {
  WORKSPACE_ROOT,
  childPath,
  crumbs,
  encodedFilePath,
  sortedEntries,
} from '@/lib/sandboxes/workspace-paths';
import { formatBytes } from '@/pages/projects/components/resource-format';
import { sandboxFailure } from './sandbox-labels';

/** The files of the sandbox, one directory at a time, with a download of each file. */
export function FilesTab({ id, active }: { id: string; active: boolean }) {
  const [directory, setDirectory] = useState(WORKSPACE_ROOT);
  const files = useSandboxFiles(id, directory, active);
  const entries = sortedEntries(files.data?.files ?? []);
  const trail = crumbs(directory);

  return (
    <div className="space-y-3 pt-4">
      <nav aria-label="Directory" className="flex flex-wrap items-center gap-1 font-mono text-label">
        {trail.map((crumb, index) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">/</span>}
            {index === trail.length - 1 ? (
              <span aria-current="location" className="text-foreground">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setDirectory(crumb.path)}
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      <Card>
        <Card.Body className="p-0">
          {files.isError ? (
            <p role="alert" className="p-4 text-body-sm text-destructive">
              Could not read {directory}: {sandboxFailure(files.error)}
            </p>
          ) : files.isLoading ? (
            <p className="p-4 text-body-sm text-muted-foreground">Reading {directory}…</p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-body-sm text-muted-foreground">This directory is empty.</p>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Name</Table.HeaderCell>
                  <Table.HeaderCell align="right">Size</Table.HeaderCell>
                  <Table.HeaderCell align="right">
                    <span className="sr-only">Download</span>
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {entries.map((entry) => {
                  const path = childPath(directory, entry.name);
                  return (
                    <Table.Row key={entry.name}>
                      <Table.Cell>
                        {entry.is_dir ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 font-mono text-label text-foreground underline-offset-2 hover:underline"
                            onClick={() => setDirectory(path)}
                            aria-label={`Open directory ${entry.name}`}
                          >
                            <Folder className="size-4 text-muted-foreground" aria-hidden="true" />
                            {entry.name}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-2 font-mono text-label text-foreground">
                            <File className="size-4 text-muted-foreground" aria-hidden="true" />
                            {entry.name}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell align="right">
                        <span className="text-label text-muted-foreground tabular-nums">
                          {entry.is_dir ? '—' : (formatBytes(entry.size) ?? '—')}
                        </span>
                      </Table.Cell>
                      <Table.Cell align="right">
                        {!entry.is_dir && (
                          <a
                            href={`${getApiBase()}/v1/sandboxes/${encodeURIComponent(id)}/files/${encodedFilePath(path)}`}
                            download={entry.name}
                            aria-label={`Download ${entry.name}`}
                            className="inline-flex text-muted-foreground hover:text-foreground"
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </a>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
