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
import { createBundle, fetchBundles, promotionRefusal } from '@/components/skills/skills-api';

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
  useEffect(() => setPageTitle('Distribuição'), [setPageTitle]);
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
    onError: (err) => setErroCriacao(promotionRefusal(err, 'Não foi possível criar o pacote.')),
  });

  const rows = Array.isArray(query.data?.bundles) ? query.data.bundles : [];
  const failed = Boolean(query.error);

  const columns: DataTableColumn<BundleSummary>[] = [
    {
      key: 'name',
      label: 'Pacote',
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
      label: 'Identificador',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.bundle_id}</span>,
    },
    {
      key: 'create_time',
      label: 'Criado em',
      render: (row) => (
        <span className="text-muted-foreground">
          {row.create_time ? new Date(row.create_time).toLocaleDateString('pt-BR') : '—'}
        </span>
      ),
    },
  ];

  return (
    <PageShell
      title="Distribuição"
      description="Os pacotes que este workspace distribui — e as credenciais que dão acesso a eles."
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar os pacotes"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há pacotes distribuídos."
        />
      ) : null}

      {erroCriacao !== null ? (
        <Alert intent="destructive" title="O pacote não foi criado" description={erroCriacao} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Novo pacote</h2>
          </Card.Title>
          <Card.Description>
            O nome é como o pacote aparece para quem instala. Depois de criado, emita um token no
            detalhe dele para dar acesso.
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
            aria-label="Nome do pacote"
            placeholder="ex.: skills de atendimento"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          {/* Desabilitado enquanto vazio: o backend recusaria, e deixar clicável ensinaria o
              operador a descobrir a regra pelo erro. */}
          <Button type="submit" disabled={nome.trim() === '' || criar.isPending}>
            {criar.isPending ? 'Criando…' : 'Criar pacote'}
          </Button>
        </form>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Pacotes</h2>
          </Card.Title>
          <Card.Description>{rows.length} neste workspace</Card.Description>
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
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhum pacote criado'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que este workspace distribui.'
                  : 'Crie um pacote acima para agrupar skills e distribuí-las com um token delegado.'
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
