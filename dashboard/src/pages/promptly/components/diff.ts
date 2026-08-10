/**
 * M12 T1 — comparação entre duas revisões de um prompt, FORA do React.
 *
 * Escrito em vez de importado por decisão medida (plano § ADR-1): não há biblioteca de diff
 * instalada no dashboard, e a árvore já carrega vulnerabilidades herdadas de dependências
 * transitivas — somar mais uma superfície de terceiros por UMA tela vai na direção errada.
 * O que o peer estudado faz de valioso não é o algoritmo (ele importa um `DiffViewer`); é
 * NORMALIZAR o que não é semântico antes de comparar. Essa parte seria nossa em qualquer
 * cenário, e é a que erra em silêncio.
 */

export type DiffKind = 'same' | 'added' | 'removed' | 'too-large';

export interface DiffBlock {
  readonly kind: DiffKind;
  readonly text: string;
}

/**
 * Acima disto a comparação é recusada, com aviso.
 *
 * `content` não tem limite de tamanho na API (medido: `z.string()` sem `.max()`), e LCS é
 * O(n·m) — duas revisões de milhares de linhas travariam a aba no event loop. Recusar e DIZER
 * é honesto; truncar em silêncio entregaria uma comparação incompleta com cara de completa.
 */
export const DIFF_LINE_CEILING = 2000;

/**
 * Tira o que varia sem mudar o sentido: fim de linha do editor e espaço no fim da linha.
 *
 * Deliberadamente NÃO toca espaçamento no meio da linha — num prompt, um espaço a mais depois
 * de `{{nome}}` muda o que o modelo recebe. Normalizar demais esconde mudança real, que é o
 * erro oposto e o mais perigoso dos dois.
 */
function normalizar(conteudo: string): string[] {
  return conteudo
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+$/, ''));
}

/** Comprimentos da maior subsequência comum — a tabela clássica, sem reconstrução recursiva. */
function tabelaLcs(a: readonly string[], b: readonly string[]): number[][] {
  const tabela: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      tabela[i][j] =
        a[i] === b[j] ? tabela[i + 1][j + 1] + 1 : Math.max(tabela[i + 1][j], tabela[i][j + 1]);
    }
  }
  return tabela;
}

/**
 * Compara duas revisões linha a linha, na ordem original.
 *
 * Granularidade de LINHA, não de palavra: responde a pergunta que o operador faz ("o que mudou
 * entre v2 e v3?") sem o custo — e os erros — de um diff por palavra escrito à mão.
 */
export function diffLines(anterior: string, novo: string): DiffBlock[] {
  const a = normalizar(anterior);
  const b = normalizar(novo);

  // O número que a tela mostra é o do LADO MAIOR, não a soma: é ele que estourou o teto, e é
  // o que o operador consegue relacionar com a revisão que tem na mão.
  const maiorLado = Math.max(a.length, b.length);
  if (maiorLado > DIFF_LINE_CEILING) {
    return [
      { kind: 'too-large', text: `${maiorLado} lines — above the ceiling of ${DIFF_LINE_CEILING}` },
    ];
  }

  const tabela = tabelaLcs(a, b);
  const blocos: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      blocos.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (tabela[i + 1][j] >= tabela[i][j + 1]) {
      blocos.push({ kind: 'removed', text: a[i] });
      i += 1;
    } else {
      blocos.push({ kind: 'added', text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) blocos.push({ kind: 'removed', text: a[i] });
  for (; j < b.length; j += 1) blocos.push({ kind: 'added', text: b[j] });
  return blocos;
}

/** Atalho para a tela: houve alguma diferença? Zero blocos alterados = revisões equivalentes. */
export function saoEquivalentes(blocos: readonly DiffBlock[]): boolean {
  return blocos.every((b) => b.kind === 'same');
}

/**
 * M17 DoD-4 — a comparação de CONFIG, ao lado do diff de texto e nunca dentro dele.
 *
 * Duas revisões com o mesmo texto e temperaturas diferentes são revisões diferentes, e o
 * comparador tinha de dizê-lo. `diffLines` continua sendo só de texto: misturar as duas
 * coisas faria uma mudança de config aparecer como linha alterada, que não é.
 *
 * A comparação é **por campo**, não por serialização: `JSON.stringify` acusaria diferença
 * quando só a ordem das chaves mudasse (EC-6).
 *
 * E `temperature: 0` **não** é o mesmo que ausente. Zero é uma afinação escolhida —
 * determinismo máximo —, e tratá-la como "sem config" apagaria a decisão de quem a tomou.
 */
export interface ConfigDeRevisao {
  readonly temperature?: number;
  readonly model?: string;
}

export interface LinhaDeConfig {
  readonly campo: string;
  readonly antes: string;
  readonly depois: string;
}

export interface DiffDeConfig {
  readonly mudou: boolean;
  readonly linhas: readonly LinhaDeConfig[];
}

/** O que a tela diz quando um dos lados é anterior ao milestone (ADR-1). */
const ANTERIOR = 'revision before the config';

function mostrar(cfg: ConfigDeRevisao | null | undefined, campo: 'temperature' | 'model'): string {
  // `!= null` cobre `null` E `undefined`: o primeiro vem do serviço, o segundo de uma
  // revisão cuja projeção nem chegou a olhar o campo. Os dois significam "não tem", e
  // tratá-los diferente faria a tela quebrar num dos caminhos.
  if (cfg == null) return ANTERIOR;
  const v = cfg[campo];
  // `undefined` e não falsy: `temperature: 0` tem de sair como "0", não como "—".
  return v === undefined ? '—' : String(v);
}

export function diffConfig(
  antes: ConfigDeRevisao | null | undefined,
  depois: ConfigDeRevisao | null | undefined,
): DiffDeConfig {
  if (antes == null && depois == null) return { mudou: false, linhas: [] };

  const campos = ['temperature', 'model'] as const;
  const linhas = campos
    .filter((campo) => mostrar(antes, campo) !== mostrar(depois, campo))
    .map((campo) => ({ campo, antes: mostrar(antes, campo), depois: mostrar(depois, campo) }));

  return { mudou: linhas.length > 0, linhas };
}
