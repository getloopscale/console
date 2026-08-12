import { FolderKanban } from 'lucide-react';
import type { EstadoVazio } from '@/lib/list-state';

/**
 * O que a lista de projetos diz quando a BUSCA não casou nada.
 *
 * Distinto de "não há projeto algum", que é onboarding e renderiza `EmptyProjectsHero` inline —
 * ver ADR D2. Fora do JSX porque um descritor é dado, e porque a página passou do orçamento de
 * LoC ao ganhar a perna de erro que faltava (B-167); a catraca manda decompor, e esta é a parte
 * do arquivo que menos tem a ver com renderizar.
 */
export function buscaSemResultado(
  carregando: boolean,
  busca: string,
  encontrados: number,
): EstadoVazio | undefined {
  if (carregando || busca === '' || encontrados > 0) return undefined;
  return {
    icon: FolderKanban,
    title: 'No matching projects',
    description: 'Try a different search term.',
  };
}
