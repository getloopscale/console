import { describe, expect, it } from 'vitest';
import { decodeColumns, encodeColumns } from '../lens/traces/view-encoding';
import { COLUNAS_DE_RESOLUCAO, linkParaTracesDoPrompt } from './traces-link';

// M23 — o caminho da aba do prompt até as resoluções individuais.
//
// A construção da URL mora fora do React porque é uma regra, não uma marcação: o serviço aceita
// `z.string().min(1)` para o nome do prompt, sem restrição de caractere, e o destino separa
// chave/valor no PRIMEIRO `=`. Testar isso numa string pura é mais barato e mais determinístico
// que dentro de um `render()`.

describe('linkParaTracesDoPrompt — o filtro (T1.1)', () => {
  it('carrega o filtro do prompt na chave que o destino lê', () => {
    const url = new URL(linkParaTracesDoPrompt('saudacao'), 'https://x');
    expect(url.pathname).toBe('/observability/traces');
    expect(url.searchParams.get('span_query')).toBe('attr:prompt.id=saudacao');
  });

  it('um nome hostil produz UM parâmetro, e aponta para o prompt certo', () => {
    // `&` injetaria um segundo parâmetro e `#` truncaria a query — o operador cairia nos traces
    // de OUTRO prompt, sem erro nenhum. É o defeito que o M22 pagou no link irmão.
    const nome = 'time/greeting&x#y';
    const url = new URL(linkParaTracesDoPrompt(nome), 'https://x');
    expect(url.searchParams.getAll('span_query')).toHaveLength(1);
    expect(url.searchParams.get('span_query')).toBe(`attr:prompt.id=${nome}`);
    expect(url.hash).toBe('');
  });

  it('recusa nome vazio com erro tipado que nomeia o campo', () => {
    // Fail-fast na fronteira: um link para "prompt nenhum" leva o operador a uma lista do
    // workspace inteiro achando que é deste prompt.
    expect(() => linkParaTracesDoPrompt('   ')).toThrowError(/promptName/);
  });
});

describe('linkParaTracesDoPrompt — as colunas (T1.2)', () => {
  it('esconde o que é sempre vazio numa resolução, e mantém a duração', () => {
    // Resolver um prompt não chama modelo nem avalia: tokens, custo e evals vêm vazios.
    // A duração é informação real (medido no app-dev: 1–17 ms).
    const url = new URL(linkParaTracesDoPrompt('saudacao'), 'https://x');
    const estado = decodeColumns(url.searchParams.get('cols'));
    expect(estado.visibility).toMatchObject({
      latency: true,
      tokens: false,
      cost: false,
      evals: false,
    });
  });

  it('o cols é PRODUZIDO pelo encoder real, nunca colado', () => {
    // A codificação é `v1:<base64(JSON)>` e `decodeColumns` descarta TUDO em silêncio na versão
    // errada (view-encoding.ts:39-42). Um literal colado quebra sem erro visível no dia em que a
    // versão subir — e o destino volta a mostrar as colunas vazias que este link existe para
    // evitar. Comparar com `encodeColumns` faz este teste quebrar nesse dia.
    const url = new URL(linkParaTracesDoPrompt('saudacao'), 'https://x');
    expect(url.searchParams.get('cols')).toBe(encodeColumns(COLUNAS_DE_RESOLUCAO));
  });
});
