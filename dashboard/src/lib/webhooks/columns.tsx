import { Badge, Timestamp, type DataTableColumn } from '@usetheo/ui';

/**
 * As colunas que descrevem um webhook, iguais onde quer que ele seja listado (B-183).
 *
 * ## O que fica aqui, e o que NÃO fica
 *
 * Rótulo, URL, eventos e data de criação são o webhook em si — a mesma leitura em qualquer
 * contexto. As colunas de AÇÃO ficam com cada página, e isso é deliberado: `memory/webhooks.tsx`
 * abre o histórico por um selo de entregas recentes, `settings/webhooks.tsx` por um botão de
 * histórico, e forçá-las na mesma forma trocaria duplicação por um parâmetro que nenhuma das duas
 * pediu.
 *
 * ## Por que as duas páginas seguem separadas
 *
 * Elas listam RECURSOS DIFERENTES — `/v1/dashboard/memory/webhooks` e `/v1/settings/webhooks`,
 * persistidos por handlers distintos — e cada uma tem uma capacidade que a outra não tem: memory
 * reenvia entregas, settings mostra o segredo de assinatura uma única vez. Unificá-las produziria
 * um componente com dois ramos opcionais de funcionalidade e um caminho-base por parâmetro, que é
 * o oposto do ganho. O que era mesmo conhecimento compartilhado — a forma da entrega, o tom por
 * status, quando reenviar, o diálogo de cadastro e estas colunas — está compartilhado.
 */
export interface WebhookLinha {
  readonly label: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly created_at?: string;
}

export function colunasDeWebhook<T extends WebhookLinha>(): DataTableColumn<T>[] {
  return [
    { key: 'label', label: 'Label', render: (row) => <span className="font-medium">{row.label}</span> },
    {
      key: 'url',
      label: 'URL',
      render: (row) => <code className="font-mono text-xs text-muted-foreground">{row.url}</code>,
    },
    {
      key: 'events',
      label: 'Events',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.events.map((e) => (
            <Badge key={e} variant="outline">
              {e}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (row.created_at ? <Timestamp value={row.created_at} /> : null),
    },
  ];
}
