/**
 * M15 — projeção do uso observado por revisão.
 *
 * Lógica pura, fora do React, como as irmãs deste módulo: o que ela decide é o que
 * a tela **afirma** e o que ela **declara não saber**, e isso precisa ser testável
 * em milissegundos, sem browser.
 *
 * A regra que dá nome ao módulo: três estados distintos, nunca colapsados.
 *
 * | estado         | significa                                   | por que não pode virar zero |
 * |----------------|---------------------------------------------|------------------------------|
 * | `com-uso`      | houve resolução na janela                   | —                            |
 * | `sem-chamadas` | leu, e não houve resolução                  | zero e "não usaram" são o mesmo fato, mas… |
 * | `nao-lido`     | **não** consegui ler                        | …um zero aqui é uma AFIRMAÇÃO que ninguém mediu |
 *
 * O M13 mostrou que essa é a distinção onde a tela mente com mais facilidade, e o
 * DoD-3 deste milestone existe por causa disso.
 */

/** Uma linha do agregado do `theo-lens`, como ele a devolve. */
interface LinhaDoAgregado {
  readonly revision: number;
  readonly resolutions: number;
  readonly totalTokens: number;
  /** `null` quando o lens não soube precificar o modelo. Nunca estimado. */
  readonly costUsd: number | null;
  /** Latência MEDIANA da resolução, em ms. `null` quando não há amostra. */
  readonly p50LatencyMs: number | null;
}

export type AgregadoDeUso =
  | { readonly estado: 'lido'; readonly rows: readonly LinhaDoAgregado[] }
  | { readonly estado: 'nao-lido'; readonly razao: string };

export interface LinhaDeUso {
  readonly revision: number;
  readonly estado: 'com-uso' | 'sem-chamadas' | 'nao-lido';
  /** Ausente — e não `0` — quando não há uso ou não houve leitura. */
  readonly chamadas?: number;
  readonly tokens?: number;
  /** Latência mediana da resolução, em ms. Ausente quando o agregado não a trouxe. */
  readonly latenciaP50Ms?: number;
  /** Ausente quando o provider não reportou custo. Ver `razaoDoCusto`. */
  readonly custoUsd?: number;
  readonly razaoDoCusto?: string;
  /** Por que não foi possível ler. Só existe no estado `nao-lido`. */
  readonly razao?: string;
}

const SEM_PRECO = 'the provider reported no cost for this model';
/**
 * Nenhuma chamada de modelo compartilhou o trace da resolução — o limite declarado no ADR-1.
 *
 * MEDIDO NA ACEITAÇÃO, não previsto no plano: o `theo-lens` escreve `traces.cost_usd = 0`
 * (não `null`) para um trace sem span de LLM. A soma devolvia `0`, e a tela renderizava
 * "US$ 0.0000" — afirmando um custo MEDIDO onde não houve medição. O operador lê "barato";
 * a verdade é "não correlacionei". É o mesmo defeito contra o qual a contagem já se protegia,
 * um campo adiante.
 */
const SEM_CORRELACAO = 'no model call shared the trace of this resolution';

/**
 * Projeta o agregado sobre a lista de revisões do prompt.
 *
 * A lista de revisões é a fonte da **ordem** e da **completude** — o agregado apenas
 * a enriquece. Uma revisão que o agregado desconhece não some da tela (ela existe,
 * só não teve tráfego), e uma revisão que só o agregado conhece não vira linha
 * fantasma (o agregado pode carregar tráfego de revisão já apagada).
 */
export function projetarUso(
  agregado: AgregadoDeUso,
  revisoes: readonly number[],
): LinhaDeUso[] {
  if (agregado.estado === 'nao-lido') {
    // Nenhum número. Nem zero — sobretudo não zero.
    return revisoes.map((revision) => ({ revision, estado: 'nao-lido', razao: agregado.razao }));
  }

  const porRevisao = new Map(agregado.rows.map((r) => [r.revision, r]));
  return revisoes.map((revision) => {
    const linha = porRevisao.get(revision);
    if (linha === undefined || linha.resolutions === 0) {
      return { revision, estado: 'sem-chamadas' as const };
    }
    return {
      revision,
      estado: 'com-uso' as const,
      chamadas: linha.resolutions,
      tokens: linha.totalTokens,
      ...(linha.p50LatencyMs === null ? {} : { latenciaP50Ms: linha.p50LatencyMs }),
      // `totalTokens === 0` é o discriminante: sem tokens observados no trace, nenhuma
      // chamada de modelo foi correlacionada, e o `0` do lens não é uma medição de custo.
      // Com tokens, um zero É medido — um modelo gratuito existe, e o teste-controle prova
      // que a correção não descarta esse caso.
      ...(linha.costUsd === null
        ? { razaoDoCusto: SEM_PRECO }
        : linha.totalTokens === 0
          ? { razaoDoCusto: SEM_CORRELACAO }
          : { custoUsd: linha.costUsd }),
    };
  });
}
