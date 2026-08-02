import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageShell,
  type DataTableColumn,
} from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  fetchSkillChannels,
  fetchSkillVersions,
  promoteChannel,
  promotionRefusal,
} from '@/components/skills/skills-api';
import {
  channelAnomalies,
  currentChannelOf,
  versionRows,
  type ChannelsPayload,
  type VersionRow,
  type VersionsPayload,
} from '@/components/skills/projections';
import { promotionConfirmation, promotionPhrase } from '@/components/skills/confirm-text';

/** O canal que a tela promove. Um só, e declarado: `stable` é o que os consumidores resolvem. */
const CANAL_ALVO = 'stable';

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

  const queryClient = useQueryClient();
  const [pending, setPending] = useState<VersionRow | null>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);

  const vigente = currentChannelOf(channels.data, CANAL_ALVO);

  async function confirmPromotion() {
    if (!pending) return;
    setPromotionError(null);
    try {
      await promoteChannel(skillId, CANAL_ALVO, pending.revisionId);
      // Invalida AMBAS: a promoção muda o canal, e a tabela de versões deriva dele. Recarregar
      // só uma deixaria a tela mostrando o estado anterior como se fosse o atual.
      await queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/skills', skillId, 'channels'] });
      await queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/skills', skillId, 'versions'] });
      setPending(null);
    } catch (err) {
      // A linha permanece como está: o canal NÃO se moveu, e mudar a tela otimisticamente diria
      // que se moveu. Numa operação que redireciona consumidores, esse otimismo é o pior default.
      setPromotionError(
        promotionRefusal(err, 'O registro recusou a promoção; o canal continua na revisão anterior.'),
      );
    }
  }

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
    {
      // Coluna própria em vez de `rowActions`: a linha que JÁ é servida pelo canal não ganha
      // botão nenhum — ausência, não botão cinza. Promover para onde já se está seria um ato
      // sem efeito que ainda assim pede confirmação, e treina a confirmar sem ler.
      key: 'promote',
      label: '',
      align: 'right',
      width: '1%',
      render: (row) =>
        row.channels.includes(CANAL_ALVO) ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Promover ${row.version} para ${CANAL_ALVO}`}
            onClick={() => {
              setPromotionError(null);
              setPending(row);
            }}
          >
            Promover para {CANAL_ALVO}
          </Button>
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

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
        intent="destructive"
        title={`Promover ${pending?.version ?? ''} para «${CANAL_ALVO}»`}
        // O texto vem da lógica pura (T2.2) e diz O QUE DEIXA DE VALER — nomeando a revisão que
        // sai e a que entra. NÃO afirma quantos consumidores são afetados: esse número não existe
        // na API, e derivá-lo aqui seria a interface inventando um dado que o serviço não afirma.
        description={
          pending
            ? promotionConfirmation({
                channel: CANAL_ALVO,
                fromRevision: vigente?.revision_id ?? null,
                toRevision: pending.revisionId,
                version: pending.version,
              })
            : ''
        }
        // A frase é o NOME DO CANAL. "PROMOVER" seria a mesma digitação em qualquer canal — vira
        // reflexo, e devolve ao gate a força de um botão comum.
        confirmationPhrase={promotionPhrase(CANAL_ALVO)}
        confirmLabel="Promover canal"
        onConfirm={confirmPromotion}
      />

      {promotionError ? (
        <Alert intent="destructive" title="O canal NÃO foi promovido" description={promotionError} />
      ) : null}
    </PageShell>
  );
}
