import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
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

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchSkills } from '@/components/skills/skills-api';
import { filtrarAcervo, mesclarPaginas, type SkillLinha } from '@/components/skills/paging';

/**
 * M26 — `/skills`: o acervo de skills do workspace.
 *
 * Primeira superfície de UI que este produto tem: até aqui o registro existia só por API, e o
 * eixo web do gate de live-test ficava "não-aplicável" por AUSÊNCIA de tela.
 *
 * A lista traz o que torna possível a PRÓXIMA AÇÃO de quem a lê — o identificador que abre o
 * detalhe e a revisão vigente. É a lição que o `theo-trust` pagou caro: uma listagem que não
 * devolve o que a jornada seguinte precisa vira um painel só de olhar, e o detalhe correspondente
 * vira código morto em produção.
 */

/** Explícito de propósito: sem `limit` herdaríamos o teto do servidor sem saber qual é. */
const PAGE_LIMIT = 100;

const QUERY_KEY = ['cloud', '/v1/dashboard/skills'] as const;

/** Medido em `packages/api/src/server/store/skills-store.ts` — não inferido do nome do método. */
interface SkillSummary {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  /** M32 — o eixo editorial, independente da habilitação e da exclusão. */
  readonly lifecycle?: 'active' | 'draft' | 'deprecated';
  readonly deprecation_reason?: string | null;
  readonly superseded_by?: string | null;
  readonly latest_revision_id: string | null;
  readonly category?: string;
  readonly execution?: string;
}

interface SkillsPayload {
  readonly skills?: SkillSummary[];
  readonly next_page_token?: string | null;
}

export function SkillsOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Skills'), [setPageTitle]);
  useRequireAuth();

  // ---- M31 — o acervo que aguenta escala ---------------------------------------------------
  //
  // `next_page_token` era TIPADO E NÃO USADO: acima do teto de uma página o excedente sumia sem
  // erro algum, e a tela dizia "12 no acervo" com 300 lá dentro.
  //
  // As páginas já buscadas ficam em estado local em vez de virarem `useInfiniteQuery`: o acervo
  // é pequeno o bastante para isso (teto de 200 por página no serviço), e trocar a query inteira
  // pela variante infinita mexeria em cache que outras telas compartilham.
  const [paginas, setPaginas] = useState<SkillLinha[]>([]);
  const [tokenAtual, setTokenAtual] = useState<string | undefined>(undefined);
  const [filtro, setFiltro] = useState('');

  const query = useQuery({
    queryKey: [...QUERY_KEY, tokenAtual ?? 'primeira'] as const,
    queryFn: () => fetchSkills<SkillsPayload>(PAGE_LIMIT, tokenAtual),
  });

  const pagina = useMemo(
    () => (Array.isArray(query.data?.skills) ? (query.data.skills as SkillLinha[]) : []),
    [query.data],
  );

  useEffect(() => {
    if (pagina.length === 0) return;
    // Mescla POR IDENTIFICADOR: um refetch entrega a mesma página de novo, e concatenar
    // cegamente faria a contagem mentir e a `key` do React colidir.
    setPaginas((atual) => mesclarPaginas(atual, pagina));
  }, [pagina]);

  const acervo = paginas.length > 0 ? paginas : pagina;
  const rows = filtrarAcervo(acervo, filtro);
  const proximoToken = query.data?.next_page_token ?? null;
  const temMais = typeof proximoToken === 'string' && proximoToken !== '';
  const failed = Boolean(query.error);

  const columns: DataTableColumn<SkillSummary>[] = [
    {
      key: 'name',
      label: 'Skill',
      render: (row) => (
        // O nome É o caminho para o detalhe. Sem este link a lista seria um beco sem saída, e a
        // jornada terminaria na primeira tela.
        <Link to={`/skills/${encodeURIComponent(row.skill_id)}`} className="font-medium underline-offset-4 hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'description',
      label: 'O que faz',
      render: (row) => <span className="text-muted-foreground">{row.description}</span>,
    },
    {
      key: 'lifecycle',
      label: 'Ciclo de vida',
      // TEXTO, nunca só cor (WCAG 1.4.1): os três estágios levam a decisões diferentes, e uma
      // deprecada indistinguível de uma ativa é exatamente o defeito que o M32 existe para
      // impedir. Ausente NÃO vira "active": um registro mais antigo simplesmente não devolve o
      // campo, e ausência não é o mesmo que estar ativa.
      render: (row) => {
        if (row.lifecycle === undefined) return <span className="text-muted-foreground">—</span>;
        const rotulos = {
          active: { texto: 'em uso', variante: 'success' as const },
          draft: { texto: 'rascunho', variante: 'outline' as const },
          deprecated: { texto: 'descontinuada', variante: 'warning' as const },
        };
        const r = rotulos[row.lifecycle];
        return (
          <span className="flex flex-col gap-0.5">
            <Badge variant={r.variante}>{r.texto}</Badge>
            {/* O MOTIVO viaja junto: sem ele o operador vê "descontinuada" e não sabe o que
                usar no lugar — que é a pergunta seguinte, sempre. */}
            {row.lifecycle === 'deprecated' && row.deprecation_reason ? (
              <span className="text-xs text-muted-foreground">{row.deprecation_reason}</span>
            ) : null}
            {row.superseded_by ? (
              <Link
                to={`/skills/${encodeURIComponent(row.superseded_by)}`}
                className="text-xs underline-offset-4 hover:underline"
              >
                use {row.superseded_by}
              </Link>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'category',
      label: 'Categoria',
      // Ausente é um estado normal (o campo é opcional no serviço) — e "—" diz isso sem
      // fingir que houve falha de leitura.
      render: (row) => <span className="text-muted-foreground">{row.category ?? '—'}</span>,
    },
    {
      key: 'execution',
      label: 'Execução',
      // Texto, nunca só cor: `local` traz script e roda na máquina do cliente; `remote` é
      // carregada pelo agente. A distinção muda o que o operador pode fazer com a skill.
      render: (row) =>
        row.execution ? (
          <Badge variant={row.execution === 'local' ? 'warning' : 'outline'}>{row.execution}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'latest_revision_id',
      label: 'Revisão mais recente',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.latest_revision_id ?? '—'}</span>
      ),
    },
  ];

  return (
    <PageShell
      title="Skills"
      description="O registro de skills deste workspace — o que um agente pode descobrir e carregar."
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar o acervo"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há skills publicadas."
        />
      ) : null}

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1>; pular para o h3 padrão do Card.Title
              quebraria a hierarquia de cabeçalhos (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>Skills publicadas</h2>
          </Card.Title>
          {/* A contagem diz o que É: quantas estão carregadas, e se há mais. Antes dizia "12 no
              acervo" com 300 lá dentro — um número que parecia total e era de uma página. */}
          <Card.Description>
            {filtro.trim() === ''
              ? `${acervo.length} carregada(s)${temMais ? ' — há mais no acervo' : ' (acervo completo)'}`
              : `${rows.length} de ${acervo.length} carregada(s) casam com "${filtro}"`}
          </Card.Description>
        </Card.Header>

        <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
          <Input
            aria-label="Filtrar skills carregadas"
            placeholder="filtrar por nome, descrição ou identificador"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="max-w-sm"
          />
          {/* O ALCANCE do filtro é declarado. Um filtro que parece varrer o acervo inteiro e
              varre uma página é pior que filtro nenhum: leva o operador a concluir que a skill
              não existe. Para procurar no acervo todo, a Descoberta busca por intenção. */}
          <span className="text-xs text-muted-foreground">
            filtra o que está carregado —{' '}
            <Link to="/skills/descoberta" className="underline-offset-4 hover:underline">
              buscar no acervo inteiro
            </Link>
          </span>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.skill_id}
          loading={query.isLoading}
          emptyState={
            <EmptyState
              icon={Boxes}
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhuma skill publicada'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que existe no registro.'
                  : 'Publique uma skill pela CLI para que os agentes deste workspace possam descobri-la.'
              }
            />
          }
        />

        {temMais ? (
          <div className="flex items-center gap-2 px-6 pb-6">
            <Button
              variant="secondary"
              disabled={query.isFetching}
              onClick={() => setTokenAtual(proximoToken ?? undefined)}
            >
              {query.isFetching ? 'Carregando…' : 'Carregar mais'}
            </Button>
            <span className="text-xs text-muted-foreground">
              O acervo tem mais do que está nesta tela.
            </span>
          </div>
        ) : null}
      </Card>
    </PageShell>
  );
}
