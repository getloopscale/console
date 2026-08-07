/**
 * Helpers puros da lista de traces.
 *
 * Moram aqui, e nao em `../traces.tsx`, porque `columns.tsx` precisa deles: um
 * filho importando do proprio pai fechava o ciclo `traces/columns.tsx ->
 * traces.tsx` que o `madge --circular` reportava (B-037). O padrao segue o que
 * `trace-detail/helpers.ts` ja estabeleceu na mesma feature.
 *
 * `../traces.tsx` re-exporta o que esta aqui, entao a superficie publica da
 * pagina nao mudou e nenhum consumidor externo precisou ser tocado.
 */

/**
 * M57 T1.1 — convert an OTLP `startTimeUnixNano` (nanoseconds since epoch, as a
 * string) to an ISO string for the timestamp column. Pure + total: nullish,
 * non-numeric, or non-positive (Go zero-time) input returns null so the cell
 * renders the em-dash. BigInt avoids float precision loss on 19-digit ns.
 */
export function nsToIso(ns: string | undefined | null): string | null {
  if (!ns) return null;
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}
