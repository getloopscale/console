import { type ColumnState, encodeColumns } from './view-encoding';

/**
 * Construtor de endereco do explorador de traces — a API publica que o lens
 * oferece a outras features.
 *
 * B-043 — antes, quem quisesse linkar para o explorador importava os TIJOLOS:
 * `promptly/traces-link.ts` alcancava `../lens/traces/view-encoding` (tres niveis
 * dentro do lens) e reimplementava, do seu lado, tanto a rota (`/observability/traces`)
 * quanto o formato da DSL de span-query (`attr:chave=valor`).
 *
 * O problema nao e o import ser longo — e o CONTRATO estar duplicado. Se o lens
 * mudar a rota ou o separador da DSL, o link do promptly quebra em silencio: nao
 * ha erro de compilacao, so uma URL que chega ao explorador sem filtrar nada. Um
 * consumidor deve conhecer o destino, nao a gramatica interna dele.
 *
 * Este modulo passa a ser o unico dono das duas coisas.
 */

/** Rota do explorador. Mora aqui, e nao no consumidor. */
export const TRACES_ROUTE = '/observability/traces';

/**
 * Monta um predicado de atributo na DSL de span-query do lens.
 *
 * A DSL separa chave e valor no PRIMEIRO `=`, entao o valor pode conter `=` sem
 * ambiguidade. Quem chama passa chave e valor crus e nao precisa saber disso.
 */
export function spanAttrQuery(attribute: string, value: string): string {
  return `attr:${attribute}=${value}`;
}

export interface TracesUrlOptions {
  /** Predicado de span-query. Use {@link spanAttrQuery} para filtros por atributo. */
  spanQuery?: string;
  /** Estado de colunas com que o explorador deve abrir. */
  columns?: ColumnState;
}

/**
 * Endereco do explorador de traces, opcionalmente filtrado e com colunas.
 *
 * `URLSearchParams` cuida do escape de `&` e `#`, entao um valor hostil nao vira
 * um segundo parametro nem trunca a query.
 */
export function buildTracesUrl({ spanQuery, columns }: TracesUrlOptions = {}): string {
  const params = new URLSearchParams();
  if (spanQuery) params.set('span_query', spanQuery);
  if (columns) params.set('cols', encodeColumns(columns));

  const qs = params.toString();
  return qs === '' ? TRACES_ROUTE : `${TRACES_ROUTE}?${qs}`;
}
