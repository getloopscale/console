import { Link } from 'react-router-dom';
import { Card } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import type { LinhaDeUso } from '@/components/promptly/usage';
import type { Dependente } from '@/components/promptly/composicao';

export interface ProducaoTabProps {
  readonly janelaDias: number;
  readonly linhas: readonly LinhaDeUso[];
  /** Quem referencia este prompt (M20 DoD-4). */
  readonly dependentes: readonly Dependente[];
  readonly dependentesIlegiveis: boolean;
  readonly dependentesCarregando: boolean;
  /** M22 — o nome do prompt, para o caminho até o monitor dele. */
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
export function ProducaoTab({
  janelaDias,
  linhas,
  dependentes,
  dependentesIlegiveis,
  dependentesCarregando,
  promptName,
}: ProducaoTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Uso por revisão</h2>
          </Card.Title>
          <Card.Description>
            Janela de <strong>{janelaDias} dias</strong>, dita e não implícita: um agregado “desde
            sempre” varre a tabela de spans do ecossistema inteiro, e uma janela que não se declara
            faz o operador atribuir o número ao período errado.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma revisão para reportar.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 font-medium">Revisão</th>
                  <th className="pb-2 font-medium">Chamadas</th>
                  <th className="pb-2 font-medium">Tokens</th>
                  <th className="pb-2 font-medium">Latência p50</th>
                  <th className="pb-2 font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.revision} className="border-t">
                    <td className="py-1.5 font-mono text-xs">v{l.revision}</td>
                    {l.estado === 'nao-lido' ? (
                      // "Não consegui ler" e "não houve uso" são fatos DIFERENTES. Um zero aqui
                      // afirmaria uma medição que ninguém fez, e o operador leria "ninguém usa".
                      <td colSpan={4} className="py-1.5 text-xs text-muted-foreground">
                        {l.razao ?? 'não foi possível ler o uso desta revisão'}
                      </td>
                    ) : l.estado === 'sem-chamadas' ? (
                      <td colSpan={4} className="py-1.5 text-xs text-muted-foreground">
                        sem chamadas no período
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5">{l.chamadas ?? 0}</td>
                        <td className="py-1.5">{l.tokens ?? 0}</td>
                        <td className="py-1.5">
                          {l.latenciaP50Ms === undefined ? '—' : `${String(l.latenciaP50Ms)} ms`}
                        </td>
                        <td className="py-1.5">
                          {l.custoUsd === undefined ? (
                            <span
                              className="text-xs text-muted-foreground"
                              title={l.razaoDoCusto ?? undefined}
                            >
                              —
                            </span>
                          ) : (
                            `US$ ${l.custoUsd.toFixed(4)}`
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

      {/* M22 DoD-3 — o caminho até o monitor. O número acima é o que um limite governaria, e o
          operador que o está olhando não tinha como saber que existe uma tela de alerta. O nome
          do prompt viaja no endereço: sem ele o operador chega numa tela vazia e digita de novo. */}
      <p className="text-sm text-muted-foreground">
        Quer ser avisado quando este número mudar?{' '}
        <Link
          to={`/observability/alerts?prompt=${encodeURIComponent(promptName)}`}
          className="font-medium text-primary underline underline-offset-2"
        >
          Definir um monitor para este prompt →
        </Link>
      </p>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Quem referencia este prompt</h2>
          </Card.Title>
          <Card.Description>
            Revisões de outros prompts que compõem este. Promover ou alterar aqui muda o texto que
            elas produzem.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {dependentesIlegiveis ? (
            // Falha de leitura NÃO é "ninguém depende de mim". A distinção muda a decisão: quem lê
            // "ninguém" promove tranquilo; quem lê "não consegui saber", não.
            <Alert
              intent="destructive"
              title="Não foi possível ler os dependentes"
              description="Esta lista é a que diz quem é afetado por uma promoção. Não trate a ausência dela como ausência de dependentes."
            />
          ) : dependentesCarregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : dependentes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum prompt referencia este. Alterá-lo não muda o texto de mais ninguém.
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
                      ? `via ${d.via.label} (move na promoção)`
                      : 'por versão (fixa)'}
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
