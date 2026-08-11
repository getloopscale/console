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
 * `PageShell` vem do design system e não aceita `error`. Um wrapper em volta dele seria uma
 * segunda fachada para a mesma coisa. O que falta é só a DECISÃO — e ela cabe numa função
 * pura, que é testável sem render e impossível de esquecer quando é o único jeito de
 * construir o descritor.
 */
export function estadoDaLista(
  { erro, vazio }: { erro: boolean; vazio: EstadoVazio },
  recurso: string,
): EstadoVazio {
  if (!erro) return vazio;
  return {
    icon: AlertTriangle,
    title: `Could not read ${recurso}`,
    description:
      'The request failed, so this list is not showing what exists — it is showing nothing. ' +
      'Retry, and if it keeps failing the service is likely unavailable.',
  };
}
