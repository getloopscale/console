import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Card, PageShell } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePromptRevisions } from '@/hooks/promptly/use-promptly';
import {
  diffLines,
  diffConfig,
  saoEquivalentes,
  DIFF_LINE_CEILING,
  type ConfigDeRevisao,
} from '@/pages/promptly/components/diff';

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
  /**
   * M17 — aditivos e opcionais NO FIO: um serviço anterior ao milestone não os emite, e
   * uma revisão criada antes dele não os tem.
   *
   * Declará-los aqui não é zelo de tipagem — é o que faltava. `query.data` é `unknown`, e
   * `Array.isArray` o alarga para `any[]`: enquanto a interface omitia `modelConfig`, a
   * tela já o lia sem que o compilador pudesse reclamar. A omissão de `changeDescription`
   * custou o item "aparece no diff" do DoD-1, encontrado só na aceitação contra o app-dev.
   */
  readonly changeDescription?: unknown;
  readonly modelConfig?: ConfigDeRevisao | null;
}

/** O porquê de uma revisão, ou `null` quando ela nasceu antes do campo existir. */
function porqueDe(revisao: Revision | undefined): string | null {
  return typeof revisao?.changeDescription === 'string' && revisao.changeDescription !== ''
    ? revisao.changeDescription
    : null;
}

/**
 * O porquê de um dos lados da comparação.
 *
 * A ausência é DITA, não deixada em branco: um espaço vazio leria como "ninguém escreveu
 * nada", quando o fato é "esta revisão nasceu antes de o campo existir". A mesma redação
 * — e a mesma razão — da lista de revisões em `detail.tsx`.
 */
function Porque({ texto }: { readonly texto: string | null }) {
  return (
    <span className="mt-1 block max-w-[28rem] text-xs">
      {texto !== null ? (
        <span className="text-foreground">{texto}</span>
      ) : (
        <span className="italic text-muted-foreground">no description</span>
      )}
    </span>
  );
}

export function PromptlyDiffPage() {
  const { name = '' } = useParams<{ name: string }>();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle(`Compare — ${name}`), [setPageTitle, name]);
  useRequireAuth();

  const [params] = useSearchParams();
  const query = usePromptRevisions<Revision[]>(name, REVISION_WINDOW);

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
  // M17 DoD-4 — a config entra na decisão de "idênticas". Duas revisões com a mesma
  // redação e afinações diferentes SÃO revisões diferentes, e anunciá-las como iguais
  // era a mentira que este milestone corrige.
  const config = a && b ? diffConfig(a.modelConfig, b.modelConfig) : { mudou: false, linhas: [] };
  const iguais = blocos.length > 0 && !grande && saoEquivalentes(blocos) && !config.mudou;

  const falhou = Boolean(query.error);

  return (
    <PageShell
      title={`Compare revisions of ${name}`}
      description="What changed between two revisions — line endings and trailing whitespace are ignored; whitespace inside a line is not, because in a prompt it is content."
    >
      {falhou ? (
        <Alert
          intent="destructive"
          title="Could not read the revisions"
          description="The comparison below is empty because the read failed — this does NOT mean the revisions are identical."
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Revisions</h2>
          </Card.Title>
          <Card.Description>
            <Link to={`/promptly/${encodeURIComponent(name)}`} className="underline-offset-4 hover:underline">
              Back to {name}
            </Link>
          </Card.Description>
        </Card.Header>

        <div className="flex flex-wrap gap-4 p-6 pt-0">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Before</span>
            <select
              aria-label="Previous revision"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={esquerda ?? ''}
              onChange={(e) => setEsquerda(Number(e.target.value))}
            >
              {ordenadas.map((r) => (
                <option key={r.version} value={r.version}>v{r.version}</option>
              ))}
            </select>
            <Porque texto={porqueDe(a)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">After</span>
            <select
              aria-label="Next revision"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={direita ?? ''}
              onChange={(e) => setDireita(Number(e.target.value))}
            >
              {ordenadas.map((r) => (
                <option key={r.version} value={r.version}>v{r.version}</option>
              ))}
            </select>
            <Porque texto={porqueDe(b)} />
          </label>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Differences</h2>
          </Card.Title>
        </Card.Header>

        <div className="p-6 pt-0">
          {ordenadas.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              {falhou
                ? 'No data to compare — the read failed.'
                : 'This prompt has a single revision: there is nothing to compare yet.'}
            </p>
          ) : grande ? (
            <p data-testid="promptly-diff-too-large" className="text-sm text-muted-foreground">
              Inline comparison omitted: {blocos[0].text}. Above {DIFF_LINE_CEILING} lines the
              comparison would freeze the tab — open the revisions side by side to inspect.
            </p>
          ) : config.mudou && saoEquivalentes(blocos) ? (
            // Texto igual, config diferente: dizer só "idênticas" apagaria a diferença
            // que importa, e mostrar um diff de texto vazio não a explicaria.
            <div data-testid="promptly-diff-config" className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                The text is the same. What changed was the configuration the revision was tested with:
              </p>
              <ul className="space-y-1 font-mono text-xs">
                {config.linhas.map((l) => (
                  <li key={l.campo}>
                    <span className="text-muted-foreground">{l.campo}</span>{' '}
                    <span className="text-destructive">{l.antes}</span>
                    {' → '}
                    <span className="text-foreground">{l.depois}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : iguais ? (
            <p data-testid="promptly-diff-identical" className="text-sm text-muted-foreground">
              Both revisions have the same content. If one was created by a rollback, that is
              exactly what is expected — a rollback copies the text and creates a new revision.
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

