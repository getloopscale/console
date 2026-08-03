import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, GitCompare, Search } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, PageShell, type DataTableColumn } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchCatalog } from '@/components/promptly/promptly-api';
import { catalogRows, type CatalogRow } from '@/components/promptly/projections';

/**
 * M13 — `/promptly/catalogo`: a lista dos prompts do workspace.
 *
 * Era `/promptly` até o M13. Saiu da raiz porque a raiz passou a ser o painel, como em memory, rag
 * e lens — onde a lista sempre viveu um nível abaixo. O endereço antigo continua resolvendo: ele
 * não sumiu, mudou o que renderiza.
 *
 * A lista traz o que torna possível a PRÓXIMA AÇÃO de quem a lê — o nome que abre o detalhe, os
 * labels que dizem o que está no ar, e o atalho para comparar revisões. É a lição que o
 * `theo-trust` pagou caro: uma listagem que não devolve o que a jornada seguinte precisa vira
 * painel de só olhar.
 *
 * O corpo do prompt NÃO aparece aqui, e a ausência é decisão: o índice do serviço não o devolve
 * (repeti-lo multiplicaria o custo pela cardinalidade) e uma lista de nomes não precisa dele.
 */

/** Explícito de propósito: sem `limit` herdaríamos o teto do servidor sem saber qual é. */
const PAGE_LIMIT = 100;

const QUERY_KEY = ['cloud', '/v1/dashboard/promptly/prompts'] as const;

/**
 * Os três estados em que a tabela aparece vazia — e cada um pede uma saída diferente.
 *
 * Confundi-los é o defeito que o M13 corrige: a busca criou o terceiro, e ele herdava a saída do
 * segundo. "Crie o primeiro prompt" oferecido a quem acabou de filtrar afirma que o workspace está
 * vazio quando ele está cheio, e manda criar quando o que falta é limpar o filtro.
 */
type EstadoVazio = 'falha-de-leitura' | 'catalogo-vazio' | 'filtro-sem-resultado';

export function PromptlyCatalogoPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Catálogo de prompts'), [setPageTitle]);
  useRequireAuth();

  const [termo, setTermo] = useState('');

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchCatalog<unknown>(PAGE_LIMIT),
  });

  const rows = catalogRows(query.data);
  const failed = Boolean(query.error);

  // `includes`, não `RegExp`: um termo com `a(b` é input legítimo de quem digita, e `new
  // RegExp(termo)` lançaria `SyntaxError` no meio da digitação (EC-7).
  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (t === '') return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(t));
  }, [rows, termo]);

  const filtrando = termo.trim() !== '';
  const estadoVazio: EstadoVazio = failed
    ? 'falha-de-leitura'
    : filtrando && rows.length > 0
      ? 'filtro-sem-resultado'
      : 'catalogo-vazio';

  const columns: DataTableColumn<CatalogRow>[] = [
    {
      key: 'name',
      label: 'Prompt',
      render: (row) => (
        // O nome É o caminho para o detalhe. Sem este link a lista seria um beco sem saída.
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
    {
      key: 'comparar',
      label: '',
      render: (row) =>
        // Só oferece quando HÁ o que comparar. Um link para o diff de um prompt em v1 leva a uma
        // tela que só pode frustrar.
        row.latestVersion > 1 ? (
          <Link
            // `encodeURIComponent` porque o serviço não restringe caractere no nome
            // (`name: z.string().min(1)`): sem escape, `a/b` viraria `/promptly/a/b/diff`, que não
            // casa com a rota `/promptly/:name/diff`.
            to={`/promptly/${encodeURIComponent(row.name)}/diff`}
            aria-label={`Comparar revisões de ${row.name}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            Comparar
          </Link>
        ) : null,
    },
  ];

  return (
    <PageShell
      title="Catálogo de prompts"
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
          <Card.Description>
            {filtrando ? `${filtradas.length} de ${rows.length}` : `${rows.length} neste workspace`}
          </Card.Description>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Filtrar por nome"
                aria-label="Filtrar prompts por nome"
                className="h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm"
              />
            </div>
            {/* A saída para a autoria fica onde o operador já está olhando. Sem ela o catálogo é
                um beco: dá para ver o que existe e não para criar nada. */}
            <Button asChild>
              <Link to="/promptly/new">Nova revisão</Link>
            </Button>
          </div>

          {/* O escopo do filtro, dito na tela. Ele roda sobre o que ESTÁ CARREGADO — quem não
              souber disso conclui ausência a partir de um filtro que nunca consultou o servidor. */}
          <p className="pt-2 text-xs text-muted-foreground">
            O filtro roda sobre os prompts já carregados nesta página, não sobre o servidor.
          </p>
        </Card.Header>

        <DataTable
          columns={columns}
          data={filtradas}
          rowKey={(row) => row.name}
          loading={query.isLoading}
          emptyState={<VazioDoCatalogo estado={estadoVazio} termo={termo} onLimpar={() => setTermo('')} />}
        />
      </Card>
    </PageShell>
  );
}

/**
 * O estado vazio, escolhido pelo QUE ACONTECEU e não pela contagem de linhas.
 *
 * A ação de criar só aparece quando a tela pode afirmar ausência. Numa falha de leitura ela some
 * porque o workspace pode estar cheio; num filtro sem resultado ela some porque o workspace ESTÁ
 * cheio — e a saída certa é limpar o filtro, não criar mais um prompt.
 */
function VazioDoCatalogo({
  estado,
  termo,
  onLimpar,
}: {
  estado: EstadoVazio;
  termo: string;
  onLimpar: () => void;
}) {
  if (estado === 'falha-de-leitura') {
    return (
      <EmptyState
        icon={FileText}
        title="Sem dados — a leitura falhou"
        description="Tente novamente em instantes. Enquanto isso, não é possível saber o que existe no catálogo."
      />
    );
  }

  if (estado === 'filtro-sem-resultado') {
    return (
      <EmptyState
        icon={Search}
        title={`Nenhum prompt casa com “${termo}”`}
        description="O workspace tem prompts — nenhum deles casa com este filtro. Limpe o filtro para ver a lista inteira."
        action={
          <Button variant="secondary" onClick={onLimpar}>
            Limpar filtro
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={FileText}
      title="Nenhum prompt neste workspace"
      description="Crie a primeira revisão aqui mesmo — ela passa a valer no runtime sem redeploy."
      action={
        <Button asChild>
          <Link to="/promptly/new">Criar o primeiro prompt</Link>
        </Button>
      }
    />
  );
}
