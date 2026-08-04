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
export interface LinhaDoAgregado {
  readonly revision: number;
  readonly resolutions: number;
  readonly totalTokens: number;
  /** `null` quando o lens não soube precificar o modelo. Nunca estimado. */
  readonly costUsd: number | null;
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
  /** Ausente quando o provider não reportou custo. Ver `razaoDoCusto`. */
  readonly custoUsd?: number;
  readonly razaoDoCusto?: string;
  /** Por que não foi possível ler. Só existe no estado `nao-lido`. */
  readonly razao?: string;
}

const SEM_PRECO = 'o provider não reportou custo para este modelo';

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
      ...(linha.costUsd === null
        ? { razaoDoCusto: SEM_PRECO }
        : { custoUsd: linha.costUsd }),
    };
  });
}
