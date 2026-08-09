import { History } from 'lucide-react';
import { Card } from '@usetheo/ui';
import { revisionColumns } from '@/pages/promptly/revision-columns';
import { revisionRows } from '@/pages/promptly/components/projections';
import type { RevisionsQuery } from './tipos';
import { DataTable, EmptyState } from '@usetheo/ui';

interface Props {
  REVISIONS_LIMIT: number;
  columns: ReturnType<typeof revisionColumns>;
  linhas: ReturnType<typeof revisionRows>;
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
export function RevisoesCard({ revisions, latestVersion, REVISIONS_LIMIT, columns, linhas, revisionsFailed }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Revisões</h2>
        </Card.Title>
        <Card.Description>
          {latestVersion === null
            ? `As ${REVISIONS_LIMIT} primeiras — a página vem do servidor.`
            : `As ${REVISIONS_LIMIT} mais recentes (até a v${latestVersion}) — a página vem do servidor, e o histórico completo continua na API.`}
        </Card.Description>
      </Card.Header>

      <DataTable
        columns={columns}
        data={linhas}
        rowKey={(row) => String(row.version)}
        loading={revisions.loading}
        emptyState={
          <EmptyState
            icon={History}
            title={revisionsFailed ? 'Sem dados — a leitura falhou' : 'Nenhuma revisão'}
            description={
              revisionsFailed
                ? 'Tente novamente em instantes. Enquanto isso, não é possível saber quais revisões existem.'
                : 'Este prompt ainda não tem revisões publicadas.'
            }
          />
        }
      />
    </Card>
  );
}
