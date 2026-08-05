/**
 * M59 P3 T3.1 — the pure, versioned column-state encoder (ADR D4; Langfuse `table-view-presets`
 * precedent). Column visibility/order + row density are encoded into a SINGLE `cols=` URL param so the
 * existing M52 saved view (which stores the raw `query_string`) captures them with **no schema change**.
 * Versioned + warn-and-migrate: an unknown/older payload decodes to the default state and never throws
 * (R3), so a stored view from a future/legacy build degrades gracefully instead of breaking the table.
 * Pure + total. `btoa`/`atob` are the browser primitives (present in jsdom too — no dependency).
 */

/**
 * The hideable spine columns (the always-on identity columns are never in this set).
 *
 * `model` entrou no M23. Ela é vazia em toda linha `prompt.resolve` — resolver um prompt não chama
 * modelo — e o caminho que a aba do prompt oferece leva exatamente a essa listagem. Uma coluna
 * vazia numa tela para a qual o produto ENVIA o operador é a leitura que faz alguém concluir que
 * algo falhou.
 *
 * Acrescentar é retrocompatível por construção: `decodeColumns` faz merge sobre
 * `DEFAULT_COLUMN_STATE`, então um token `v1` antigo (sem a chave) decodifica com `model: true` e
 * nenhuma visão salva muda de comportamento.
 */
export const TOGGLEABLE_COLUMNS = ['model', 'latency', 'tokens', 'cost', 'evals'] as const;
export type ToggleableColumn = (typeof TOGGLEABLE_COLUMNS)[number];

export interface ColumnState {
  visibility: Record<string, boolean>;
  density: 'comfortable' | 'compact';
}

export const DEFAULT_COLUMN_STATE: ColumnState = {
  visibility: { model: true, latency: true, tokens: true, cost: true, evals: true },
  density: 'comfortable',
};

const VERSION = 'v1';

/** Serialize a column state into a versioned, URL-safe token (`v1:<base64-json>`). Total. */
export function encodeColumns(state: ColumnState): string {
  return `${VERSION}:${btoa(JSON.stringify(state))}`;
}

/**
 * Parse a `cols=` token back to a `ColumnState`. An absent / malformed / unknown-version token yields
 * `DEFAULT_COLUMN_STATE` and logs a migrate warning — never throws (R3 warn-and-migrate).
 */
export function decodeColumns(param: string | null | undefined): ColumnState {
  if (!param) return { ...DEFAULT_COLUMN_STATE };
  const sep = param.indexOf(':');
  const version = sep >= 0 ? param.slice(0, sep) : '';
  if (version !== VERSION) {
    console.warn(`[traces] ignoring unrecognized saved-view column encoding "${version}" — using defaults`);
    return { ...DEFAULT_COLUMN_STATE };
  }
  try {
    const parsed = JSON.parse(atob(param.slice(sep + 1))) as Partial<ColumnState>;
    // Merge over the default so a partial/older-v1 payload still yields a complete, valid state.
    return {
      visibility: { ...DEFAULT_COLUMN_STATE.visibility, ...(parsed.visibility ?? {}) },
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    console.warn('[traces] malformed saved-view column encoding — using defaults');
    return { ...DEFAULT_COLUMN_STATE };
  }
}

/** Whether a spine column is visible under a column state (unknown column → visible by default). */
export function isColumnVisible(state: ColumnState, key: string): boolean {
  return state.visibility[key] ?? true;
}
