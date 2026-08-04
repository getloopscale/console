import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, GitCompare, Search } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, PageShell, type DataTableColumn } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchCatalogPage, CATALOG_PAGE_LIMIT, CATALOG_QUERY_KEY } from '@/components/promptly/promptly-api';
import { catalogRows, maiorVersaoServida, type CatalogRow } from '@/components/promptly/projections';

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

/**
 * Os três estados em que a tabela aparece vazia — e cada um pede uma saída diferente.
 *
 * Confundi-los é o defeito que o M13 corrige: a busca criou o terceiro, e ele herdava a saída do
 * segundo. "Crie o primeiro prompt" oferecido a quem acabou de filtrar afirma que o workspace está
 * vazio quando ele está cheio, e manda criar quando o que falta é limpar o filtro.
 */
type EstadoVazio = 'falha-de-leitura' | 'catalogo-vazio' | 'filtro-sem-resultado';

/**
 * Os recortes que o painel sabe nomear — e que, sem esta tela, seriam números sem destino.
 *
 * O DoD-3 do M13 diz "cada número leva à lista correspondente". A primeira versão renderizou os
 * KPIs sem link e a Coverage Matrix afirmou "linkados" — a lista correspondente não existia. Ela
 * existe agora, e o recorte vive no ENDEREÇO: colar o link leva outra pessoa à mesma lista.
 */
const RECORTES = {
  'nao-promovidos': {
    titulo: 'Não promovidos',
    descricao: 'Prompts cuja última revisão nenhum label serve — escritos e fora do ar.',
    casa: (r: CatalogRow) => r.latestVersion > maiorVersaoServida(r.labels),
  },
  'sem-ambiente': {
    titulo: 'Sem ambiente',
    descricao: 'Prompts que nunca foram promovidos: nenhum label aponta para eles.',
    casa: (r: CatalogRow) => !Array.isArray(r.labels) || r.labels.length === 0,
  },
} as const;

type Recorte = keyof typeof RECORTES;

function recorteValido(v: string | null): v is Recorte {
  return v !== null && Object.prototype.hasOwnProperty.call(RECORTES, v);
}

/**
 * Os tamanhos de página que a tela oferece.
 *
 * Uma lista fechada, e não um número livre: um `limit` digitado à mão vira `NaN` ou um valor que o
 * serviço recusa, e a tela erraria por um endereço editado. `CATALOG_PAGE_LIMIT` é o padrão e por
 * isso não aparece no endereço — um link sem `?porPagina=` é o mesmo link de sempre.
 */
const TAMANHOS_DE_PAGINA = [10, 25, 50, CATALOG_PAGE_LIMIT] as const;

function tamanhoValido(v: string | null): number {
  const n = Number(v);
  return TAMANHOS_DE_PAGINA.some((t) => t === n) ? n : CATALOG_PAGE_LIMIT;
}

export function PromptlyCatalogoPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Catálogo de prompts'), [setPageTitle]);
  useRequireAuth();

  const [termo, setTermo] = useState('');
  // O recorte vem da URL, não do estado local: é o que torna o link do painel COLÁVEL. Um valor
  // desconhecido é ignorado (a lista inteira), nunca um erro — um endereço antigo continua abrindo.
  const [params, setParams] = useSearchParams();
  const bruto = params.get('recorte');
  const recorte = recorteValido(bruto) ? bruto : null;
  const porPagina = tamanhoValido(params.get('porPagina'));

  // Preserva o tamanho de página: limpar o recorte é sobre o RECORTE. Apagar os dois faria a tela
  // voltar a pedir cem sem ninguém ter pedido — e a marca de parcialidade sumiria junto, que é
  // exatamente o sinal que este milestone existe para não perder.
  const limparRecorte = () => {
    setParams(porPagina === CATALOG_PAGE_LIMIT ? {} : { porPagina: String(porPagina) }, { replace: true });
  };
  const escolherTamanho = (valor: string) => {
    const proximo = tamanhoValido(valor);
    const atual = Object.fromEntries(params);
    if (proximo === CATALOG_PAGE_LIMIT) delete atual['porPagina'];
    else atual['porPagina'] = String(proximo);
    setParams(atual, { replace: true });
  };

  const query = useQuery({
    // O tamanho entra na CHAVE, não só na chamada. Sem ele o React Query serve a página anterior
    // do cache e a tela mostra cem itens afirmando ter pedido dez.
    queryKey: [...CATALOG_QUERY_KEY, porPagina],
    queryFn: () => fetchCatalogPage<unknown>(porPagina),
  });

  // `useMemo` sobre `query.data`, não sobre um array recriado a cada render — senão o memo do
  // filtro logo abaixo depende de uma identidade sempre nova e não memoriza nada.
  const rows = useMemo(() => catalogRows(query.data?.data), [query.data]);
  const temContinuacao = query.data?.temContinuacao ?? false;
  const failed = Boolean(query.error);

  // `includes`, não `RegExp`: um termo com `a(b` é input legítimo de quem digita, e `new
  // RegExp(termo)` lançaria `SyntaxError` no meio da digitação (EC-7).
  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase();
    const porRecorte = recorte === null ? rows : rows.filter(RECORTES[recorte].casa);
    if (t === '') return porRecorte;
    return porRecorte.filter((r) => r.name.toLowerCase().includes(t));
  }, [rows, termo, recorte]);

  const filtrando = termo.trim() !== '' || recorte !== null;
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
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : null}

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1>; pular para o h3 padrão do Card.Title
              quebraria a hierarquia de cabeçalhos (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>{recorte === null ? 'Catálogo' : RECORTES[recorte].titulo}</h2>
          </Card.Title>
          {/* A contagem só aparece no estado ASSENTADO. Renderizá-la sempre imprimia
              "0 neste workspace" durante o carregamento e durante a falha — duas linhas abaixo de
              um alerta que diz o contrário, e a mais numérica das três afirmações era a falsa.
              E ela só diz "neste workspace" quando o serviço confirmou que esta página é tudo:
              com continuação, o número é de PÁGINA, e chamá-lo de workspace seria o mesmo limite
              inferior apresentado como total que este milestone existe para eliminar. */}
          <Card.Description>
            {query.isSuccess
              ? filtrando
                ? `${filtradas.length} de ${rows.length} carregados`
                : temContinuacao
                  ? `${rows.length} carregados — há mais no servidor`
                  : `${rows.length} neste workspace`
              : '—'}
          </Card.Description>

          {/* O recorte, quando ativo, é dito com todas as letras E tem saída. Uma lista filtrada
              que não se anuncia é a mesma classe de mentira que este milestone conserta: o
              operador conclui ausência a partir de um filtro que ele não sabe que existe. */}
          {recorte !== null ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <p className="text-xs text-muted-foreground">{RECORTES[recorte].descricao}</p>
              <Button variant="secondary" size="sm" onClick={limparRecorte}>
                Ver todos
              </Button>
            </div>
          ) : null}

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
            {/* Quantos prompts pedir por vez.

                Existe porque um acervo grande precisa dele — e porque, sem ele, a marca de
                parcialidade que este milestone construiu era inalcançável em qualquer ambiente
                com menos de cem prompts. Foi o que a aceitação de 2026-08-03 registrou ao devolver
                o AC2 como `not_exercised`: um critério que exigia ver a marca, e uma tela que
                pedia cem fixo. O controle serve ao operador; que ele também torne o critério
                verificável é consequência, não motivo. */}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Prompts por página</span>
              <select
                aria-label="Prompts por página"
                value={String(porPagina)}
                onChange={(e) => escolherTamanho(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                {TAMANHOS_DE_PAGINA.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
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
          emptyState={
          <VazioDoCatalogo
            estado={estadoVazio}
            termo={termo}
            temContinuacao={temContinuacao}
            onLimpar={() => setTermo('')}
            onTentarNovamente={() => void query.refetch()}
          />
        }
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
  temContinuacao,
  onLimpar,
  onTentarNovamente,
}: {
  estado: EstadoVazio;
  termo: string;
  temContinuacao: boolean;
  onLimpar: () => void;
  onTentarNovamente: () => void;
}) {
  if (estado === 'falha-de-leitura') {
    return (
      <EmptyState
        icon={FileText}
        title="Sem dados — a leitura falhou"
        description="Enquanto isso, não é possível saber o que existe no catálogo."
        /* A saída existe justamente aqui. Era o único dos três estados sem ação, e é o que mais
           precisa de uma: sem ela, o operador que cai numa falha transitória só pode recarregar a
           página inteira. */
        action={
          <Button variant="secondary" onClick={onTentarNovamente}>
            Tentar novamente
          </Button>
        }
      />
    );
  }

  if (estado === 'filtro-sem-resultado') {
    return (
      <EmptyState
        icon={Search}
        title={`Nenhum prompt casa com “${termo}”`}
        description={
          temContinuacao
            ? 'Nenhum dos prompts CARREGADOS casa com este filtro — e há mais no servidor que esta página não trouxe. O filtro não os alcança.'
            : 'O workspace tem prompts — nenhum deles casa com este filtro. Limpe o filtro para ver a lista inteira.'
        }
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
