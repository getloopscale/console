import { Link } from 'react-router-dom';
import { linkToPromptTraces } from '../traces-link';
import { Card } from '@getloopscale/ui';
import { Alert } from '@/components/ui/alert-guard';
import type { UsageRow } from '@/pages/promptly/components/usage';
import type { Dependente } from '@/pages/promptly/components/composicao';

export interface ProductionTabProps {
  readonly windowDays: number;
  readonly rows: readonly UsageRow[];
  /** Quem referencia este prompt (M20 DoD-4). */
  readonly dependentes: readonly Dependente[];
  readonly dependentesIlegiveis: boolean;
  readonly dependentsLoading: boolean;
  /** O nome do prompt. Alimenta DOIS caminhos: o monitor (M22) e os traces (M23).
   *  Pode chegar vazio — `detail.tsx` declara `const { promptName = '' }`; os dois caminhos
   *  lidam com isso sem derrubar a aba. */
  readonly promptName: string;
}

/**
 * M21 — *uso em produção*: quem usou este prompt, e o que uma mudança nele afeta.
 *
 * Junta as duas perguntas que olham para FORA do prompt. O uso por revisão (M15) responde *"a v6
 * ficou mais cara que a v5?"*; a lista de dependentes (M20) responde *"quem quebra se eu mexer
 * aqui?"*. Empilhadas na aba de conteúdo, as duas competiam com o texto; separadas, cada uma é lida
 * quando a pergunta é feita.
 */
export function ProductionTab({
  windowDays,
  rows,
  dependentes,
  dependentesIlegiveis,
  dependentsLoading,
  promptName,
}: ProductionTabProps) {
  // M23 — `null` quando não há prompt; o helper não lança (ver traces-link.ts).
  const linkDosTraces = linkToPromptTraces(promptName);
  // M23 — houve chamada MEDIDA? `com-uso` é o único estado que autoriza falar em "cada uma delas".
  // `sem-chamadas` e `nao-lido` são fatos diferentes entre si e ambos diferentes de "houve uso" —
  // a distinção que este arquivo defende em dois outros lugares.
  const houveChamada = rows.some((l) => l.estado === 'com-uso');

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Usage by revision</h2>
          </Card.Title>
          <Card.Description>
            A <strong>{`${windowDays}-day`}</strong> window, stated rather than implied: an “all time”
            aggregate scans the span table of the whole ecosystem, and a window that does not
            declare itself makes the operator attribute the number to the wrong period.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions to report.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 font-medium">Revision</th>
                  <th className="pb-2 font-medium">Chamadas</th>
                  <th className="pb-2 font-medium">Tokens</th>
                  <th className="pb-2 font-medium">p50 latency</th>
                  <th className="pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.revision} className="border-t">
                    <td className="py-1.5 font-mono text-xs">v{l.revision}</td>
                    {l.estado === 'nao-lido' ? (
                      // "Não consegui ler" e "não houve uso" são fatos DIFERENTES. Um zero aqui
                      // afirmaria uma medição que ninguém fez, e o operador leria "ninguém usa".
                      <td colSpan={4} className="py-1.5 text-xs text-muted-foreground">
                        {l.rationale ?? 'could not read the usage of this revision'}
                      </td>
                    ) : l.estado === 'sem-chamadas' ? (
                      <td colSpan={4} className="py-1.5 text-xs text-muted-foreground">
                        no calls in the period
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5">{l.chamadas ?? 0}</td>
                        <td className="py-1.5">{l.tokens ?? 0}</td>
                        <td className="py-1.5">
                          {l.latenciaP50Ms === undefined ? '—' : `${String(l.latenciaP50Ms)} ms`}
                        </td>
                        <td className="py-1.5">
                          {l.costUsd === undefined ? (
                            <span
                              className="text-xs text-muted-foreground"
                              title={l.costRationale ?? undefined}
                            >
                              —
                            </span>
                          ) : (
                            `US$ ${l.costUsd.toFixed(4)}`
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Os dois caminhos que partem do número acima. Um olha para trás — o que aconteceu (M23);
          o outro para frente — avise-me quando mudar (M22). Ficam juntos porque respondem à mesma
          reação: o operador viu um número e quer agir sobre ele. */}
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        {/* M23 — os spans de resolução já existiam, já indexados por prompt no `looptrace`, e a
            única forma de chegar neles era digitar a URL.

            DUAS guardas, e nenhuma é zelo:

            (a) `linkDosTraces === null` quando não há nome. O helper devolve `null` em vez de
                lançar — um `throw` avaliado aqui, no render, faria o ErrorBoundary trocar a tela
                de detalhe inteira por "This page crashed", com um Retry que estoura de novo.

            (b) `houveChamada` — sem isto o convite dizia "o que aconteceu NESSAS chamadas" logo
                abaixo de "Nenhuma revisão para reportar", ou de "não foi possível ler o uso".
                O pronome apontava para um número que não estava lá. Este arquivo já defende essa
                distinção duas vezes (o `nao-lido` da tabela, o Alert dos dependentes); o convite
                a apagava. Com leitura falha o caminho some — oferecer "veja as chamadas" quando
                não se sabe se houve chamada é afirmar o que não se mediu. */}
        {linkDosTraces !== null && houveChamada ? (
          <p>
            Want to see each of them?{' '}
            <Link
              to={linkDosTraces}
              aria-label={`See ${promptName} runs in traces`}
              className="font-medium text-primary underline underline-offset-2"
            >
              See this prompt runs in traces →
            </Link>
          </p>
        ) : null}
        {/* M22 DoD-3 — o caminho até o monitor. O número acima é o que um limite governaria, e o
            operador que o está olhando não tinha como saber que existe uma tela de alerta.

            Peso visual menor que o link acima: ler é reversível e não cria estado; definir um
            monitor cria estado persistente no workspace. `DESIGN.md § 4` — ações secundárias não
            competem com a primária. */}
        <p className="text-xs">
          Want to be told when this number changes?{' '}
          <Link
            to={`/observability/alerts?prompt=${encodeURIComponent(promptName)}`}
            aria-label={`Set a monitor for ${promptName}`}
            className="underline underline-offset-2"
          >
            Set a monitor for this prompt →
          </Link>
        </p>
      </div>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>What references this prompt</h2>
          </Card.Title>
          <Card.Description>
            Revisions of other prompts that compose this one. Promoting or changing here changes
            the text they produce.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {dependentesIlegiveis ? (
            // Falha de leitura NÃO é "ninguém depende de mim". A distinção muda a decisão: quem lê
            // "ninguém" promove tranquilo; quem lê "não consegui saber", não.
            <Alert
              intent="destructive"
              title="Could not read the dependents"
              description="This list is what tells you who is affected by a promotion. Do not read its absence as an absence of dependents."
            />
          ) : dependentsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : dependentes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prompt references this one. Changing it does not change anyone else text.
            </p>
          ) : (
            <ul className="space-y-1">
              {dependentes.map((d) => (
                <li key={`${d.name}-${String(d.version)}`} className="text-sm">
                  <Link
                    to={`/promptly/${encodeURIComponent(d.name)}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {d.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">v{d.version}</span>
                  {/* O `via` diz se uma PROMOÇÃO move esta aresta. Sem ele, as duas formas aparecem
                      idênticas e o operador segue promovendo às cegas, só que com lista maior. */}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {d.via.label !== null
                      ? `via ${d.via.label} (moves on promotion)`
                      : 'by version (pinned)'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
