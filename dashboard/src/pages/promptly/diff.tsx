import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, PageShell } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchRevisions } from '@/components/promptly/promptly-api';
import { diffLines, saoEquivalentes, DIFF_LINE_CEILING } from '@/components/promptly/diff';

/**
 * M12 T5 — `/promptly/:name/diff`: o que mudou entre duas revisões.
 *
 * A pergunta que traz o operador aqui é sempre a mesma e sempre urgente: *"o que mudou entre a
 * revisão que funcionava e a que está servindo agora?"*. Sem esta tela, respondê-la exigia
 * baixar as duas pela CLI e comparar à mão.
 *
 * A comparação em si é `components/promptly/diff.ts` — fora do React, testada sem browser,
 * incluindo o caso que prova que a normalização não foi longe demais.
 */

const REVISION_WINDOW = 50;

interface Revision {
  readonly version: number;
  readonly content: string;
}

export function PromptlyDiffPage() {
  const { name = '' } = useParams<{ name: string }>();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle(`Comparar — ${name}`), [setPageTitle, name]);
  useRequireAuth();

  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', name, 'revisions', 'diff'],
    queryFn: () => fetchRevisions<Revision[]>(name, REVISION_WINDOW),
    enabled: name !== '',
  });

  const revisoes = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  const ordenadas = useMemo(
    () => [...revisoes].sort((a, b) => b.version - a.version),
    [revisoes],
  );

  const [esquerda, setEsquerda] = useState<number | null>(null);
  const [direita, setDireita] = useState<number | null>(null);

  // Padrão útil: as duas mais recentes. É a comparação que o operador quase sempre quer, e
  // deixá-la pronta poupa dois cliques no momento em que ele tem menos paciência.
  useEffect(() => {
    if (ordenadas.length >= 2 && esquerda === null && direita === null) {
      setEsquerda(Number(params.get('from')) || ordenadas[1].version);
      setDireita(Number(params.get('to')) || ordenadas[0].version);
    }
  }, [ordenadas, esquerda, direita, params]);

  const a = ordenadas.find((r) => r.version === esquerda);
  const b = ordenadas.find((r) => r.version === direita);
  const blocos = a && b ? diffLines(a.content, b.content) : [];
  const grande = blocos.length === 1 && blocos[0].kind === 'too-large';
  const iguais = blocos.length > 0 && !grande && saoEquivalentes(blocos);

  const falhou = Boolean(query.error);

  return (
    <PageShell
      title={`Comparar revisões de ${name}`}
      description="O que mudou entre duas revisões — fim de linha e espaço no fim da linha são ignorados; espaçamento dentro da linha não, porque num prompt ele é conteúdo."
    >
      {falhou ? (
        <Alert
          intent="destructive"
          title="Não foi possível ler as revisões"
          description="A comparação abaixo está vazia porque a leitura falhou — isto NÃO significa que as revisões são iguais."
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Revisões</h2>
          </Card.Title>
          <Card.Description>
            <Link to={`/promptly/${encodeURIComponent(name)}`} className="underline-offset-4 hover:underline">
              Voltar para {name}
            </Link>
          </Card.Description>
        </Card.Header>

        <div className="flex flex-wrap gap-4 p-6 pt-0">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Antes</span>
            <select
              aria-label="Revisão anterior"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={esquerda ?? ''}
              onChange={(e) => setEsquerda(Number(e.target.value))}
            >
              {ordenadas.map((r) => (
                <option key={r.version} value={r.version}>v{r.version}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Depois</span>
            <select
              aria-label="Revisão posterior"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={direita ?? ''}
              onChange={(e) => setDireita(Number(e.target.value))}
            >
              {ordenadas.map((r) => (
                <option key={r.version} value={r.version}>v{r.version}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Diferenças</h2>
          </Card.Title>
        </Card.Header>

        <div className="p-6 pt-0">
          {ordenadas.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              {falhou
                ? 'Sem dados para comparar — a leitura falhou.'
                : 'Este prompt tem uma única revisão: não há o que comparar ainda.'}
            </p>
          ) : grande ? (
            <p data-testid="promptly-diff-too-large" className="text-sm text-muted-foreground">
              Comparação inline omitida: {blocos[0].text}. Acima de {DIFF_LINE_CEILING} linhas a
              comparação travaria a aba — abra as revisões lado a lado para inspecionar.
            </p>
          ) : iguais ? (
            <p data-testid="promptly-diff-identical" className="text-sm text-muted-foreground">
              As duas revisões têm o mesmo conteúdo. Se uma foi criada por reversão, é exatamente o
              esperado — reverter copia o texto e cria uma revisão nova.
            </p>
          ) : (
            <pre data-testid="promptly-diff" className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs">
              {blocos.map((bloco, i) => (
                <div
                  key={i}
                  className={
                    bloco.kind === 'added'
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                      : bloco.kind === 'removed'
                        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                        : 'text-muted-foreground'
                  }
                >
                  {bloco.kind === 'added' ? '+ ' : bloco.kind === 'removed' ? '- ' : '  '}
                  {bloco.text || ' '}
                </div>
              ))}
            </pre>
          )}
        </div>
      </Card>
    </PageShell>
  );
}

export default PromptlyDiffPage;
