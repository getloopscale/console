import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
} from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { discoveryRows, type DiscoveryRow, type RetrievePayload } from '@/components/skills/discovery';
import { promotionRefusal, retrieveSkills } from '@/components/skills/skills-api';

/**
 * M31 — `/skills/descoberta`: a razão de existir do produto, finalmente com tela.
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
  useEffect(() => setPageTitle('Descoberta'), [setPageTitle]);
  useRequireAuth();

  const [rascunho, setRascunho] = useState('');
  // A consulta SUBMETIDA é estado separado do que está sendo digitado: buscar a cada tecla
  // dispararia uma busca vetorial por caractere — cara no servidor e piscante na tela.
  const [consulta, setConsulta] = useState('');
  const [incluirRascunhos, setIncluirRascunhos] = useState(false);
  const [incluirDescontinuadas, setIncluirDescontinuadas] = useState(false);

  const busca = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills:retrieve', consulta, incluirRascunhos, incluirDescontinuadas] as const,
    queryFn: () => retrieveSkills<RetrievePayload>(consulta, TOP_K, incluirRascunhos, incluirDescontinuadas),
    enabled: consulta !== '',
    // Uma consulta que não casa com nada é uma RESPOSTA, não uma falha: repetir não muda o
    // resultado e só gasta a paciência de quem espera.
    retry: false,
  });

  const linhas = discoveryRows(busca.data);
  const falhou = Boolean(busca.error);

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
      label: 'O que faz',
      render: (row) => <span className="text-muted-foreground">{row.description}</span>,
    },
    {
      key: 'score',
      label: 'Quanto casou',
      // `null` vira "—", não "0.000": zero afirma "casou muito mal", e um registro que não
      // devolveu o campo não disse isso.
      render: (row) => (
        <span className="font-mono text-xs">{row.score === null ? '—' : row.score.toFixed(3)}</span>
      ),
    },
    {
      key: 'legText',
      label: 'Por que apareceu',
      // A METADE que a DoD exige e que nenhuma tela tinha. Em texto, não em cor nem em ícone:
      // "as palavras batem" e "entendeu a intenção" levam o operador a conclusões diferentes
      // sobre a qualidade do acervo.
      render: (row) => <Badge variant="outline">{row.legText}</Badge>,
    },
  ];

  return (
    <PageShell
      title="Descoberta"
      description="Pergunte como um agente perguntaria — e veja o que ele encontraria, com o motivo."
    >
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>O que você quer que o agente faça?</h2>
          </Card.Title>
          <Card.Description>
            Descreva a intenção em linguagem natural. A busca combina duas pernas: as palavras do
            texto e o significado da frase — e cada resultado diz qual delas casou.
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
              aria-label="Consulta em linguagem natural"
              placeholder="ex.: converter moeda estrangeira para reais"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
            />
            <Button type="submit" disabled={rascunho.trim() === '' || busca.isFetching}>
              {busca.isFetching ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            {/* Os dois filtros existem porque a descoberta ESCONDE esses estágios por padrão
                (M32). Sem poder ligá-los, ninguém verifica na tela que uma deprecada de fato
                saiu — que é exatamente o comportamento que aquele milestone promete. */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Incluir rascunhos"
                checked={incluirRascunhos}
                onChange={(e) => setIncluirRascunhos(e.target.checked)}
              />
              <span>Incluir rascunhos</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Incluir descontinuadas"
                checked={incluirDescontinuadas}
                onChange={(e) => setIncluirDescontinuadas(e.target.checked)}
              />
              <span>Incluir descontinuadas</span>
            </label>
          </div>
        </form>
      </Card>

      {falhou ? (
        <Alert
          intent="destructive"
          title="A busca não pôde ser feita"
          description={promotionRefusal(busca.error, 'Tente novamente em instantes.')}
          // Erro com AÇÃO, não só com texto: `DESIGN.md` §4 — um erro sem saída deixa o operador
          // olhando para uma tela que não muda.
          action={
            <Button variant="secondary" size="sm" onClick={() => void busca.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Resultados</h2>
          </Card.Title>
          <Card.Description>
            {consulta === ''
              ? 'Nenhuma busca feita ainda.'
              : `${linhas.length} resultado(s) para "${consulta}", em ordem de quanto casou.`}
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={colunas}
          data={linhas}
          rowKey={(row) => row.skillId}
          loading={busca.isFetching}
          emptyState={
            <EmptyState
              icon={Search}
              title={
                consulta === ''
                  ? 'Pergunte algo'
                  : falhou
                    ? 'Sem dados — a busca falhou'
                    : 'Nada casou com essa intenção'
              }
              description={
                consulta === ''
                  ? 'Descreva acima o que você quer que o agente faça. Você verá o que ele encontraria, com o quanto casou e por quê.'
                  : falhou
                    ? 'Isto NÃO significa que o acervo está vazio — a leitura não chegou a acontecer.'
                    : 'Nenhuma skill do acervo casou. Tente outras palavras, ou marque "incluir rascunhos" — a descoberta os esconde por padrão.'
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
