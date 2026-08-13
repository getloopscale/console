import { Badge, Button, type DataTableColumn } from '@usetheo/ui';
import type { UsageRow } from '@/pages/promptly/components/usage';
import type { RevisionRow } from '@/pages/promptly/components/projections';
import type { ResultadoRollback } from '@/pages/promptly/components/rollback';

/**
 * As colunas da tabela de revisões — extraídas do detalhe (M21).
 *
 * Saem de lá por tamanho, não por arquitetura: são ~135 linhas de JSX que respondem sempre a mesma
 * pergunta ("como esta revisão se apresenta numa lista"), e mantê-las junto do composition root da
 * tela empurrava o arquivo para perto de mil linhas.
 *
 * As três dependências são passadas explicitamente, e não capturadas por closure de módulo: quem lê
 * a assinatura sabe exatamente do que a renderização depende.
 */
export interface DepsDasColunas {
  /** Uso por revisão (M15), já projetado — a coluna só formata. */
  readonly usageByRevision: ReadonlyMap<number, UsageRow>;
  /** Para onde cada ambiente aponta AGORA (M1) — a coluna de promoção precisa saber. */
  readonly ponteiros: readonly { readonly label: string; readonly version: number }[];
  /** Abre o diálogo de reversão para uma revisão. */
  readonly setTarget: (versao: number) => void;
  /** Janela declarada do agregado de uso (M15) — a coluna a exibe, nunca a supõe. */
  readonly windowDays: number;
  /**
   * Os setters que os dois botões da linha acionam.
   *
   * Passados explicitamente porque a linha da tabela é o gatilho de dois atos com consequência —
   * reverter e promover. Quem lê esta assinatura vê que a coluna PODE disparar os dois, em vez de
   * descobrir isso caçando closures no meio de 135 linhas de JSX.
   */
  readonly setTargetRevision: (v: number | null) => void;
  readonly setTargetLabel: (l: string) => void;
  readonly setPromoteError: (e: string | null) => void;
  readonly setRollbackError: (e: string | null) => void;
  readonly setRollbackResultado: (r: ResultadoRollback | null) => void;
  readonly setLabelRollback: (l: string | null) => void;
  readonly setLabelsToChoose: (l: string[]) => void;
}

export function revisionColumns({
  usageByRevision,
  ponteiros,
  setTarget,
  windowDays,
  setTargetRevision,
  setTargetLabel,
  setPromoteError,
  setRollbackError,
  setRollbackResultado,
  setLabelRollback,
  setLabelsToChoose,
}: DepsDasColunas): DataTableColumn<RevisionRow>[] {
  return [
  {
    key: 'version',
    label: 'Revision',
    render: (row) => <span className="font-mono text-xs">v{row.version}</span>,
  },
  {
    key: 'preview',
    // M12: o corpo INTEIRO, não o trecho. Truncar servia para reconhecer a revisão numa lista;
    // decidir se ela é a certa exige ler o que o modelo de fato recebe. As variáveis vêm de
    // `variables`, que o serviço DECLARA — nunca de um regex nosso sobre o texto.
    label: 'Revision content',
    render: (row) => (
      <div className="space-y-1">
        <pre className="max-w-xl whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {row.content || '(vazio)'}
        </pre>
        {/* M17 — o porquê da revisão. "sem descrição" e não vazio: as revisões
            anteriores ao milestone não têm, e inventar uma retroativamente
            apareceria numa auditoria como fato. */}
        <div className="text-xs">
          {row.changeDescription !== null ? (
            <span className="text-foreground">{row.changeDescription}</span>
          ) : (
            <span className="italic text-muted-foreground">no description</span>
          )}
          {row.modelConfig !== null ? (
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
              {[
                row.modelConfig.temperature !== undefined
                  ? `temperature ${String(row.modelConfig.temperature)}`
                  : null,
                row.modelConfig.model ?? null,
              ]
                .filter((x) => x !== null)
                .join(' · ')}
            </span>
          ) : null}
        </div>
        {row.variables.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.variables.map((v) => (
              <Badge key={v} variant="accent" className="font-mono text-[10px]">
                {v}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: 'uso',
    label: `Usage (${String(windowDays)} days)`,
    render: (row) => {
      const u = usageByRevision.get(row.version);
      if (u === undefined || u.estado === 'nao-lido') {
        // Nunca um zero: um zero aqui afirmaria um fato que ninguém mediu.
        return (
          <span className="text-xs text-destructive">
            {u?.rationale ?? 'could not read this prompt usage'}
          </span>
        );
      }
      if (u.estado === 'sem-chamadas') {
        return <span className="text-xs text-muted-foreground">no calls in the period</span>;
      }
      return (
        <div className="space-y-0.5">
          <div className="font-mono text-xs">{u.chamadas}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {u.latenciaP50Ms !== undefined ? `${u.latenciaP50Ms.toFixed(1)} ms` : 'latency not measured'}
            {u.tokens !== undefined ? ` · ${String(u.tokens)} tokens` : null}
          </div>
          {u.costUsd !== undefined ? (
            <div className="font-mono text-[10px] text-muted-foreground">
              US$ {u.costUsd.toFixed(4)}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              {u.costRationale} — cost is only attributed when the resolution and the model call
              happen in the same trace
            </div>
          )}
        </div>
      );
    },
  },
  {
    key: 'reverter',
    label: 'Roll back',
    render: (row) => (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Roll back to revision v${row.version}`}
        onClick={() => {
          setRollbackError(null);
          setRollbackResultado(null);
          // Um único label ⇒ já se sabe qual move. Vários ⇒ o serviço recusa com a lista, e a
          // recusa vira a escolha. Zero ⇒ segue sem label, e o resultado dirá que nada mudou.
          setLabelRollback(ponteiros.length === 1 ? ponteiros[0].label : null);
          setLabelsToChoose([]);
          setTargetRevision(row.version);
        }}
      >
        Roll back
      </Button>
    ),
  },
  {
    key: 'acoes',
    label: 'Promote',
    render: (row) => (
      <div className="flex flex-wrap gap-2">
        {ponteiros.length === 0 ? (
          <span className="text-xs text-muted-foreground">no label on this prompt</span>
        ) : (
          ponteiros.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="secondary"
              aria-label={`Promote ${p.label} to revision v${row.version}`}
              onClick={() => {
                setPromoteError(null);
                setTargetLabel(p.label);
                setTarget(row.version);
              }}
            >
              {p.label}
            </Button>
          ))
        )}
      </div>
    ),
  },
  ];
}
