import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageShell,
  type DataTableColumn,
} from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { createBundle, fetchBundles, promotionRefusal } from '@/pages/skills/components/skills-api';

/**
 * M35 — `/bundles`: os pacotes de distribuição deste workspace.
 *
 * Por que esta tela existe: o M20 entregou bundles e tokens delegados, o M21 entregou telemetria
 * de adoção, e **os dois foram fechados com zero telas**. A capacidade existia só por `curl` — um
 * publisher não tinha como ver o que distribuía nem revogar uma credencial sem linha de comando.
 *
 * A lista traz o que a PRÓXIMA AÇÃO exige: o identificador que abre o detalhe onde tokens e
 * adoção vivem. É a lição que o `theo-trust` pagou caro — uma listagem que não devolve o que a
 * jornada seguinte precisa vira painel de só olhar, e o detalhe correspondente vira código morto.
 */

interface BundleSummary {
  readonly bundle_id: string;
  readonly name: string;
  readonly create_time?: string;
}

interface BundlesPayload {
  readonly bundles?: BundleSummary[];
}

const QUERY_KEY = ['cloud', '/v1/dashboard/bundles'] as const;

export function BundlesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Distribution'), [setPageTitle]);
  useRequireAuth();

  const queryClient = useQueryClient();
  const [nome, setNome] = useState('');
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchBundles<BundlesPayload>(),
  });

  const criar = useMutation({
    mutationFn: (name: string) => createBundle<BundleSummary>(name),
    onSuccess: () => {
      setNome('');
      setErroCriacao(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    // A mensagem do serviço é preferida à nossa: ela nomeia o motivo (falta de escopo, nome em
    // uso), enquanto qualquer paráfrase nossa envelhece na primeira mudança do backend.
    onError: (err) => setErroCriacao(promotionRefusal(err, 'Could not create the bundle.')),
  });

  const rows = Array.isArray(query.data?.bundles) ? query.data.bundles : [];
  const failed = Boolean(query.error);

  const columns: DataTableColumn<BundleSummary>[] = [
    {
      key: 'name',
      label: 'Bundle',
      render: (row) => (
        // O nome É o caminho para o detalhe, onde tokens e adoção vivem. Sem este link a tela
        // seria um beco sem saída e a jornada morreria aqui.
        <Link
          to={`/bundles/${encodeURIComponent(row.bundle_id)}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'bundle_id',
      label: 'Identifier',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.bundle_id}</span>,
    },
    {
      key: 'create_time',
      label: 'Created',
      render: (row) => (
        <span className="text-muted-foreground">
          {row.create_time ? new Date(row.create_time).toLocaleDateString('en-US') : '—'}
        </span>
      ),
    },
  ];

  return (
    <PageShell
      title="Distribution"
      description="Hand a set of skills to someone outside this workspace — without giving them an account here."
    >
      {/* O QUE É a distribuição, dito na própria tela.

          Sem isto, "Distribuição" é um item de menu que não se explica: o operador vê pacotes e
          tokens e não descobre para que servem nem como se ligam às skills que ele publicou. O
          conceito central do produto — o item aponta para um CANAL, e é isso que mantém o pacote
          vivo — não tinha representação alguma na interface.

          Três frases, na ordem das perguntas que alguém faz ao abrir a tela pela primeira vez:
          o que é, para quem, e por que não quebra quando eu publico uma versão nova. */}
      <Card>
        <Card.Body>
          <p className="text-sm text-muted-foreground">
            A <strong>bundle</strong> is a set of skills you deliver to someone{' '}
            <strong>outside</strong> this workspace — a client, a partner. They get a{' '}
            <strong>delegated token</strong> instead of an account, and fetch the bundle with it.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Each item points at a <strong>channel</strong>, not at a fixed revision. So when you
            promote a channel to a new version, every consumer receives it on their next install —
            nobody edits the bundle, and nothing on their side breaks.
          </p>
        </Card.Body>
      </Card>

      {failed ? (
        <Alert
          intent="destructive"
          title="Could not load the bundles"
          description="The list below is empty because the read failed — this does NOT mean nothing is being distributed."
        />
      ) : null}

      {erroCriacao !== null ? (
        <Alert intent="destructive" title="The bundle was not created" description={erroCriacao} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>New bundle</h2>
          </Card.Title>
          <Card.Description>
            The name is how the bundle appears to whoever installs it. Once created, issue a token
            in its detail page to grant access.
          </Card.Description>
        </Card.Header>
        <form
          className="flex gap-2 px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            const limpo = nome.trim();
            if (limpo === '') return;
            criar.mutate(limpo);
          }}
        >
          <Input
            aria-label="Bundle name"
            placeholder="e.g. support skills"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          {/* Desabilitado enquanto vazio: o backend recusaria, e deixar clicável ensinaria o
              operador a descobrir a regra pelo erro. */}
          <Button type="submit" disabled={nome.trim() === '' || criar.isPending}>
            {criar.isPending ? 'Creating…' : 'Create bundle'}
          </Button>
        </form>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Bundles</h2>
          </Card.Title>
          <Card.Description>{rows.length} in this workspace</Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.bundle_id}
          loading={query.isLoading}
          emptyState={
            <EmptyState
              icon={Package}
              // Falha de leitura e ausência de dados NÃO são o mesmo estado, e a diferença é a
              // que importa: uma pede nova tentativa, a outra pede uma ação.
              title={failed ? 'No data — the read failed' : 'No bundle created yet'}
              description={
                failed
                  ? 'Try again in a moment. Until then, there is no way to know what this workspace distributes.'
                  : 'Create a bundle above to group skills and hand them out with a delegated token.'
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
