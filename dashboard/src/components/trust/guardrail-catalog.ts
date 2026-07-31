/**
 * M24 T4.1 — a projeção do catálogo mesclado plataforma + tenant.
 *
 * Por que isto é lógica e não pintura: **qual linha recebe a ação de remover** é uma regra de
 * segurança, não uma decisão de layout. Uma linha de plataforma jamais pode oferecê-la, e a forma
 * de garantir isso é a ausência da ação — não um botão desabilitado.
 *
 * A diferença importa. Um botão cinza convida o operador a procurar como habilitá-lo, e ele vai
 * procurar: abre suporte, mexe em permissão, tenta pela API. A ausência comunica que aquilo não
 * lhe pertence. O prior art confirma o desenho: o PostHog usa um COMPONENTE separado para as
 * condições em leitura (`FeatureFlagReleaseConditionsReadonly`), não um modo do editor.
 */

export type GuardrailOrigin = 'platform' | 'tenant';

/** Uma linha do catálogo como o serviço a devolve. Campos extras são ignorados de propósito. */
export interface CatalogEntry {
  readonly source?: string;
  readonly id?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly directions?: readonly string[];
}

export interface CatalogPayload {
  readonly catalogVersion?: number;
  readonly validators?: readonly CatalogEntry[];
}

/** Uma linha pronta para a tabela: o que exibir e o que o operador pode fazer com ela. */
export interface CatalogRow {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly origin: GuardrailOrigin;
  /** Legs em que a regra atua. Vazio quando o serviço não informou. */
  readonly directions: readonly string[];
  /** `undefined` em linha de plataforma — a ação NÃO existe, não está desabilitada. */
  readonly removableId?: string;
}

/**
 * Converte a resposta do catálogo em linhas.
 *
 * Só é removível o que o tenant criou E que tem id — sem id não há o que remover, e inventar um
 * seria oferecer uma ação que falha no clique.
 */
export function catalogRows(payload: CatalogPayload | null | undefined): CatalogRow[] {
  const entries = Array.isArray(payload?.validators) ? payload.validators : [];

  return entries.map((entry, index) => {
    const origin: GuardrailOrigin = entry.source === 'tenant' ? 'tenant' : 'platform';
    const name = typeof entry.name === 'string' && entry.name !== '' ? entry.name : '—';
    const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : undefined;

    return {
      key: id ?? `${origin}-${name}-${index}`,
      name,
      kind: typeof entry.kind === 'string' && entry.kind !== '' ? entry.kind : '—',
      origin,
      directions: Array.isArray(entry.directions)
        ? (entry.directions as readonly unknown[]).filter((d): d is string => typeof d === 'string')
        : [],
      ...(origin === 'tenant' && id ? { removableId: id } : {}),
    };
  });
}

/**
 * A frase que explica a origem da linha.
 *
 * Texto, não só cor: `DESIGN.md` exige que a distinção sobreviva a daltonismo e a impressão em
 * preto e branco — e um painel de segurança é lido sob pressão, quando o olho erra.
 */
export function originLabel(origin: GuardrailOrigin): string {
  return origin === 'platform' ? 'Plataforma' : 'Deste workspace';
}

/** Quantas linhas o tenant criou — usado para decidir entre estado vazio e lista. */
export function tenantRowCount(rows: readonly CatalogRow[]): number {
  return rows.filter((r) => r.origin === 'tenant').length;
}
