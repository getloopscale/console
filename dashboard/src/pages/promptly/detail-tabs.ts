/**
 * M21 DoD-1 — o mapa das quatro abas do detalhe de um prompt.
 *
 * São quatro **perguntas diferentes** sobre o mesmo objeto: o que ele diz, como ele roda, quem o
 * usou, e como eu o consumo. Nossa tela empilhava as quatro numa coluna e fazia o operador rolar
 * por três respostas que não pediu para chegar na que pediu.
 *
 * O mapeamento vive **fora do React** porque é aqui que mora a decisão que erra em silêncio: uma
 * aba ativa errada não quebra nada — mostra a resposta certa sob o rótulo errado. É a mesma razão
 * pela qual a composição do M20 tem `composicao.ts`.
 */

/** Uma aba é uma pergunta. O `id` vazio é a rota índice — o endereço que já circulava. */
export interface Aba {
  readonly id: 'conteudo' | 'config' | 'producao' | 'consumo';
  readonly sufixo: string;
  readonly rotulo: string;
  /** A pergunta que ela responde — vai para a tela, não é comentário. */
  readonly pergunta: string;
}

export const ABAS: readonly Aba[] = [
  {
    id: 'conteudo',
    sufixo: '',
    rotulo: 'Content',
    pergunta: 'What this prompt says',
  },
  {
    id: 'config',
    sufixo: 'config',
    rotulo: 'Config',
    pergunta: 'What tuning it runs with',
  },
  {
    id: 'producao',
    sufixo: 'production',
    rotulo: 'Production usage',
    pergunta: 'Who used it, and what it cost',
  },
  {
    id: 'consumo',
    sufixo: 'consumption',
    rotulo: 'How to consume',
    pergunta: 'How do I call this from my code',
  },
];

/**
 * A rota de uma aba para um prompt.
 *
 * O nome é **codificado**: o M16 trouxe pastas, e `m16-sup/relatorio` é um NOME, não um caminho.
 * Sem codificar, a barra viraria segmento e a rota apontaria para lugar nenhum.
 */
export function rotaDaAba(nomeDoPrompt: string, aba: Aba['id']): string {
  const encontrada = ABAS.find((a) => a.id === aba);
  const base = `/promptly/${encodeURIComponent(nomeDoPrompt)}`;
  return encontrada === undefined || encontrada.sufixo === '' ? base : `${base}/${encontrada.sufixo}`;
}

/**
 * Qual aba um caminho representa — ou `null` quando ele não é uma aba do detalhe.
 *
 * `null` é um resultado, não uma falha: `playground` e `diff` são telas IRMÃS do detalhe, não abas
 * dele. Colapsá-las em `conteudo` acenderia a aba errada numa tela que nem é esta.
 *
 * Um caminho sem sufixo é a aba de conteúdo — é o endereço que já circulava, e o DoD-1 cobra
 * explicitamente que ele continue resolvendo. Links para ele existem no catálogo, no diff e na
 * lista de dependentes que o M20 acabou de criar.
 */
export function abaDaRota(caminho: string): Aba['id'] | null {
  const semBarraFinal = caminho.endsWith('/') ? caminho.slice(0, -1) : caminho;
  const partes = semBarraFinal.split('/').filter((p) => p !== '');
  // `promptly` + nome = detalhe sem sufixo. O nome vem codificado, então nunca contribui com um
  // segmento a mais, mesmo quando é uma pasta (`m16-sup%2Frelatorio`).
  if (partes[0] !== 'promptly' || partes.length < 2) return null;
  if (partes.length === 2) return 'conteudo';
  if (partes.length > 3) return null;

  const sufixo = partes[2];
  return ABAS.find((a) => a.sufixo !== '' && a.sufixo === sufixo)?.id ?? null;
}
