import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Card, DataTable, EmptyState, PageShell, type DataTableColumn } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchCatalog } from '@/components/promptly/promptly-api';
import { catalogRows, type CatalogRow } from '@/components/promptly/projections';

/**
 * M25 — `/promptly`: o catálogo de prompts do workspace.
 *
 * Até aqui o produto versionava prompts e promovia labels só por API, SDK ou MCP: quem opera não
 * tinha superfície nenhuma. Esta é a primeira, e é uma LISTA — porque a primeira tela de um
 * painel sempre é, e porque `GET /prompts` não existia justamente por isso.
 *
 * A lista traz o que torna possível a PRÓXIMA AÇÃO de quem a lê — o nome que abre o detalhe e os
 * labels de ambiente que o prompt serve. É a lição que o `theo-trust` pagou caro: uma listagem que
 * não devolve o que a jornada seguinte precisa vira painel de só olhar, e o detalhe correspondente
 * vira código morto em produção.
 *
 * O corpo do prompt NÃO aparece aqui, e a ausência é decisão: o índice do serviço não o devolve
 * (repeti-lo multiplicaria o custo pela cardinalidade do catálogo) e uma lista de nomes não precisa
 * dele para cumprir sua função.
 */

/** Explícito de propósito: sem `limit` herdaríamos o teto do servidor sem saber qual é. */
const PAGE_LIMIT = 100;

const QUERY_KEY = ['cloud', '/v1/dashboard/promptly/prompts'] as const;

export function PromptlyOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Prompts'), [setPageTitle]);
  useRequireAuth();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchCatalog<unknown>(PAGE_LIMIT),
  });

  const rows = catalogRows(query.data);
  const failed = Boolean(query.error);

  const columns: DataTableColumn<CatalogRow>[] = [
    {
      key: 'name',
      label: 'Prompt',
      render: (row) => (
        // O nome É o caminho para o detalhe. Sem este link a lista seria um beco sem saída, e a
        // jornada terminaria na primeira tela.
        <Link
          to={`/promptly/${encodeURIComponent(row.name)}`}
          className="font-mono font-medium underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'latestVersion',
      label: 'Última revisão',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">v{row.latestVersion}</span>,
    },
    {
      // A coluna que responde "isto está servindo produção?" — a pergunta que traz o operador aqui.
      key: 'labelsResumo',
      label: 'Ambientes servidos',
      render: (row) => <span className="text-muted-foreground">{row.labelsResumo}</span>,
    },
  ];

  return (
    <PageShell
      title="Prompts"
      description="Os prompts versionados deste workspace — e qual revisão cada ambiente está servindo."
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar o catálogo"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há prompts neste workspace."
        />
      ) : null}

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1>; pular para o h3 padrão do Card.Title
              quebraria a hierarquia de cabeçalhos (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>Catálogo</h2>
          </Card.Title>
          <Card.Description>{rows.length} neste workspace</Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.name}
          loading={query.isLoading}
          emptyState={
            <EmptyState
              icon={FileText}
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhum prompt neste workspace'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que existe no catálogo.'
                  : 'Crie a primeira revisão pela CLI ou pelo SDK para que ela apareça aqui.'
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
