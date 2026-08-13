import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, GitCompare, Search } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, PageShell, type DataTableColumn } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { CATALOG_PAGE_LIMIT } from '@/hooks/promptly/promptly-api';
import { catalogRows, maiorVersaoServida, type CatalogRow } from '@/pages/promptly/components/projections';
import { usePromptlyCatalog } from '@/hooks/promptly/use-promptly';

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
type EmptyStateCopy = 'falha-de-leitura' | 'catalogo-vazio' | 'filtro-sem-resultado';

/**
 * Os recortes que o painel sabe nomear — e que, sem esta tela, seriam números sem destino.
 *
 * O DoD-3 do M13 diz "cada número leva à lista correspondente". A primeira versão renderizou os
 * KPIs sem link e a Coverage Matrix afirmou "linkados" — a lista correspondente não existia. Ela
 * existe agora, e o recorte vive no ENDEREÇO: colar o link leva outra pessoa à mesma lista.
 */
const RECORTES = {
  'not-promoted': {
    titulo: 'Not promoted',
    descricao: 'Prompts whose latest revision no label serves — written and not live.',
    casa: (r: CatalogRow) => r.latestVersion > maiorVersaoServida(r.labels),
  },
  'no-environment': {
    titulo: 'No environment',
    descricao: 'Prompts that were never promoted: no label points at them.',
    casa: (r: CatalogRow) => !Array.isArray(r.labels) || r.labels.length === 0,
  },
} as const;

type Scope = keyof typeof RECORTES;

function isValidScope(v: string | null): v is Scope {
  return v !== null && Object.prototype.hasOwnProperty.call(RECORTES, v);
}

/**
 * Os tamanhos de página que a tela oferece.
 *
 * Uma lista fechada, e não um número livre: um `limit` digitado à mão vira `NaN` ou um valor que o
 * serviço recusa, e a tela erraria por um endereço editado. `CATALOG_PAGE_LIMIT` é o padrão e por
 * isso não aparece no endereço — um link sem `?porPagina=` é o mesmo link de sempre.
 */
const PAGE_SIZES = [10, 25, 50, CATALOG_PAGE_LIMIT] as const;

/**
 * A pausa antes de a busca virar navegação.
 *
 * Sem ela cada tecla vira um endereço no histórico e uma consulta ao servidor: quem digita
 * "saudacao" dispara oito buscas e precisa de oito "voltar" para sair da tela.
 */
const DEBOUNCE_MS = 300;

function isValidSize(v: string | null): number {
  const n = Number(v);
  return PAGE_SIZES.some((t) => t === n) ? n : CATALOG_PAGE_LIMIT;
}

export function PromptlyCatalogPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Prompt catalog'), [setPageTitle]);
  useRequireAuth();

  // O recorte vem da URL, não do estado local: é o que torna o link do painel COLÁVEL. Um valor
  // desconhecido é ignorado (a lista inteira), nunca um erro — um endereço antigo continua abrindo.
  const [params, setParams] = useSearchParams();
  // Os nomes ANTIGOS, em português, continuam resolvendo. O recorte vive no endereço
  // justamente para ser colável — um link já mandado num chat não pode deixar de filtrar
  // porque o produto mudou de idioma. Mesmo raciocínio dos redirects de rota (ADR D2), na
  // escala menor de um parâmetro: aqui o custo de aceitar os dois é um mapa de duas linhas.
  const ANTIGOS: Record<string, Scope> = {
    'nao-promovidos': 'not-promoted',
    'sem-ambiente': 'no-environment',
  };
  const bruto = params.get('recorte');
  const normalizado = bruto !== null && bruto in ANTIGOS ? ANTIGOS[bruto] : bruto;
  const scope = isValidScope(normalizado) ? normalizado : null;
  const perPage = isValidSize(params.get('porPagina'));

  // M16 — os três filtros de SERVIDOR vivem no endereço, pela mesma razão do recorte: o link é
  // colável. Antes deste milestone o termo era estado local e o filtro rodava sobre a página já
  // carregada — a tela dizia isso com todas as letras, e essa honestidade era o sintoma.
  const search = params.get('busca') ?? '';
  const tag = params.get('tag') ?? '';
  const folder = params.get('pasta') ?? '';

  // O que o campo mostra ENQUANTO se digita. O endereço só recebe o termo depois da pausa: uma
  // navegação por tecla encheria o histórico e dispararia uma busca por caractere.
  const [rascunho, setRascunho] = useState(search);
  useEffect(() => { setRascunho(search); }, [search]);

  const trocarParam = useCallback(
    (mudancas: Record<string, string>) => {
      setParams((atuais) => {
        const proximos = new URLSearchParams(atuais);
        for (const [key, value] of Object.entries(mudancas)) {
          if (value === '') proximos.delete(key);
          else proximos.set(key, value);
        }
        return proximos;
      }, { replace: true });
    },
    [setParams],
  );

  useEffect(() => {
    if (rascunho === search) return;
    const t = setTimeout(() => { trocarParam({ busca: rascunho.trim() }); }, DEBOUNCE_MS);
    return () => { clearTimeout(t); };
  }, [rascunho, search, trocarParam]);

  // Preserva o tamanho de página: limpar o recorte é sobre o RECORTE. Apagar os dois faria a tela
  // voltar a pedir cem sem ninguém ter pedido — e a marca de parcialidade sumiria junto, que é
  // exatamente o sinal que este milestone existe para não perder.
  const clearScope = () => {
    setParams(perPage === CATALOG_PAGE_LIMIT ? {} : { porPagina: String(perPage) }, { replace: true });
  };
  const chooseSize = (value: string) => {
    const upcoming = isValidSize(value);
    const atual = Object.fromEntries(params);
    if (upcoming === CATALOG_PAGE_LIMIT) delete atual['porPagina'];
    else atual['porPagina'] = String(upcoming);
    setParams(atual, { replace: true });
  };

  const query = usePromptlyCatalog<unknown>({ search: search, tag, folder: folder }, perPage);

  // `useMemo` sobre `query.data`, não sobre um array recriado a cada render — senão o memo do
  // filtro logo abaixo depende de uma identidade sempre nova e não memoriza nada.
  const rows = useMemo(() => catalogRows(query.data?.data), [query.data]);
  const hasContinuation = query.data?.hasContinuation ?? false;
  const failed = Boolean(query.error);

  // M16 — a busca, a tag e a pasta são do SERVIDOR; só o recorte segue local.
  //
  // O recorte fica aqui de propósito: ele é derivado do que a linha já carrega (`latestVersion` vs
  // a maior versão apontada por um label), e mandá-lo ao servidor exigiria um endpoint que não
  // existe — trabalho antes da necessidade. A honestidade que isso pede está na contagem, não numa
  // desculpa: com recorte ativo a tela não afirma total algum.
  const filtradas = useMemo(
    () => (scope === null ? rows : rows.filter(RECORTES[scope].casa)),
    [rows, scope],
  );

  /**
   * M16 — as pastas visíveis nesta página, derivadas dos nomes (ADR-2).
   *
   * Derivar da página, e não de um endpoint: a pasta É prefixo do nome, então a lista sai de graça
   * do dado que a tela já tem. Um endpoint de pastas seria uma segunda fonte de verdade que pode
   * divergir do nome — e a primeira divergência é silenciosa.
   */
  const folders = useMemo(() => {
    const vistas = new Set<string>();
    for (const r of rows) {
      const i = r.name.indexOf('/');
      if (i > 0) vistas.add(r.name.slice(0, i));
    }
    return [...vistas].sort();
  }, [rows]);

  const filtrando = search !== '' || tag !== '' || folder !== '' || scope !== null;
  // M16 — com o filtro NO SERVIDOR, zero linhas com filtro ativo significa "o filtro não achou",
  // não "o workspace está vazio".
  //
  // A condição antiga era `filtrando && rows.length > 0`, e era correta enquanto o filtro rodava
  // localmente: ter linhas carregadas provava que o workspace não estava vazio. Agora o servidor
  // devolve zero linhas para uma busca sem resultado, e a condição antiga cairia em
  // `catalogo-vazio` — afirmando ausência no workspace a partir de um filtro. É exatamente o
  // defeito que o M13 fechou, reaberto pela mudança de lado.
  const emptyState: EmptyStateCopy = failed
    ? 'falha-de-leitura'
    : filtrando
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
      label: 'Latest revision',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">v{row.latestVersion}</span>,
    },
    {
      // A coluna que responde "isto está servindo produção?" — a pergunta que traz o operador aqui.
      key: 'labelsResumo',
      label: 'Environments served',
      render: (row) => <span className="text-muted-foreground">{row.labelsResumo}</span>,
    },
    {
      // M16 — as tags do prompt. Cada uma é um BOTÃO: ler a marcação e usá-la para estreitar o
      // catálogo são a mesma ação na cabeça de quem olha, e separá-las obrigaria a digitar de
      // novo o que já está na tela.
      key: 'tags',
      label: 'Tags',
      render: (row) =>
        row.tags.length === 0 ? (
          // Traço, e não vazio: uma célula em branco lê como "não carregou".
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { trocarParam({ tag: t }); }}
                aria-label={`Filter by ${t}`}
                className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {t}
              </button>
            ))}
          </span>
        ),
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
            aria-label={`Compare revisions of ${row.name}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            Compare
          </Link>
        ) : null,
    },
  ];

  return (
    <PageShell
      title="Prompt catalog"
      description="The versioned prompts in this workspace — and which revision each environment is serving."
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Could not load the catalog"
          description="The list below is empty because the read failed — this does NOT mean there are no prompts in this workspace."
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
            <h2>{scope === null ? 'Catalog' : RECORTES[scope].titulo}</h2>
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
                // M16 — sob filtro, a tela NÃO conhece o total do workspace: o servidor devolveu
                // uma página do conjunto filtrado. Dizer "neste workspace" aqui seria o limite
                // inferior apresentado como total que o M13 existe para eliminar.
                ? hasContinuation
                  ? `${filtradas.length} on this page — there is more on the server`
                  : `${filtradas.length} no filtro`
                : hasContinuation
                  ? `${rows.length} loaded — there is more on the server`
                  : `${rows.length} neste workspace`
              : '—'}
          </Card.Description>

          {/* O recorte, quando ativo, é dito com todas as letras E tem saída. Uma lista filtrada
              que não se anuncia é a mesma classe de mentira que este milestone conserta: o
              operador conclui ausência a partir de um filtro que ele não sabe que existe. */}
          {filtrando ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {scope !== null
                  ? RECORTES[scope].descricao
                  : tag !== ''
                    ? `Only prompts tagged “${tag}”.`
                    : folder !== ''
                      ? `Only prompts in the “${folder}/” folder.`
                      : `Server-side search for “${search}”.`}
              </p>
              <Button variant="secondary" size="sm" onClick={clearScope}>
                See all
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
                value={rascunho}
                onChange={(e) => { setRascunho(e.target.value); }}
                placeholder="Search by name"
                aria-label="Filter prompts by name"
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
              <span>Prompts per page</span>
              <select
                aria-label="Prompts per page"
                value={String(perPage)}
                onChange={(e) => chooseSize(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                {PAGE_SIZES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            {/* A saída para a autoria fica onde o operador já está olhando. Sem ela o catálogo é
                um beco: dá para ver o que existe e não para criar nada. */}
            <Button asChild>
              <Link to="/promptly/new">New revision</Link>
            </Button>
          </div>

          {/* M16 — as pastas desta página, como atalho. Um catálogo plano continua navegável: os
              prompts soltos seguem na tabela abaixo, e a pasta é um caminho A MAIS, nunca um nível
              obrigatório. Quem nunca criou pasta não encontra a raiz vazia. */}
          {folder === '' && folders.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs text-muted-foreground">Folders:</span>
              {folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { trocarParam({ pasta: f }); }}
                  aria-label={`Open the ${f} folder`}
                  className="rounded-md border px-2 py-1 font-mono text-xs hover:bg-muted"
                >
                  {f}/
                </button>
              ))}
            </div>
          ) : null}
        </Card.Header>

        <DataTable
          columns={columns}
          data={filtradas}
          rowKey={(row) => row.name}
          loading={query.loading}
          emptyState={
          <CatalogEmptyState
            estado={emptyState}
            termo={search}
            hasContinuation={hasContinuation}
            onLimpar={clearScope}
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
function CatalogEmptyState({
  estado,
  termo,
  hasContinuation,
  onLimpar,
  onTentarNovamente,
}: {
  estado: EmptyStateCopy;
  termo: string;
  hasContinuation: boolean;
  onLimpar: () => void;
  onTentarNovamente: () => void;
}) {
  if (estado === 'falha-de-leitura') {
    return (
      <EmptyState
        icon={FileText}
        title="No data — the read failed"
        description="Until then, there is no way to know what exists in the catalog."
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
        title={`No prompt matches “${termo}”`}
        description={
          // M16 — o texto anterior dizia "nenhum dos prompts CARREGADOS casa … o filtro não os
          // alcança". Era verdade enquanto o filtro rodava aqui; agora ele roda no servidor, e a
          // frase virou uma desculpa por uma limitação que não existe mais. O que a continuação
          // significa hoje é outra coisa, e é ela que o operador precisa saber: o servidor achou
          // MAIS do que coube nesta página.
          hasContinuation
            ? 'The server found more than fit on this page. Refine the term or ask for a larger page.'
            : 'The search ran across the whole workspace, not just this page. Clear the filter to see the full list.'
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
      title="No prompts in this workspace"
      description="Create the first revision right here — it takes effect at runtime with no redeploy."
      action={
        <Button asChild>
          <Link to="/promptly/new">Create the first prompt</Link>
        </Button>
      }
    />
  );
}
