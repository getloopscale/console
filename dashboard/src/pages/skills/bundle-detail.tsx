import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, TrendingUp } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageShell,
  type DataTableColumn,
} from '@usetheo/ui';

import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  adoptionRows,
  tokenRows,
  type AdoptionPayload,
  type AdoptionRow,
  type TokenRow,
  type TokensPayload,
} from '@/pages/skills/components/distribution';
import {
  fetchBundleAdoption,
  fetchBundleTokens,
  fetchBundles,
  fetchSkillChannels,
  fetchSkills,
  mintBundleToken,
  promotionRefusal,
  revokeBundleToken,
  setBundleItems,
} from '@/pages/skills/components/skills-api';

/**
 * M35 — `/bundles/:bundleId`: os tokens delegados de um pacote e a adoção dele.
 *
 * **A listagem de tokens é o milestone inteiro.** Até ela existir, o registro sabia emitir e
 * revogar — e não listar. O `DELETE` exigia um identificador que a tela não tinha como descobrir,
 * então um token emitido pela CLI ou por outro operador era invisível e portanto irrevogável.
 *
 * O valor do token aparece UMA vez, na criação. Depois só o identificador — e a tela precisa
 * dizer isso na hora, senão o operador fecha a caixa e perde a credencial.
 */

const JANELA_DIAS = 30;
/** Explícito: sem `limit` herdaríamos o teto do servidor sem saber qual é. */
const LIMITE_SKILLS = 100;

interface BundleItem {
  readonly skill_id: string;
  readonly channel: string;
}

export function BundleDetailPage() {
  const { bundleId = '' } = useParams<{ bundleId: string }>();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Bundle'), [setPageTitle]);
  useRequireAuth();

  const queryClient = useQueryClient();
  const tokensKey = ['cloud', '/v1/dashboard/bundles', bundleId, 'tokens'] as const;

  const [ttlDias, setTtlDias] = useState('30');
  const [rotulo, setRotulo] = useState('');
  const [segredo, setSegredo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aRevogar, setARevogar] = useState<TokenRow | null>(null);
  const [skillEscolhida, setSkillEscolhida] = useState('');
  const [canalEscolhido, setCanalEscolhido] = useState('');
  const [itens, setItens] = useState<BundleItem[] | null>(null);

  const tokensQuery = useQuery({
    queryKey: tokensKey,
    queryFn: () => fetchBundleTokens<TokensPayload>(bundleId),
    enabled: bundleId !== '',
  });

  const adocaoQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/bundles', bundleId, 'adoption', JANELA_DIAS] as const,
    queryFn: () => fetchBundleAdoption<AdoptionPayload>(bundleId, JANELA_DIAS),
    enabled: bundleId !== '',
  });

  // O conteúdo do pacote vem da LISTAGEM de bundles: o detalhe não tem rota própria, e uma
  // segunda fonte para o mesmo dado divergiria na primeira mudança do contrato.
  const bundlesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/bundles'] as const,
    queryFn: () => fetchBundles<{ bundles?: { bundle_id: string; items?: BundleItem[] }[] }>(),
  });
  const itensDoServidor =
    bundlesQuery.data?.bundles?.find((b) => b.bundle_id === bundleId)?.items ?? [];
  // `itens` é `null` até o operador mexer: assim a tela mostra o que o servidor tem, e só passa a
  // mostrar o rascunho local depois de uma edição — sem piscar entre os dois a cada refetch.
  const itensVisiveis = itens ?? itensDoServidor;
  const sujo = itens !== null;

  const skillsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', LIMITE_SKILLS] as const,
    queryFn: () => fetchSkills<{ skills?: { skill_id: string; name: string }[] }>(LIMITE_SKILLS),
  });

  const canaisQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', skillEscolhida, 'channels'] as const,
    queryFn: () => fetchSkillChannels<{ channels?: { channel: string }[] }>(skillEscolhida),
    // Só busca depois de escolher a skill: buscar os canais de TODAS custaria N requisições para
    // exibir uma lista que o operador vai usar uma vez.
    enabled: skillEscolhida !== '',
  });

  const salvarItens = useMutation({
    mutationFn: (lista: BundleItem[]) => setBundleItems(bundleId, lista),
    onSuccess: () => {
      setErro(null);
      setItens(null);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/bundles'] });
    },
    onError: (err) => setErro(promotionRefusal(err, 'Could not save the bundle contents.')),
  });

  const emitir = useMutation({
    mutationFn: (v: { ttl: number; label: string }) => mintBundleToken<{ token?: string }>(bundleId, v.ttl, v.label),
    onSuccess: (data) => {
      setErro(null);
      // O valor vive AQUI e só aqui. Guardá-lo em estado é o que permite mostrá-lo uma vez; a
      // listagem, por desenho do serviço, nunca o devolve de novo.
      setSegredo(typeof data?.token === 'string' ? data.token : null);
      setRotulo('');
      void queryClient.invalidateQueries({ queryKey: tokensKey });
    },
    onError: (err) => setErro(promotionRefusal(err, 'Could not issue the token.')),
  });

  const revogar = useMutation({
    mutationFn: (tokenId: string) => revokeBundleToken(bundleId, tokenId),
    onSuccess: () => {
      setErro(null);
      setARevogar(null);
      void queryClient.invalidateQueries({ queryKey: tokensKey });
    },
    onError: (err) => {
      setARevogar(null);
      setErro(promotionRefusal(err, 'Could not revoke the token.'));
    },
  });

  // `new Date()` avaliado no render: o estado de um token muda com o tempo, e congelá-lo num
  // `useMemo` sem dependência mostraria "ativo" para algo que expirou enquanto a aba ficou aberta.
  const tokens = tokenRows(tokensQuery.data, new Date());
  const adocao = adoptionRows(adocaoQuery.data);
  const totalInstalacoes = adocaoQuery.data?.total_installs;

  const tokensFalhou = Boolean(tokensQuery.error);
  const adocaoFalhou = Boolean(adocaoQuery.error);

  const colunasToken: DataTableColumn<TokenRow>[] = [
    {
      key: 'labelText',
      label: 'Label',
      render: (row) => <span className="font-medium">{row.labelText}</span>,
    },
    {
      key: 'tokenId',
      label: 'Identifier',
      // O identificador É o que torna a revogação possível — e é a única parte do token que a
      // listagem devolve. O valor nunca reaparece.
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.tokenId}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      // Texto, nunca só cor (WCAG 1.4.1): as três situações levam a ações diferentes.
      render: (row) => {
        const rotulos: Record<TokenRow['status'], { texto: string; variante: 'success' | 'warning' | 'outline' }> = {
          active: { texto: 'active', variante: 'success' },
          expired: { texto: 'expired', variante: 'warning' },
          revoked: { texto: 'revoked', variante: 'outline' },
          unknown: { texto: 'unknown status', variante: 'warning' },
        };
        const { texto, variante } = rotulos[row.status];
        return <Badge variant={variante}>{texto}</Badge>;
      },
    },
    {
      key: 'expiresAt',
      label: 'Expires',
      render: (row) => {
        const t = Date.parse(row.expiresAt);
        return (
          <span className="text-muted-foreground">
            {Number.isNaN(t) ? '—' : new Date(t).toLocaleDateString('en-US')}
          </span>
        );
      },
    },
    {
      key: 'acao',
      label: '',
      render: (row) =>
        // Um token já revogado não oferece o botão: clicar nele não mudaria nada, e um controle
        // que não faz nada ensina o operador a desconfiar da tela.
        row.status === 'revoked' ? (
          <span className="text-xs text-muted-foreground">revoked</span>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setARevogar(row)}>
            Revogar
          </Button>
        ),
    },
  ];

  const colunasAdocao: DataTableColumn<AdoptionRow>[] = [
    { key: 'skillId', label: 'Skill', render: (row) => <span className="font-mono text-xs">{row.skillId}</span> },
    { key: 'version', label: 'Version', render: (row) => <span className="font-mono text-xs">{row.version}</span> },
    { key: 'installs', label: 'Installs', render: (row) => <span>{row.installs}</span> },
    {
      key: 'share',
      label: 'Share',
      // `null` é exibido como "—", não como 0%: com denominador zero, "0%" afirmaria "ninguém
      // instalou esta skill" quando o verdadeiro é "não dá para calcular proporção".
      render: (row) => (
        <span className="text-muted-foreground">
          {row.share === null ? '—' : `${(row.share * 100).toFixed(1)}%`}
        </span>
      ),
    },
  ];

  return (
    <PageShell
      title="Bundle"
      description={bundleId}
    >
      {/* Caminho de volta explícito. O item de menu leva ao overview da capacidade, não à lista
          de pacotes — sem este link o operador que entrou pelo detalhe não tem saída óbvia. */}
      <Link to="/bundles" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Todos os pacotes
      </Link>

      {erro !== null ? <Alert intent="destructive" title="The operation failed" description={erro} /> : null}

      {segredo !== null ? (
        <Alert
          intent="warning"
          title="Save this token now — it will not be shown again"
          description={
            <span className="font-mono text-xs break-all">{segredo}</span>
          }
        />
      ) : null}

      {tokensFalhou ? (
        <Alert
          intent="destructive"
          title="Could not load the tokens"
          description="The list below is empty because the read failed — this does NOT mean no tokens were issued. Do not revoke anything based on this screen until it loads again."
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Bundle contents</h2>
          </Card.Title>
          <Card.Description>
            Each item points at a <strong>channel</strong>, not at a fixed revision: promoting the
            channel re-points everyone who already installed it, with nobody editing the bundle.
            Saving replaces the whole list.
          </Card.Description>
        </Card.Header>

        <div className="flex flex-col gap-3 px-6 pb-6">
          {itensVisiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skill in this bundle. A token for it delivers nothing.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {itensVisiveis.map((item) => (
                <li key={`${item.skill_id}@${item.channel}`} className="flex items-center gap-2 text-sm">
                  {/* A CADEIA bundle → skill → canal, navegável.

                      Os dois eram texto morto: o operador via `sk_x` e `stable` e não tinha como
                      chegar na skill nem descobrir QUAL revisão aquele canal serve hoje — que é a
                      única pergunta que importa quando se olha o conteúdo de um pacote.

                      É a lição que o `CLAUDE.md` deste repositório registra sobre o theo-trust:
                      uma lista que não devolve o caminho da próxima ação vira um painel só de
                      olhar, e a tela de destino vira código morto em produção. */}
                  <Link
                    to={`/skills/${encodeURIComponent(item.skill_id)}`}
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {item.skill_id}
                  </Link>
                  <Link
                    to={`/skills/${encodeURIComponent(item.skill_id)}/versions`}
                    aria-label={`See which revision ${item.channel} serves for ${item.skill_id}`}
                  >
                    <Badge variant="outline">{item.channel}</Badge>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setItens(
                        itensVisiveis.filter(
                          (i) => !(i.skill_id === item.skill_id && i.channel === item.channel),
                        ),
                      )
                    }
                  >
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (skillEscolhida === '' || canalEscolhido === '') return;
              // Duplicata é ignorada em silêncio? Não: o mesmo par skill+canal duas vezes não
              // acrescenta nada e confundiria a leitura da lista.
              const jaExiste = itensVisiveis.some(
                (i) => i.skill_id === skillEscolhida && i.channel === canalEscolhido,
              );
              if (jaExiste) {
                setErro('This skill is already in the bundle on that channel.');
                return;
              }
              setErro(null);
              setItens([...itensVisiveis, { skill_id: skillEscolhida, channel: canalEscolhido }]);
              setSkillEscolhida('');
              setCanalEscolhido('');
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              <span>Skill</span>
              <select
                aria-label="Skill to add"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={skillEscolhida}
                onChange={(e) => {
                  setSkillEscolhida(e.target.value);
                  // Trocar de skill invalida o canal escolhido: canais são POR skill, e manter o
                  // anterior montaria um item que o registro não sabe servir.
                  setCanalEscolhido('');
                }}
              >
                <option value="">select…</option>
                {(skillsQuery.data?.skills ?? []).map((sk) => (
                  <option key={sk.skill_id} value={sk.skill_id}>
                    {sk.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span>Channel</span>
              <select
                aria-label="Skill channel"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={canalEscolhido}
                onChange={(e) => setCanalEscolhido(e.target.value)}
                disabled={skillEscolhida === '' || canaisQuery.isLoading}
              >
                <option value="">
                  {skillEscolhida === ''
                    ? 'escolha a skill antes'
                    : canaisQuery.isLoading
                      ? 'carregando…'
                      : 'selecione…'}
                </option>
                {(canaisQuery.data?.channels ?? []).map((c) => (
                  <option key={c.channel} value={c.channel}>
                    {c.channel}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" variant="secondary" disabled={skillEscolhida === '' || canalEscolhido === ''}>
              Adicionar ao pacote
            </Button>
          </form>

          {/* O botão de salvar só aparece com edição pendente: um botão sempre ativo sugeriria que
              o que está na tela ainda não foi gravado, mesmo quando já foi. */}
          {sujo ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => salvarItens.mutate(itensVisiveis)} disabled={salvarItens.isPending}>
                {salvarItens.isPending ? 'Saving…' : 'Save contents'}
              </Button>
              <Button variant="ghost" onClick={() => setItens(null)} disabled={salvarItens.isPending}>
                Discard changes
              </Button>
              <span className="text-xs text-muted-foreground">Unsaved changes.</span>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>New token</h2>
          </Card.Title>
          <Card.Description>
            A delegated token grants access to this bundle without exposing the workspace
            credentials. The value is shown once, at creation.
          </Card.Description>
        </Card.Header>
        <form
          className="flex flex-wrap items-end gap-2 px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            const dias = Number(ttlDias);
            if (!Number.isFinite(dias) || dias <= 0) return;
            emitir.mutate({ ttl: dias, label: rotulo.trim() });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>Valid for (days)</span>
            <Input
              aria-label="Validity in days"
              type="number"
              min={1}
              value={ttlDias}
              onChange={(e) => setTtlDias(e.target.value)}
              className="w-32"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Label (optional)</span>
            <Input
              aria-label="Token label"
              placeholder="e.g. CI pipeline"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={emitir.isPending || Number(ttlDias) <= 0}>
            {emitir.isPending ? 'Issuing…' : 'Issue token'}
          </Button>
        </form>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Issued tokens</h2>
          </Card.Title>
          <Card.Description>
            Revoked ones stay on the list, marked — hiding them would make it impossible to audit
            what was issued.
          </Card.Description>
        </Card.Header>
        <DataTable
          columns={colunasToken}
          data={tokens}
          rowKey={(row) => row.tokenId}
          loading={tokensQuery.isLoading}
          emptyState={
            <EmptyState
              icon={KeyRound}
              title={tokensFalhou ? 'No data — the read failed' : 'No token issued'}
              description={
                tokensFalhou
                  ? 'Try again in a moment. Until then, there is no way to know who has access to this bundle.'
                  : 'Issue a token above to grant access to this bundle without exposing the workspace credentials.'
              }
            />
          }
        />
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Adoption over the last {JANELA_DIAS} days</h2>
          </Card.Title>
          {/* O rótulo diz a granularidade REAL, medida em `adoption-store.ts`: skill + versão,
              escopada a este pacote. Chamar de "por pacote" faria a tela mentir — e "instalações
              totais da skill X" não é computável hoje, porque não há agregação entre pacotes. */}
          <Card.Description>
            {typeof totalInstalacoes === 'number'
              ? `${totalInstalacoes} installs in this window. The count is per skill and version within THIS bundle — the same skill in another bundle is counted separately.`
              : 'The count is per skill and version within THIS bundle — the same skill in another bundle is counted separately.'}
          </Card.Description>
        </Card.Header>
        {adocaoFalhou ? (
          <div className="px-6 pb-4">
            <Alert
              intent="destructive"
              title="Could not load adoption"
              description="The table below is empty because the read failed — this does NOT mean nobody installed it."
            />
          </div>
        ) : null}
        <DataTable
          columns={colunasAdocao}
          data={adocao}
          rowKey={(row) => `${row.skillId}@${row.version}`}
          loading={adocaoQuery.isLoading}
          emptyState={
            <EmptyState
              icon={TrendingUp}
              title={adocaoFalhou ? 'No data — the read failed' : 'No install in this window'}
              description={
                adocaoFalhou
                  ? 'Try again in a moment.'
                  : `Nobody installed skills from this bundle in the last ${JANELA_DIAS} days.`
              }
            />
          }
        />
      </Card>

      <ConfirmDialog
        open={aRevogar !== null}
        onOpenChange={(open) => {
          if (!open) setARevogar(null);
        }}
        title={`Revoke the token "${aRevogar?.labelText ?? ''}"?`}
        description={
          <>
            Whoever is using this token loses access to this bundle immediately — pipelines and
            agents that depend on it start failing on their next install. The token stays listed,
            marked as revoked, for auditing.{' '}
            <strong>This action cannot be undone.</strong>
          </>
        }
        confirmLabel="Revoke token"
        intent="destructive"
        // A frase digitada é o identificador: é o que está na tela e o que distingue este token
        // de outro com o mesmo rótulo.
        confirmationPhrase={aRevogar?.tokenId}
        loading={revogar.isPending}
        onConfirm={() => {
          if (aRevogar !== null) revogar.mutate(aRevogar.tokenId);
        }}
      />
    </PageShell>
  );
}
