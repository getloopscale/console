import { useEffect, useState } from 'react';

/**
 * Atraso padrao para busca-enquanto-digita.
 *
 * B-050 — as telas que ja debounciam usavam constantes divergentes escritas a
 * mao (traces.tsx 300ms, episodes.tsx 350ms) e /memory/skills nao debounciava
 * nada, disparando um GET por tecla. A divergencia nao vinha de uma decisao:
 * vinha de cada tela ter reimplementado o mesmo `useEffect` + `setTimeout`.
 */
export const DEBOUNCE_MS = 300;

/**
 * Devolve `value` atrasado em `delayMs`, cancelando o timer a cada mudanca.
 *
 * Uso tipico — manter o input responsivo e a QUERY debouncida:
 *
 *     const [texto, setTexto] = useState('');
 *     const buscado = useDebouncedValue(texto);
 *     useQuery({ queryKey: [..., buscado], ... });
 *
 * O valor debouncido e o que entra na queryKey; o input segue lendo o estado
 * imediato, entao a digitacao nunca fica travada.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
