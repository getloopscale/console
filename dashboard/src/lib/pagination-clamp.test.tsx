import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { usePaginacao } from './pagination';

/**
 * B-184 — o passo-atrás quando a página fica além do fim.
 *
 * Só `lens/labeling-queue.tsx` tinha esta correção; as outras quatro cópias do paginador não. Nelas,
 * apagar ou filtrar registros encolhia o total e deixava quem estava na última página olhando uma
 * tabela vazia, com o botão Previous como única saída e nada na tela dizendo o que aconteceu.
 */
function usarPaginador(inicial: { total: number; naoAssentado?: boolean }) {
  return renderHook(
    ({ total, naoAssentado }: { total: number; naoAssentado: boolean }) => {
      const [page, setPage] = useState(1);
      return { ...usePaginacao({ total, pageSize: 20, page, setPage, naoAssentado }), setPage };
    },
    { initialProps: { total: inicial.total, naoAssentado: inicial.naoAssentado ?? false } },
  );
}

describe('usePaginacao — a página nunca fica além do fim', () => {
  it('encolher o total traz a página de volta para a última que existe', () => {
    const { result, rerender } = usarPaginador({ total: 137 });
    act(() => { result.current.setPage(7); });
    expect(result.current.page).toBe(7);

    // Alguém resolve 120 itens da fila: sobram 17, uma página só.
    rerender({ total: 17, naoAssentado: false });

    expect(result.current.page).toBe(1);
    expect(result.current.resumo).toBe('Showing 1–17 of 17');
  });

  it('com dados NÃO assentados, a página é preservada', () => {
    // Durante uma busca o total chega zerado por um instante. Corrigir aí devolveria quem está
    // lendo para a página 1 a cada filtro aplicado — o motivo pelo qual o clamp é condicionado.
    const { result, rerender } = usarPaginador({ total: 137 });
    act(() => { result.current.setPage(5); });

    rerender({ total: 0, naoAssentado: true });

    expect(result.current.page).toBe(5);
  });

  it('e é corrigida assim que os dados assentam', () => {
    const { result, rerender } = usarPaginador({ total: 137 });
    act(() => { result.current.setPage(5); });
    rerender({ total: 0, naoAssentado: true });
    expect(result.current.page).toBe(5);

    rerender({ total: 0, naoAssentado: false });

    // Uma lista vazia tem uma página vazia — e é nela que quem estava lendo termina.
    expect(result.current.page).toBe(1);
  });

  it('uma página válida não é mexida', () => {
    // A correção não pode virar "sempre volta para 1": navegar continua funcionando.
    const { result, rerender } = usarPaginador({ total: 137 });
    act(() => { result.current.setPage(3); });
    rerender({ total: 137, naoAssentado: false });
    expect(result.current.page).toBe(3);
  });
});
