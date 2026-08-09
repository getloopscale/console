import type { ReactNode } from 'react';
import { RouteBoundary } from '@/components/error/route-boundary';

/**
 * Envolve o elemento de uma rota numa fronteira de erro por rota.
 *
 * Um crash na página renderiza o fallback DELA — a barra lateral e a superior
 * sobrevivem. E o `routePath` vai para a telemetria, que é o que faz o relatório
 * de erro dizer QUAL tela quebrou em vez de "algo no dashboard".
 *
 * ## Por que saiu do `app.tsx` (B-003)
 *
 * Ela era declarada lá e usada por todas as 119 rotas. No instante em que o
 * primeiro subtree de rotas mudou de arquivo, mantê-la na origem fecharia um
 * ciclo: `app.tsx` importaria as rotas, e as rotas importariam o `app.tsx` de
 * volta. Um ciclo em ESM produz TDZ, e este repositório já documenta essa falha
 * derrubando o SPA inteiro para tela branca (ver `manual-chunks.ts`).
 *
 * A saída é a mesma do `ADR-0001 D4.1`: o que dois módulos compartilham desce
 * para um terceiro, em vez de um deles virar dono do outro.
 */
export function Boundaried({ path, children }: { path: string; children: ReactNode }) {
  return <RouteBoundary routePath={path}>{children}</RouteBoundary>;
}
