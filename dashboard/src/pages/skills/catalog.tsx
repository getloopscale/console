import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, PageShell } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { catalogCards, categoryChips, type CatalogSkill } from '@/components/skills/catalog';
import { filtrarAcervo, mesclarPaginas, type SkillLinha } from '@/components/skills/paging';
import { fetchSkills } from '@/components/skills/skills-api';

/**
 * M33 — `/skills/catalogo`: ver o que existe sem saber o que procurar.
 *
 * Atende a persona que nenhuma jornada anterior cobria. O M31 entrega uma **tabela** com busca e
 * paginação, que resolve "não perder skill acima de 100"; não resolve "me mostre o que existe" —
 * para isso a densidade da tabela atrapalha, e o cartão ajuda.
 *
 * A projeção é **compartilhada** com a tabela (`paging.ts` + `catalog.ts`) porque o risco #1
 * declarado no roadmap é card e tabela divergirem: um filtro que existe num e não no outro faz o
 * mesmo acervo parecer dois.
 */

const PAGE_LIMIT = 100;
/** Teto de chips. Acima disto a faixa vira uma parede de rótulos e deixa de orientar. */
const TETO_CHIPS = 8;

interface SkillsPayload {
  readonly skills?: CatalogSkill[];
  readonly next_page_token?: string | null;
}

export function SkillsCatalogPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Catálogo'), [setPageTitle]);
  useRequireAuth();

  const [paginas, setPaginas] = useState<SkillLinha[]>([]);
  const [tokenAtual, setTokenAtual] = useState<string | undefined>(undefined);
  const [filtro, setFiltro] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', 'catalogo', tokenAtual ?? 'primeira'] as const,
    queryFn: () => fetchSkills<SkillsPayload>(PAGE_LIMIT, tokenAtual),
  });

  const pagina = useMemo(
    () => (Array.isArray(query.data?.skills) ? (query.data.skills as SkillLinha[]) : []),
    [query.data],
  );

  useEffect(() => {
    const primeira = tokenAtual === undefined;
    if (pagina.length === 0 && !primeira) return;
    setPaginas((atual) => mesclarPaginas(atual, pagina, { primeira }));
  }, [pagina, tokenAtual]);

  const acervo = paginas.length > 0 ? paginas : pagina;
  const chips = categoryChips(acervo as CatalogSkill[], TETO_CHIPS);

  const porTexto = filtrarAcervo(acervo, filtro);
  const filtrados = categoria === null ? porTexto : porTexto.filter((s) => s.category === categoria);
  const cards = catalogCards(filtrados as CatalogSkill[]);

  const proximoToken = query.data?.next_page_token ?? null;
  const temMais = typeof proximoToken === 'string' && proximoToken !== '';
  const falhou = Boolean(query.error);
  const buscando = filtro.trim() !== '' || categoria !== null;

  return (
    <PageShell
      title="Catálogo"
      description="O que este workspace tem — para quando você não sabe o nome do que procura."
    >
      {falhou ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar o catálogo"
          description="A grade abaixo está vazia porque a leitura falhou — isto NÃO significa que o acervo está vazio."
          action={
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Filtrar</h2>
          </Card.Title>
          {/* O critério de ordem é DECLARADO na tela. Sem sinal de adoção, qualquer padrão é
              arbitrário — e um usuário que não sabe por que aquela ordem desconfia da lista. */}
          <Card.Description>
            Ordenado por nome. {acervo.length} carregada(s)
            {temMais ? ' — há mais no acervo' : ' (acervo completo)'}.
          </Card.Description>
        </Card.Header>

        <div className="flex flex-col gap-3 px-6 pb-6">
          <Input
            aria-label="Filtrar o catálogo"
            placeholder="filtrar por nome, descrição ou identificador"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="max-w-sm"
          />

          {chips.visiveis.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCategoria(null)}
                aria-pressed={categoria === null}
                className="rounded-full border px-3 py-1 text-xs"
              >
                todas
              </button>
              {chips.visiveis.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoria(categoria === c ? null : c)}
                  aria-pressed={categoria === c}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    categoria === c ? 'bg-accent font-medium' : ''
                  }`}
                >
                  {c}
                </button>
              ))}
              {/* Overflow SEM contagem por faceta: derivada da página carregada, a contagem
                  afirmaria sobre o acervo um número que só vale para o que está na tela. O `+N`
                  conta CATEGORIAS ocultas, não skills. */}
              {chips.excedente > 0 ? (
                <span className="text-xs text-muted-foreground">
                  +{chips.excedente} {chips.excedente === 1 ? 'categoria' : 'categorias'}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {cards.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutGrid}
            // OS TRÊS ESTADOS, distintos — o critério da DoD. Antes existiam dois, e
            // "busca sem resultado" era exibido como "acervo vazio": o operador concluía que
            // não havia nada publicado quando só o filtro dele não casava.
            title={
              falhou
                ? 'Sem dados — a leitura falhou'
                : buscando
                  ? 'Nada casa com este filtro'
                  : 'Nenhuma skill publicada'
            }
            description={
              falhou
                ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que existe no acervo.'
                : buscando
                  ? 'O acervo tem skills — nenhuma delas casa com o que você filtrou. Limpe o filtro para ver tudo.'
                  : 'Nada foi publicado neste workspace ainda. Crie a primeira skill pela tela de autoria.'
            }
            action={
              falhou ? undefined : buscando ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFiltro('');
                    setCategoria(null);
                  }}
                >
                  Limpar filtro
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link to="/skills/nova">Criar a primeira skill</Link>
                </Button>
              )
            }
          />
        </Card>
      ) : (
        // Grade responsiva SEM dependência nova — `grid-cols` do Tailwind, que o projeto já usa.
        // Uma biblioteca de grade aqui seria peso morto: o layout tem uma regra só.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Card key={c.skillId} className="flex flex-col">
              <Card.Header>
                <Card.Title asChild>
                  <h3>
                    <Link
                      to={`/skills/${encodeURIComponent(c.skillId)}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </h3>
                </Card.Title>
                <Card.Description>{c.description}</Card.Description>
              </Card.Header>

              <div className="mt-auto flex flex-wrap items-center gap-1.5 px-6 pb-6 text-xs">
                {c.category !== null ? <Badge variant="outline">{c.category}</Badge> : null}
                {c.execution !== null ? (
                  <Badge variant={c.execution === 'local' ? 'warning' : 'outline'}>{c.execution}</Badge>
                ) : null}
                <Badge variant="outline">{c.visibilityText}</Badge>
                {/* `embedded` é o que separa "está no acervo" de "é encontrável por intenção" —
                    e é a diferença que o produto vende. Sem vetor, a skill só aparece para quem
                    já sabe o nome. */}
                <Badge variant={c.discoverable ? 'success' : 'warning'}>
                  {c.discoverable ? 'descobrível' : 'sem vetor'}
                </Badge>
                {c.lifecycle === 'deprecated' ? <Badge variant="warning">descontinuada</Badge> : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {temMais ? (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => setTokenAtual(proximoToken ?? undefined)}
          >
            {query.isFetching ? 'Carregando…' : 'Carregar mais'}
          </Button>
          <span className="text-xs text-muted-foreground">O acervo tem mais do que está nesta tela.</span>
        </div>
      ) : null}
    </PageShell>
  );
}
