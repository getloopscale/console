import { Badge, Button, Table } from '@usetheo/ui';
import { RotateCw, Trash2 } from 'lucide-react';
import type { ProjectSecret } from '@/hooks/infra/use-secrets';

interface SecretsTableProps {
  secrets: ProjectSecret[];
  onRotate: (secret: ProjectSecret) => void;
  onDelete: (secret: ProjectSecret) => void;
}

/**
 * J-22 T3.1 — SecretsTable.
 *
 * Vercel-canonical secret table:
 *   columns = [Name, Value (masked), Envs, Actions(Rotate, Delete)]
 *
 * Value column ALWAYS shows ••••••••; D1 (masking forever) is respected
 * by NOT rendering the plaintext. There is no "reveal" button by design.
 *
 * Per-row callbacks wire into RotateSecretDialog / DeleteSecretDialog
 * (T3.3 / T3.4) — the parent page mounts those dialogs in T4.1.
 */
export function SecretsTable({ secrets, onRotate, onDelete }: SecretsTableProps) {
  return (
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>Name</Table.HeaderCell>
          <Table.HeaderCell>App</Table.HeaderCell>
          <Table.HeaderCell>Value</Table.HeaderCell>
          <Table.HeaderCell className="hidden md:table-cell">Envs</Table.HeaderCell>
          <Table.HeaderCell align="right">
            <span className="sr-only">Actions</span>
          </Table.HeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {secrets.map((s) => (
          <Table.Row key={`${s.app ?? ''}-${s.name}-${(s.environments ?? []).join(',')}`}>
            <Table.Cell>
              <span className="font-mono text-body-sm font-medium text-foreground">{s.name}</span>
            </Table.Cell>
            <Table.Cell>
              {/* The API's app "" scopes a secret to the whole project. */}
              <span className="font-mono text-body-sm text-muted-foreground">
                {s.app ?? 'All apps'}
              </span>
            </Table.Cell>
            <Table.Cell>
              <span
                className="font-mono text-body-sm text-muted-foreground tracking-widest"
                aria-label={`Value of ${s.name} is masked`}
              >
                ••••••••
              </span>
            </Table.Cell>
            <Table.Cell className="hidden md:table-cell">
              <div className="flex flex-wrap gap-1">
                {(s.environments ?? []).map((env) => (
                  <Badge key={env} variant="outline" className="text-label">
                    {env}
                  </Badge>
                ))}
              </div>
            </Table.Cell>
            <Table.Cell align="right">
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRotate(s)}
                  aria-label={`Rotate ${s.name}`}
                >
                  <RotateCw className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(s)}
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                </Button>
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
