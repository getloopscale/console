/**
 * A aritmética de um paginador por offset, num lugar só (B-184).
 *
 * ## O que estava copiado
 *
 * Cinco telas, dois domínios, as mesmas três linhas — `pageCount`, `firstShown`, `lastShown` —
 * variando apenas o identificador do tamanho de página. Junto delas ia a mesma JSX de Prev/Next
 * com os mesmos predicados de `disabled`.
 *
 * ## E o que já tinha divergido
 *
 * Duplicação não é perigosa por ser feia; é perigosa porque as cópias andam sozinhas. Quando este
 * item foi medido, duas já tinham:
 *
 * 1. `lens/usage-by-user.tsx` dizia "Mostrando … de …" enquanto as outras quatro diziam
 *    "Showing … of …". Um produto em inglês com uma tela em português não lê como tradução
 *    pendente — lê como uma parte que veio de outro lugar.
 * 2. Só `lens/labeling-queue.tsx` corrigia a página quando ela passava do fim. Nas outras quatro,
 *    apagar registros deixava quem estava na última página olhando uma tabela vazia, sem nada na
 *    tela explicando por quê.
 *
 * O segundo ponto é a razão de isto ser um HOOK e não só uma função: o conserto mora no par
 * (estado, aritmética), e deixá-lo do lado de fora seria reabrir a mesma divergência na próxima
 * tela que copiasse a chamada e esquecesse o efeito.
 */
import { useEffect } from 'react';

export interface Paginacao {
  /** Quantas páginas existem. Nunca zero — uma lista vazia tem uma página vazia. */
  readonly pageCount: number;
  /** O índice 1-based do primeiro item mostrado; 0 quando não há nenhum. */
  readonly firstShown: number;
  /** O índice 1-based do último item mostrado. */
  readonly lastShown: number;
  /** `Showing 21–40 of 137`, ou `Showing 0–0 of 0` quando a lista está vazia. */
  readonly resumo: string;
}

export function calcularPaginacao(total: number, page: number, pageSize: number): Paginacao {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);
  return {
    pageCount,
    firstShown,
    lastShown,
    resumo: `Showing ${String(firstShown)}–${String(lastShown)} of ${String(total)}`,
  };
}

export interface EstadoDePaginacao extends Paginacao {
  readonly page: number;
  readonly goToPrevious: () => void;
  readonly goToNext: () => void;
}

/**
 * A aritmética, mais a correção de uma página que ficou além do fim.
 *
 * O estado de `page` fica com a tela, e não com este hook, por uma razão de ORDEM: a query precisa
 * de `page` para montar o offset, e `total` só existe depois que ela responde. Um hook que
 * possuísse `page` teria de ser chamado antes da query e receber um total que ainda não existe.
 *
 * `naoAssentado` é o que torna o clamp seguro: durante uma busca, `total` chega momentaneamente
 * zerado, e corrigir a página nesse instante devolveria quem está lendo para a página 1 a cada
 * filtro aplicado. A correção só acontece com dados assentados — o cuidado que
 * `lens/labeling-queue.tsx` já tinha e que as outras quatro telas não tinham nem por acidente,
 * porque não tinham a correção.
 */
export function usePaginacao(args: {
  total: number;
  pageSize: number;
  page: number;
  setPage: (next: number) => void;
  /** Dados ainda não assentados: buscando, ou sem resposta nenhuma. */
  notSettled: boolean;
}): EstadoDePaginacao {
  const { total, pageSize, page, setPage, notSettled } = args;
  const calculada = calcularPaginacao(total, page, pageSize);
  const { pageCount } = calculada;

  useEffect(() => {
    if (!notSettled && page > pageCount) setPage(pageCount);
    // `setPage` é estável (setter de useState / nuqs); incluí-lo só faria o efeito depender de uma
    // identidade que não muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notSettled, page, pageCount]);

  return {
    ...calculada,
    page,
    goToPrevious: () => { setPage(Math.max(1, page - 1)); },
    goToNext: () => { setPage(page + 1); },
  };
}
