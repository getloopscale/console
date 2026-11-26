import { History } from 'lucide-react';
import { Card } from '@getloopscale/ui';
import { revisionColumns } from '@/pages/promptly/revision-columns';
import { revisionRows } from '@/pages/promptly/components/projections';
import type { RevisionsQuery } from './tipos';
import { DataTable, EmptyState } from '@getloopscale/ui';

interface Props {
  REVISIONS_LIMIT: number;
  columns: ReturnType<typeof revisionColumns>;
  rows: ReturnType<typeof revisionRows>;
  revisionsFailed: boolean;

  revisions: RevisionsQuery;
  latestVersion: number | null;
}

/**
 * A tabela de revisões, de onde sai a promoção de uma anterior.
 *
 * ## Por que saiu do `detail.tsx` (B-009)
 *
 * A tela tinha 887 linhas num ÚNICO componente — nenhuma fronteira de função
 * para seguir. A divisão precisou ser DESENHADA, e o desenho veio dos cartões:
 * cada um responde uma pergunta própria e recebe entre um e seis símbolos.
 * Cortar por tamanho teria produzido metades sem nome.
 */
export function RevisionsCard({ revisions, latestVersion, REVISIONS_LIMIT, columns, rows, revisionsFailed }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Revisions</h2>
        </Card.Title>
        <Card.Description>
          {latestVersion === null
            ? `The first ${REVISIONS_LIMIT} — the page comes from the server.`
            : `The ${REVISIONS_LIMIT} most recent (up to v${latestVersion}) — the page comes from the server, and the full history stays in the API.`}
        </Card.Description>
      </Card.Header>

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => String(row.version)}
        loading={revisions.loading}
        emptyState={
          <EmptyState
            icon={History}
            title={revisionsFailed ? 'No data — the read failed' : 'No revisions'}
            description={
              revisionsFailed
                ? 'Try again in a moment. Until then, there is no way to know which revisions exist.'
                : 'This prompt has no published revisions yet.'
            }
          />
        }
      />
    </Card>
  );
}
