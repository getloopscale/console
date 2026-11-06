// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { buildTracesUrl, spanAttrQuery, TRACES_ROUTE } from './build-url';
import { decodeColumns, type ColumnState } from './view-encoding';

/**
 * B-043 — o lens passa a ser dono da rota e da DSL de span-query.
 *
 * Antes, `promptly/traces-link.ts` importava `view-encoding` tres niveis dentro
 * do lens e reimplementava, do seu lado, a rota `/observability/traces` e o
 * formato `attr:chave=valor`. Duplicar contrato entre features falha em silencio:
 * se o lens mudar o separador da DSL, o link do promptly nao quebra a compilacao
 * — so chega ao explorador sem filtrar nada.
 */
describe('buildTracesUrl (B-043)', () => {
  const colunas: ColumnState = {
    visibility: { model: false, latency: true, tokens: false, cost: false, evals: false },
    density: 'comfortable',
  };

  it('sem opcoes, devolve a rota limpa — sem "?" pendurado', () => {
    expect(buildTracesUrl()).toBe(TRACES_ROUTE);
    expect(buildTracesUrl({})).toBe(TRACES_ROUTE);
  });

  it('carrega o span_query quando ha filtro', () => {
    const url = new URL(buildTracesUrl({ spanQuery: 'attr:prompt.id=saudacao' }), 'http://x');
    expect(url.pathname).toBe(TRACES_ROUTE);
    expect(url.searchParams.get('span_query')).toBe('attr:prompt.id=saudacao');
  });

  it('serializa as colunas de forma que o proprio lens decodifica de volta', () => {
    const url = new URL(buildTracesUrl({ columns: colunas }), 'http://x');
    const cols = url.searchParams.get('cols');
    expect(cols).not.toBeNull();
    // Ida e volta pelo decodificador real — nao uma comparacao de string que eu
    // poderia escrever para dar verde.
    expect(decodeColumns(cols!)).toEqual(colunas);
  });

  it('escapa valor hostil — nao vira um segundo parametro nem trunca a query', () => {
    const hostil = 'x&admin=1#frag';
    const url = new URL(
      buildTracesUrl({ spanQuery: spanAttrQuery('prompt.id', hostil) }),
      'http://x',
    );
    expect(url.searchParams.get('span_query')).toBe(`attr:prompt.id=${hostil}`);
    expect(url.searchParams.get('admin')).toBeNull();
    expect(url.hash).toBe('');
  });
});

describe('spanAttrQuery (B-043)', () => {
  it('monta o predicado no formato da DSL', () => {
    expect(spanAttrQuery('prompt.id', 'saudacao')).toBe('attr:prompt.id=saudacao');
  });

  it('preserva "=" no valor — a DSL separa no PRIMEIRO', () => {
    // Um nome com "=" e valido; quem chama nao deve precisar saber disso.
    expect(spanAttrQuery('prompt.id', 'a=b')).toBe('attr:prompt.id=a=b');
  });

  it('preserva valor vazio sem inventar um predicado diferente', () => {
    expect(spanAttrQuery('prompt.id', '')).toBe('attr:prompt.id=');
  });
});
