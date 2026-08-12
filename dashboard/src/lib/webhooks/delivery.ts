/**
 * A forma de uma ENTREGA de webhook, declarada uma vez (B-183).
 *
 * Esta interface existia byte a byte igual em `pages/settings/webhooks.tsx` e
 * `pages/memory/webhooks.tsx`. Duas declarações do mesmo payload são duas chances de divergirem —
 * e o CRUD de webhooks já é parametrizado por contexto em dois dos seus três pontos de montagem,
 * então a duplicação não era nem sequer a regra da casa.
 *
 * Mora em `lib/` e não numa das duas páginas porque nenhuma delas é dona da outra: é o contrato
 * do serviço, e as páginas são consumidoras iguais dele.
 */
export interface Delivery {
  readonly id: string;
  readonly event_type: string;
  readonly status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead_letter';
  readonly attempt_count: number;
  readonly last_response_status?: number;
  readonly last_error_message?: string;
  readonly created_at: string;
  readonly completed_at?: string;
}

/**
 * O tom visual de cada status de entrega.
 *
 * As duas páginas traziam esta função, com a MESMA semântica e formas diferentes: a de `memory`
 * enumerava os cinco casos sem `default`, a de `settings` fechava com `default: 'default'`. A
 * diferença não é de estilo — sem `default`, acrescentar um status à união faz o TypeScript
 * reprovar aqui e obrigar alguém a decidir o tom; com `default`, o status novo escorrega para
 * `'default'` em silêncio e aparece na tela como se fosse um caso comum.
 *
 * Sobrevive a forma exaustiva.
 */
export function deliveryStatusVariant(
  s: Delivery['status'],
): 'default' | 'success' | 'warning' | 'destructive' {
  switch (s) {
    case 'pending':
    case 'delivering':
      return 'warning';
    case 'delivered':
      return 'success';
    case 'failed':
      return 'default';
    case 'dead_letter':
      return 'destructive';
  }
}

/**
 * Quando oferecer o reenvio.
 *
 * `delivered` criaria uma duplicata no destino; `pending`/`delivering` seriam um clique sem efeito
 * sobre algo que já está a caminho. Sobram os dois desfechos em que reenviar é a ação certa.
 */
export function canReplay(s: Delivery['status']): boolean {
  return s === 'failed' || s === 'dead_letter';
}
