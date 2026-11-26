import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageShell,
  type DataTableColumn,
} from '@getloopscale/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { discoveryRows, type DiscoveryRow, type RetrievePayload } from '@/pages/skills/components/discovery';
import { promotionRefusal } from '@/hooks/skills/skills-api';
import { useSkillsDiscovery } from '@/hooks/skills/use-skills';

/**
 * M31 — `/skills/discovery`: a razão de existir do produto, finalmente com tela.
 *
 * A auditoria de 2026-08-03 mediu o buraco: *"a razão de existir do produto — um agente achar a
 * skill certa por intenção — não tem tela alguma"*. A API existia desde o M3; nada a exercitava
 * fora de `curl`.
 *
 * A DoD exige duas informações JUNTAS em cada resultado: o **score** e **qual perna casou**. A
 * segunda é a que carrega o produto — sem ela, o painel mostra um número sem dizer de onde veio, e
 * some a diferença entre "achou porque as palavras batem" e "achou porque entendeu".
 */

const TOP_K = 10;

export function SkillsDiscoveryPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Discovery'), [setPageTitle]);
  useRequireAuth();

  const [rascunho, setRascunho] = useState('');
  // A consulta SUBMETIDA é estado separado do que está sendo digitado: buscar a cada tecla
  // dispararia uma busca vetorial por caractere — cara no servidor e piscante na tela.
  const [consulta, setConsulta] = useState('');
  const [incluirRascunhos, setIncluirRascunhos] = useState(false);
  const [incluirDescontinuadas, setIncluirDescontinuadas] = useState(false);

  // B-052 — a chave literal citava o caminho do endpoint. Na factory ela e
  // `skills.discovery(...)`, entao uma invalidacao de `skills.all` alcanca a
  // busca junto do catalogo — antes eram ilhas separadas.
  const search = useSkillsDiscovery<RetrievePayload>(
    consulta,
    TOP_K,
    incluirRascunhos,
    incluirDescontinuadas,
    consulta !== '',
  );

  const rows = discoveryRows(search.data);
  const failed = Boolean(search.error);

  const colunas: DataTableColumn<DiscoveryRow>[] = [
    {
      key: 'name',
      label: 'Skill',
      render: (row) => (
        // O nome leva ao detalhe: sem isso a descoberta seria um beco — o operador acha a skill
        // e não tem como ler a instrução que ela carrega.
        <Link to={`/skills/${encodeURIComponent(row.skillId)}`} className="font-medium underline-offset-4 hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'description',
      label: 'What it does',
      render: (row) => <span className="text-muted-foreground">{row.description}</span>,
    },
    {
      key: 'score',
      label: 'Match score',
      // `null` vira "—", não "0.000": zero afirma "casou muito mal", e um registro que não
      // devolveu o campo não disse isso.
      render: (row) => (
        <span className="font-mono text-xs">{row.score === null ? '—' : row.score.toFixed(3)}</span>
      ),
    },
    {
      key: 'legText',
      label: 'Why it matched',
      // A METADE que a DoD exige e que nenhuma tela tinha. Em texto, não em cor nem em ícone:
      // "as palavras batem" e "entendeu a intenção" levam o operador a conclusões diferentes
      // sobre a qualidade do acervo.
      render: (row) => <Badge variant="outline">{row.legText}</Badge>,
    },
  ];

  return (
    <PageShell
      title="Discovery"
      description="Ask the way an agent would — and see what it would find, and why."
    >
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>What do you want the agent to do?</h2>
          </Card.Title>
          <Card.Description>
            Describe the intent in natural language. Search combines two legs: the words in the
            text and the meaning of the sentence — and each result says which one matched.
          </Card.Description>
        </Card.Header>

        <form
          className="flex flex-col gap-3 px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            const limpo = rascunho.trim();
            if (limpo === '') return;
            setConsulta(limpo);
          }}
        >
          <div className="flex gap-2">
            <Input
              aria-label="Natural-language query"
              placeholder="e.g. convert foreign currency to reais"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
            />
            <Button type="submit" disabled={rascunho.trim() === '' || search.isFetching}>
              {search.isFetching ? 'Searching…' : 'Search'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            {/* Os dois filtros existem porque a descoberta ESCONDE esses estágios por padrão
                (M32). Sem poder ligá-los, ninguém verifica na tela que uma deprecada de fato
                saiu — que é exatamente o comportamento que aquele milestone promete. */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Include drafts"
                checked={incluirRascunhos}
                onChange={(e) => setIncluirRascunhos(e.target.checked)}
              />
              <span>Include drafts</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Include deprecated"
                checked={incluirDescontinuadas}
                onChange={(e) => setIncluirDescontinuadas(e.target.checked)}
              />
              <span>Include deprecated</span>
            </label>
          </div>
        </form>
      </Card>

      {failed ? (
        <Alert
          intent="destructive"
          title="The search could not run"
          description={promotionRefusal(search.error, 'Try again in a moment.')}
          // Erro com AÇÃO, não só com texto: `DESIGN.md` §4 — um erro sem saída deixa o operador
          // olhando para uma tela que não muda.
          action={
            <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Results</h2>
          </Card.Title>
          <Card.Description>
            {consulta === ''
              ? 'No search yet.'
              : `${rows.length} result(s) for "${consulta}", ordered by how well they matched.`}
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={colunas}
          data={rows}
          rowKey={(row) => row.skillId}
          loading={search.isFetching}
          emptyState={
            <EmptyState
              icon={Search}
              title={
                consulta === ''
                  ? 'Ask something'
                  : failed
                    ? 'No data — the search failed'
                    : 'Nothing matched that intent'
              }
              description={
                consulta === ''
                  ? 'Describe above what you want the agent to do. You will see what it would find, how well it matched, and why.'
                  : failed
                    ? 'This does NOT mean the registry is empty — the read never happened.'
                    : 'No skill in the registry matched. Try other words, or tick "include drafts" — discovery hides them by default.'
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
