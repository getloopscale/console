import { Badge, Button, type DataTableColumn } from '@usetheo/ui';
import type { LinhaDeUso } from '@/components/promptly/usage';
import type { RevisionRow } from '@/components/promptly/projections';
import type { ResultadoRollback } from '@/components/promptly/rollback';

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
  readonly usoPorRevisao: ReadonlyMap<number, LinhaDeUso>;
  /** Para onde cada ambiente aponta AGORA (M1) — a coluna de promoção precisa saber. */
  readonly ponteiros: readonly { readonly label: string; readonly version: number }[];
  /** Abre o diálogo de reversão para uma revisão. */
  readonly setAlvo: (versao: number) => void;
  /** Janela declarada do agregado de uso (M15) — a coluna a exibe, nunca a supõe. */
  readonly janelaDias: number;
  /**
   * Os setters que os dois botões da linha acionam.
   *
   * Passados explicitamente porque a linha da tabela é o gatilho de dois atos com consequência —
   * reverter e promover. Quem lê esta assinatura vê que a coluna PODE disparar os dois, em vez de
   * descobrir isso caçando closures no meio de 135 linhas de JSX.
   */
  readonly setRevAlvo: (v: number | null) => void;
  readonly setLabelAlvo: (l: string) => void;
  readonly setPromoteError: (e: string | null) => void;
  readonly setRollbackErro: (e: string | null) => void;
  readonly setRollbackResultado: (r: ResultadoRollback | null) => void;
  readonly setLabelRollback: (l: string | null) => void;
  readonly setLabelsParaEscolher: (l: string[]) => void;
}

export function revisionColumns({
  usoPorRevisao,
  ponteiros,
  setAlvo,
  janelaDias,
  setRevAlvo,
  setLabelAlvo,
  setPromoteError,
  setRollbackErro,
  setRollbackResultado,
  setLabelRollback,
  setLabelsParaEscolher,
}: DepsDasColunas): DataTableColumn<RevisionRow>[] {
  return [
  {
    key: 'version',
    label: 'Revisão',
    render: (row) => <span className="font-mono text-xs">v{row.version}</span>,
  },
  {
    key: 'preview',
    // M12: o corpo INTEIRO, não o trecho. Truncar servia para reconhecer a revisão numa lista;
    // decidir se ela é a certa exige ler o que o modelo de fato recebe. As variáveis vêm de
    // `variables`, que o serviço DECLARA — nunca de um regex nosso sobre o texto.
    label: 'Conteúdo da revisão',
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
            <span className="italic text-muted-foreground">sem descrição</span>
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
    label: `Uso (${String(janelaDias)} dias)`,
    render: (row) => {
      const u = usoPorRevisao.get(row.version);
      if (u === undefined || u.estado === 'nao-lido') {
        // Nunca um zero: um zero aqui afirmaria um fato que ninguém mediu.
        return (
          <span className="text-xs text-destructive">
            {u?.razao ?? 'não consegui ler o uso deste prompt'}
          </span>
        );
      }
      if (u.estado === 'sem-chamadas') {
        return <span className="text-xs text-muted-foreground">sem chamadas no período</span>;
      }
      return (
        <div className="space-y-0.5">
          <div className="font-mono text-xs">{u.chamadas}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {u.latenciaP50Ms !== undefined ? `${u.latenciaP50Ms.toFixed(1)} ms` : 'latência não medida'}
            {u.tokens !== undefined ? ` · ${String(u.tokens)} tokens` : null}
          </div>
          {u.custoUsd !== undefined ? (
            <div className="font-mono text-[10px] text-muted-foreground">
              US$ {u.custoUsd.toFixed(4)}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              {u.razaoDoCusto} — o custo só é atribuído quando a resolução e a chamada ao
              modelo acontecem no mesmo trace
            </div>
          )}
        </div>
      );
    },
  },
  {
    key: 'reverter',
    label: 'Reverter',
    render: (row) => (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Reverter para a revisão v${row.version}`}
        onClick={() => {
          setRollbackErro(null);
          setRollbackResultado(null);
          // Um único label ⇒ já se sabe qual move. Vários ⇒ o serviço recusa com a lista, e a
          // recusa vira a escolha. Zero ⇒ segue sem label, e o resultado dirá que nada mudou.
          setLabelRollback(ponteiros.length === 1 ? ponteiros[0].label : null);
          setLabelsParaEscolher([]);
          setRevAlvo(row.version);
        }}
      >
        Reverter
      </Button>
    ),
  },
  {
    key: 'acoes',
    label: 'Promover',
    render: (row) => (
      <div className="flex flex-wrap gap-2">
        {ponteiros.length === 0 ? (
          <span className="text-xs text-muted-foreground">nenhum label neste prompt</span>
        ) : (
          ponteiros.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="secondary"
              aria-label={`Promover ${p.label} para a revisão v${row.version}`}
              onClick={() => {
                setPromoteError(null);
                setLabelAlvo(p.label);
                setAlvo(row.version);
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
