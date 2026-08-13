/**
 * O aviso de que a lista não está inteira (B-114).
 *
 * ## O defeito que ele fecha
 *
 * Seis rotas deste serviço aplicam um teto defensivo e devolviam a lista sem dizer que havia
 * mais: `lens/dashboards` (100), `lens/alert-rules` (200), `lens/saved-views` (100),
 * `memory/webhooks` (100), `workspace/webhooks` (100) e `api-keys` (100). A 101ª linha sumia, e
 * nada — nem na resposta, nem na tela — dizia que sumiu.
 *
 * O servidor passou a responder `has_more`. Este componente é o outro lado: um campo que nenhuma
 * tela lê fecha metade do defeito, porque o usuário continua vendo uma lista que parece completa.
 *
 * ## Por que um componente
 *
 * Seis listas truncam, e seis frases divergem. Uma frase só, num lugar só, é o que mantém a
 * explicação igual em todas — e é o que permite melhorá-la uma vez.
 */
export interface ListTruncationNoticeProps {
  /** O `has_more` que o servidor devolveu. */
  readonly hasMore: boolean;
  /** Quantos itens a tela está mostrando. */
  readonly total: number;
  /** O que está sendo listado, no plural e em inglês: `views`, `keys`, `webhooks`. */
  readonly substantivo: string;
}

export function ListTruncationNotice({ hasMore, total, substantivo }: ListTruncationNoticeProps) {
  if (!hasMore) return null;

  return (
    // `role="status"` (aria-live polite) e não `alert`: a lista carregou com sucesso, e
    // interromper a leitura para dizer "mostrando os primeiros 100" trataria contexto como
    // urgência.
    <p role="status" className="mt-2 text-xs text-muted-foreground">
      {/* O número, e não só "há mais": ver 100 e saber que são 100 de mais-de-100 é acionável;
          "alguns resultados omitidos" não diz ao usuário onde ele está. */}
      Showing the first {total} {substantivo}. There are more than this — narrow the list to see
      the rest.
    </p>
  );
}
