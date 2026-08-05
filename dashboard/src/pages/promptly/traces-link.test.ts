import { describe, expect, it } from 'vitest';
import { decodeColumns } from '../lens/traces/view-encoding';
import { linkParaTracesDoPrompt } from './traces-link';

// M23 — o caminho da aba do prompt até as resoluções individuais.
//
// A construção da URL mora fora do React porque é uma regra, não uma marcação: o serviço aceita
// `z.string().min(1)` para o nome do prompt, sem restrição de caractere, e o destino separa
// chave/valor no PRIMEIRO `=`. Testar isso numa string pura é mais barato e mais determinístico
// que dentro de um `render()`.

/** O helper devolve `string | null`; nos casos de sucesso o `null` é falha de teste, não de tipo. */
function linkDe(nome: string): URL {
  const href = linkParaTracesDoPrompt(nome);
  expect(href).not.toBeNull();
  return new URL(href as string, 'https://x');
}

describe('linkParaTracesDoPrompt — o filtro (T1.1)', () => {
  it('carrega o filtro do prompt na chave que o destino lê', () => {
    const url = linkDe('saudacao');
    expect(url.pathname).toBe('/observability/traces');
    expect(url.searchParams.get('span_query')).toBe('attr:prompt.id=saudacao');
  });

  it('um nome com `=` chega INTEIRO — a DSL separa no primeiro `=`, e o resto é valor', () => {
    // Este é o caso que motivou o desenho, e a primeira versão do teste não o cobria. O helper
    // deliberadamente NÃO escapa o `=` do nome, porque `span-query.ts` separa chave/valor no
    // primeiro. Sem este teste, escapá-lo (`.replace(/=/g,'%3D')`) passava por toda a suíte e
    // entregava lista VAZIA ao operador — o defeito silencioso que o M22 pagou, do outro lado.
    const url = linkDe('plano=b');
    expect(url.searchParams.get('span_query')).toBe('attr:prompt.id=plano=b');
  });

  it('um nome hostil produz UM parâmetro, e aponta para o prompt certo', () => {
    // `&` injetaria um segundo parâmetro e `#` truncaria a query — o operador cairia nos traces
    // de OUTRO prompt, sem erro nenhum.
    const nome = 'time/greeting&x#y';
    const url = linkDe(nome);
    expect(url.searchParams.getAll('span_query')).toHaveLength(1);
    expect(url.searchParams.get('span_query')).toBe(`attr:prompt.id=${nome}`);
    expect(url.hash).toBe('');
  });

  it.each([['vazio', ''], ['só espaços', '   ']])(
    'devolve null quando não há prompt (%s) — não lança',
    (_rotulo, nome) => {
      // A primeira versão LANÇAVA. O único chamador invoca isto dentro do JSX: um throw no render
      // faz o ErrorBoundary substituir a tela de detalhe inteira, e o botão Retry re-renderiza o
      // mesmo estado. Nome ausente é estado CONHECIDO do produto (`detail.tsx` tem `= ''` e nove
      // guardas `!== ''`), e `error-handling.md § 2` proíbe exceção para controle de fluxo.
      expect(linkParaTracesDoPrompt(nome)).toBeNull();
    },
  );
});

describe('linkParaTracesDoPrompt — as colunas (T1.2)', () => {
  it('o estado de colunas chega COMPLETO ao destino, densidade inclusive', () => {
    // Um `toEqual` sobre o estado literal, e não dois testes: comparar o token com
    // `encodeColumns(COLUNAS_DE_RESOLUCAO)` era `f(x) === f(x)` — os dois lados calculados da
    // mesma constante importada. Este aqui não usa nada da implementação como oráculo, e ainda
    // fixa `density`, que escapava dos dois testes anteriores.
    //
    // Resolver um prompt não chama modelo nem avalia: tokens, custo e evals vêm vazios. A duração
    // fica — é informação real (medido no app-dev: 1–17 ms).
    const url = linkDe('saudacao');
    expect(decodeColumns(url.searchParams.get('cols'))).toEqual({
      visibility: { latency: true, tokens: false, cost: false, evals: false },
      density: 'comfortable',
    });
  });
});
