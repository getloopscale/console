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
