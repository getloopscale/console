import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDebouncedValue, DEBOUNCE_MS } from './use-debounced-value';

/**
 * B-050 — o debounce compartilhado de busca-enquanto-digita.
 *
 * Antes existiam tres comportamentos distintos para o mesmo problema:
 * traces.tsx debounciava em 300ms, episodes.tsx em 350ms (cada um com o seu
 * `useEffect` + `setTimeout` escrito a mao) e /memory/skills nao debounciava —
 * o texto ia direto para a queryKey, entao CADA TECLA disparava um GET.
 *
 * A divergencia de 300 vs 350 nao veio de uma decisao sobre latencia: veio de
 * cada tela ter reimplementado a mesma coisa.
 */
describe('useDebouncedValue (B-050)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('devolve o valor inicial imediatamente — o input nunca fica em branco', () => {
    const { result } = renderHook(() => useDebouncedValue('inicial'));
    expect(result.current).toBe('inicial');
  });

  it('NAO propaga antes do atraso — e isto que evita um GET por tecla', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    rerender({ v: 'abc' });

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    });

    // Tres teclas, nenhuma propagacao ainda.
    expect(result.current).toBe('a');
  });

  it('propaga apenas o ULTIMO valor depois do atraso', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    rerender({ v: 'abc' });

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    // Os intermediarios ('ab') nunca chegam a ser observados.
    expect(result.current).toBe('abc');
  });

  it('cada mudanca reinicia a janela — digitacao continua nao propaga', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 'a' },
    });

    for (const v of ['ab', 'abc', 'abcd']) {
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS - 50);
      });
      rerender({ v });
    }

    // Somadas, as esperas ja passariam de DEBOUNCE_MS — mas nenhuma janela fechou.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(result.current).toBe('abcd');
  });

  it('honra um atraso customizado', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 1000), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1000 - DEBOUNCE_MS);
    });
    expect(result.current).toBe('b');
  });

  it('desmontar cancela o timer pendente (sem setState apos unmount)', () => {
    const { rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS * 2);
      });
    }).not.toThrow();
  });
});
