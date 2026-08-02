import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageShell,
  type DataTableColumn,
} from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchSkillChannels, fetchSkillVersions } from '@/components/skills/skills-api';
import {
  channelAnomalies,
  versionRows,
  type ChannelsPayload,
  type VersionRow,
  type VersionsPayload,
} from '@/components/skills/projections';

/**
 * M26 — `/skills/:skillId/versions`: quais versões existem e qual canal serve cada uma.
 *
 * É a tela que precede a única operação perigosa deste produto. Toda a regra que decide o que se
 * vê aqui vive em `components/skills/projections.ts`, testada sem browser — inclusive a que
 * mantém na lista a versão que nenhum canal serve, que é exatamente a candidata a ser promovida.
 *
 * A contradição do serviço (dois canais de mesmo nome apontando para revisões diferentes) é
 * EXIBIDA, não desempatada em silêncio: escolher uma faria a tela mostrar um estado que não
 * existe, e a decisão seguinte partiria de premissa falsa.
 */

export function SkillVersionsPage() {
  const { skillId = '' } = useParams();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle(`Skill — versões de ${skillId}`), [setPageTitle, skillId]);
  useRequireAuth();

  const versions = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', skillId, 'versions'],
    queryFn: () => fetchSkillVersions<VersionsPayload>(skillId),
    enabled: skillId !== '',
  });

  const channels = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', skillId, 'channels'],
    queryFn: () => fetchSkillChannels<ChannelsPayload>(skillId),
    enabled: skillId !== '',
  });

  const rows = versionRows(versions.data, channels.data);
  const anomalies = channelAnomalies(channels.data);
  const failed = Boolean(versions.error || channels.error);

  const columns: DataTableColumn<VersionRow>[] = [
    {
      key: 'version',
      label: 'Versão',
      render: (row) => <span className="font-mono font-medium">{row.version}</span>,
    },
    {
      key: 'revisionId',
      label: 'Revisão',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.revisionId}</span>,
    },
    {
      key: 'channels',
      label: 'Servida pelos canais',
      // Vazio aqui é um estado NORMAL — versão publicada e ainda não promovida. "—" diz isso
      // sem sugerir que a leitura falhou.
      render: (row) =>
        row.channels.length > 0 ? (
          <span className="flex gap-1">
            {row.channels.map((c) => (
              <Badge key={c} variant="primary">
                {c}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <PageShell
      title="Versões e canais"
      description={`As versões publicadas de ${skillId} e qual canal serve cada uma.`}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar versões ou canais"
          description="A tabela abaixo pode estar incompleta porque uma das leituras falhou — isto NÃO significa que a skill não tem versões."
        />
      ) : null}

      {anomalies.length > 0 ? (
        <Alert
          intent="destructive"
          title="O registro afirmou duas revisões para o mesmo canal"
          description={anomalies
            .map((a) => `${a.channel}: ${a.revisionIds.join(' e ')}`)
            .join(' · ')
            .concat(' — um canal aponta para uma revisão só. Não promova nada antes de resolver isto.')}
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Versões publicadas</h2>
          </Card.Title>
          <Card.Description>{rows.length} versão(ões) no registro</Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.revisionId}
          loading={versions.isLoading || channels.isLoading}
          emptyState={
            <EmptyState
              icon={GitBranch}
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhuma versão publicada'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que está publicado.'
                  : 'Publique uma versão pela CLI para que ela possa ser promovida a um canal.'
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
