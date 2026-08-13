/**
 * M20 — composição: os dois textos, e quem depende de mim.
 *
 * Lógica **pura**, fora do React, porque é aqui que moram as decisões que erram em silêncio: qual
 * texto a tela mostra quando a resolução falhou, e o que uma lista de dependentes vazia significa.
 * Testar isso dentro de um componente exigiria montar a árvore inteira para afirmar uma projeção.
 */

/** Uma revisão que referencia o prompt aberto (`GET .../dependents`). */
export interface Dependente {
  readonly name: string;
  readonly version: number;
  /**
   * POR ONDE a referência aponta — e é o campo que torna a lista acionável.
   *
   * Só as referências por LABEL são movidas por uma promoção; as por versão são imutáveis. Sem esta
   * distinção o operador vê quarenta linhas e não sabe quais delas a promoção de fato afeta.
   */
  readonly via: { readonly version: number | null; readonly label: string | null };
}

/**
 * Projeta a resposta de dependentes, descartando o que não tiver a forma esperada.
 *
 * Defensiva de propósito: esta lista é a que o operador lê **antes de promover**, e uma linha
 * malformada renderizada como `undefined vundefined` é pior que ausente — parece um prompt real com
 * nome estranho, e alguém vai procurá-lo.
 */
export function dependentRows(data: unknown): Dependente[] {
  if (!Array.isArray(data)) return [];
  const out: Dependente[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const registro = item as Record<string, unknown>;
    const name = registro.name;
    const version = registro.version;
    if (typeof name !== 'string' || name === '') continue;
    if (typeof version !== 'number' || !Number.isFinite(version)) continue;
    const via = registro.via;
    const viaObj = typeof via === 'object' && via !== null ? (via as Record<string, unknown>) : {};
    out.push({
      name,
      version,
      via: {
        version: typeof viaObj.version === 'number' ? viaObj.version : null,
        label: typeof viaObj.label === 'string' ? viaObj.label : null,
      },
    });
  }
  return out;
}

/** Qual dos dois textos a tela está mostrando. */
export type TextMode = 'escrito' | 'resolvido';

/**
 * O que a área de texto deve exibir, dado o modo pedido e o que chegou de cada leitura.
 *
 * Três estados, e o terceiro é a razão de esta função existir: quando o modo é `resolvido` e a
 * resolução **falhou**, cair para o texto escrito seria mostrar um texto correto sob um rótulo
 * errado. O operador leria marcadores literais acreditando estar vendo o texto composto — e
 * concluiria que a composição não funciona, quando o que falhou foi a leitura.
 *
 * É a mesma regra que o `CLAUDE.md` deste repositório nomeia: falha de leitura não pode ser
 * renderizada como se fosse um estado normal do dado.
 */
export type DisplayedText =
  | { readonly estado: 'texto'; readonly text: string }
  | { readonly estado: 'carregando' }
  | { readonly estado: 'falhou' };

export function displayedText(
  modo: TextMode,
  written: string | null,
  resolution: { readonly loading: boolean; readonly failure: boolean; readonly text: string | null },
): DisplayedText {
  if (modo === 'escrito') {
    return written === null ? { estado: 'carregando' } : { estado: 'texto', text: written };
  }
  if (resolution.failure) return { estado: 'falhou' };
  if (resolution.loading || resolution.text === null) return { estado: 'carregando' };
  return { estado: 'texto', text: resolution.text };
}

/**
 * O prompt referencia alguém? Decide se o par de textos vale ser oferecido.
 *
 * Sem isso, todo prompt do catálogo ganharia um alternador entre dois textos idênticos — ruído numa
 * tela que já é densa, e um convite a pagar a travessia do grafo em prompts que não compõem nada.
 *
 * O marcador é reconhecido pela mesma forma que o serviço usa; o `(?!@)` à esquerda respeita o
 * escape `@@@@promptly:`, que existe para um prompt poder FALAR do marcador sem invocá-lo.
 */
const MARCADOR = /(?<!@)@@@promptly:[^@\s]*@@@/;

export function hasComposition(content: string | null): boolean {
  return content !== null && MARCADOR.test(content);
}
