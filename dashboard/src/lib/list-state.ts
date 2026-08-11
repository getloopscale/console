// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { AlertTriangle, type LucideIcon } from 'lucide-react';

/** O descritor que `PageShell` aceita em `empty`. */
export interface EstadoVazio {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Escolhe entre "não há nada" e "não consegui ler" (B-167).
 *
 * ## O defeito
 *
 * `PageShell` tem `loading` e `empty`, e não tem `error`. Como as páginas escrevem o
 * descritor à mão, seis delas caíram no mesmo lugar: uma leitura que FALHOU produz zero
 * linhas, zero linhas cai no ramo `empty`, e a tela afirma ausência.
 * `pages/infra/domains.tsx:252` dizia "No custom domains yet" durante um 5xx;
 * `settings/audit.tsx:153` dizia "No audit entries"; `settings/webhooks.tsx:349` dizia
 * "No deliveries yet."
 *
 * Duas delas carregam a mesma premissa falsa, copiada uma da outra
 * (`settings/team.tsx:54`, `infra/domains.tsx:188`): "Com throwOnError a falha sobe para o
 * RouteBoundary". O `throwOnError` ali é o terceiro argumento do `cloudFetch`, não a opção
 * homônima do TanStack — que tem default `!!suspense`, ou seja `false`. A query resolve com
 * `isError: true`, o componente renderiza, e o RouteBoundary nunca é alcançado.
 *
 * ## Por que uma função e não um componente
 *
 * CORREÇÃO (2026-08-11, B-167). Este bloco afirmava que `PageShell` "não aceita `error`", e essa
 * era a justificativa inteira para escrever uma função em vez de usar o componente. **É falso.**
 * O `@usetheo/ui@0.35.1` instalado declara `error?: { message; onRetry?; docsHref? }`, documenta
 * a precedência `loading > error > empty`, o ramo de fato renderiza, e
 * `pages/lens/labeling-queue.tsx` já o usa.
 *
 * A função continua defensável pelos méritos dela, que são outros: ela SUBSTITUI a mensagem no
 * lugar em vez de trocar para a superfície de erro, e devolve `undefined` quando a lista TEM
 * linhas — um erro de refetch por cima de dados velhos merece uma tarja, não um estado vazio.
 * Mas a razão escrita aqui não se sustentava, e uma justificativa errada num módulo consultado
 * por oito páginas se propaga como decisão tomada.
 *
 * As duas formas são aceitas pelo guarda em `list-state.test.ts`; escolha por página.
 */
export function estadoDaLista(
  { erro, vazio }: { erro: boolean; vazio: EstadoVazio | undefined },
  recurso: string,
): EstadoVazio | undefined {
  // `vazio === undefined` significa que a lista TEM linhas — `PageShell` nao mostra nada.
  // Um erro de refetch por cima de dados velhos e outra decisao (uma tarja, nao um estado
  // vazio), e nao e esta funcao que a toma. So substituimos a mensagem quando o usuario
  // veria a afirmacao de ausencia.
  if (vazio === undefined) return undefined;
  if (!erro) return vazio;
  return {
    icon: AlertTriangle,
    title: `Could not read ${recurso}`,
    description:
      'The request failed, so this list is not showing what exists — it is showing nothing. ' +
      'Retry, and if it keeps failing the service is likely unavailable.',
  };
}
