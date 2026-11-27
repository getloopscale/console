import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  DataTable,
  EmptyState,
  type DataTableColumn,
} from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';

import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  promoteChannel,
  promotionRefusal,
} from '@/hooks/skills/skills-api';
import {
  channelAnomalies,
  currentChannelOf,
  versionRows,
  type ChannelsPayload,
  type VersionRow,
  type VersionsPayload,
} from '@/pages/skills/components/projections';
import { promotionConfirmation, promotionPhrase } from '@/pages/skills/components/confirm-text';
import { useSkillVersions, useSkillChannels, useInvalidateSkills } from '@/hooks/skills/use-skills';

/** O canal que a tela promove. Um só, e declarado: `stable` é o que os consumidores resolvem. */
const TARGET_CHANNEL = 'stable';

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
  useEffect(() => setPageTitle(`Skill — versions of ${skillId}`), [setPageTitle, skillId]);
  useRequireAuth();

  // B-052 — chave da factory. `bundle-detail.tsx` lia os MESMOS canais com uma
  // tupla escrita a mao; agora e a mesma chave, entao invalidar alcanca os dois.
  const versions = useSkillVersions<VersionsPayload>(skillId);

    const channels = useSkillChannels<ChannelsPayload>(skillId);

  const rows = versionRows(versions.data, channels.data);
  const anomalies = channelAnomalies(channels.data);
  const failed = Boolean(versions.error || channels.error);

  const invalidarSkills = useInvalidateSkills();
  const [pending, setPending] = useState<VersionRow | null>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);

  const vigente = currentChannelOf(channels.data, TARGET_CHANNEL);

  async function confirmPromotion() {
    if (!pending) return;
    setPromotionError(null);
    try {
      await promoteChannel(skillId, TARGET_CHANNEL, pending.revisionId);
      // Invalida AMBAS: a promoção muda o canal, e a tabela de versões deriva dele. Recarregar
      // só uma deixaria a tela mostrando o estado anterior como se fosse o atual.
      // B-052 — invalida a RAIZ do dominio. As chaves literais que estavam aqui
      // deixaram de ser lidas no instante em que as paginas migraram: manter uma
      // delas seria invalidar o que ninguem le, e a lista mostraria dado velho.
      invalidarSkills();
      setPending(null);
    } catch (err) {
      // A linha permanece como está: o canal NÃO se moveu, e mudar a tela otimisticamente diria
      // que se moveu. Numa operação que redireciona consumidores, esse otimismo é o pior default.
      setPromotionError(
        promotionRefusal(err, 'The registry refused the promotion; the channel still points at the previous revision.'),
      );
    }
  }

  const columns: DataTableColumn<VersionRow>[] = [
    {
      key: 'version',
      label: 'Version',
      render: (row) => <span className="font-mono font-medium">{row.version}</span>,
    },
    {
      key: 'revisionId',
      label: 'Revision',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.revisionId}</span>,
    },
    {
      key: 'channels',
      label: 'Served by channels',
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
        row.channels.includes(TARGET_CHANNEL) ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Promote ${row.version} to ${TARGET_CHANNEL}`}
            onClick={() => {
              setPromotionError(null);
              setPending(row);
            }}
          >
            Promote to {TARGET_CHANNEL}
          </Button>
        ),
    },
  ];

  return (
    <PageShell
      title="Versions and channels"
      description={`The published versions of ${skillId}, and which channel serves each one.`}
    >
      {/* Volta à ORIGEM — a skill de onde se chegou aqui — e não ao overview. Quem abriu esta
          tela veio do detalhe e quer voltar para lá; mandá-lo ao acervo o obriga a procurar de
          novo a skill que já tinha em mãos.

          Medido no app-dev em 2026-08-04: esta rota não tinha saída alguma. Somada ao estado
          vazio, que mandava usar a CLI, ela era o "beco" que a auditoria de origem do M31
          descreveu — o último passo da jornada apontando para fora do produto. */}
      <Link
        to={`/skills/${encodeURIComponent(skillId)}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to {skillId}
      </Link>

      {failed ? (
        <Alert
          intent="destructive"
          title="Could not load versions or channels"
          description="The table below may be incomplete because one of the reads failed — this does NOT mean the skill has no versions."
        />
      ) : null}

      {anomalies.length > 0 ? (
        <Alert
          intent="destructive"
          title="The registry reported two revisions for the same channel"
          description={anomalies
            .map((a) => `${a.channel}: ${a.revisionIds.join(' and ')}`)
            .join(' · ')
            .concat(' — a channel points at exactly one revision. Do not promote anything before resolving this.')}
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Published versions</h2>
          </Card.Title>
          <Card.Description>{rows.length} version(s) in the registry</Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.revisionId}
          loading={versions.loading || channels.loading}
          emptyState={
            <EmptyState
              icon={GitBranch}
              title={failed ? 'No data — the read failed' : 'No version published'}
              description={
                failed
                  ? 'Try again in a moment. Until then, there is no way to know what is published.'
                  : 'The skill exists in the registry, but no version has been published, so there is nothing to promote to a channel. Publishing a version of an existing skill has no CLI command yet.'
              }
              // `action`, não `children`: é o slot que o componente de fato renderiza
              // (`@getloopscale/ui` — `EmptyStateProps.action?: ReactNode`). Passar children faz o
              // conteúdo sumir sem erro algum, e foi o que aconteceu na primeira tentativa.
              //
              // M31 asked for a copyable publish command prefilled with this id. B-132/B-133
              // removed it because the CLI registers no command for skills, so the block now says
              // so instead of handing over a command the terminal would reject (#527).
              //
              // There is no in-app CTA either: the authoring screen publishes a NEW skill, and this
              // one already exists. A button that pretended to lead somewhere would be worse.
              action={
                failed ? undefined : (
                  <CodeBlock
                    caption="Publish the first version of this skill"
                    /* B-132/B-133 — `loopscale skills` NAO e um comando registrado (medido
                       2026-08-11). O acervo de skills so tem superficie de API e de UI hoje. */
                    code={`# publishing a skill revision has no CLI command yet`}
                    terminal
                  />
                )
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
        title={`Promote ${pending?.version ?? ''} to «${TARGET_CHANNEL}»`}
        // O texto vem da lógica pura (T2.2) e diz O QUE DEIXA DE VALER — nomeando a revisão que
        // sai e a que entra. NÃO afirma quantos consumidores são afetados: esse número não existe
        // na API, e derivá-lo aqui seria a interface inventando um dado que o serviço não afirma.
        description={
          pending
            ? promotionConfirmation({
                channel: TARGET_CHANNEL,
                fromRevision: vigente?.revision_id ?? null,
                // A versão da que SAI vem do dado JÁ CARREGADO (`rows`) — nenhuma requisição
                // nova. `null` quando a revisão vigente não tem linha em `/versions`, que é um
                // estado real: o texto declara a lacuna em vez de inventar um rótulo.
                fromVersion:
                  vigente === null
                    ? undefined
                    : (rows.find((r) => r.revisionId === vigente.revision_id)?.version ?? null),
                toRevision: pending.revisionId,
                version: pending.version,
              })
            : ''
        }
        // A frase é o NOME DO CANAL. "PROMOVER" seria a mesma digitação em qualquer canal — vira
        // reflexo, e devolve ao gate a força de um botão comum.
        confirmationPhrase={promotionPhrase(TARGET_CHANNEL)}
        confirmLabel="Promote channel"
        onConfirm={confirmPromotion}
      />

      {promotionError ? (
        <Alert intent="destructive" title="The channel was NOT promoted" description={promotionError} />
      ) : null}
    </PageShell>
  );
}
