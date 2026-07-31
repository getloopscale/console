import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * theo-cloud#274 recurrence guard — a read query must FAIL LOUD, never resolve to a lie.
 *
 * `cloudFetch`/`engineFetch` resolve `T | null` and only throw when the call site passes
 * `{ throwOnError: true }` (deliberate, ADR D3 in `lib/api.ts`, so the original `T | null` callers were
 * not broken by the introduction of the flag). The consequence, when a read query does not opt in:
 *
 *     4xx/5xx → null → the query reports SUCCESS → `data ?? []` → the screen renders its empty state
 *
 * The operator reads "you have none" when the truth is "I could not ask". It shipped three times —
 * #250 (Memories), #259 (Status column), #261 (Monitors) — each fixed one screen at a time, while
 * 62 other queries carried the same defect and an `isError` branch that could never run. That
 * unreachable branch is what made every one of them read as correct in review.
 *
 * This test closes the CLASS. It quantifies over the effect, not over the 62 known sites, so the 63rd
 * cannot be added silently.
 *
 * ## The escape hatch, and why it is a comment rather than an allowlist here
 *
 * Some reads legitimately tolerate a resolved `null` — a query whose own consumer already treats
 * `data === null` as failure, or a fetch whose absence is a real answer. Those declare it AT THE CALL
 * SITE with a reason:
 *
 *     // silent-null-ok: <why null is a legitimate answer here>
 *
 * A file-list allowlist would rot: it records that an exception existed, never why, and nothing brings
 * the reader to the line. The marker travels with the code it excuses, and shows up in the diff of
 * anyone who touches it.
 */
const SRC_DIR = join(__dirname, '..');
const MARKER = 'silent-null-ok';

interface Offender {
  file: string;
  line: number;
  url: string;
}

/** Extract the balanced `{...}` object literal passed to `useQuery(` starting at `openBrace`. */
function objectLiteralAt(src: string, openBrace: number): string {
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  return src.slice(openBrace);
}

function scan(): Offender[] {
  const offenders: Offender[] = [];
  const files = globSync('**/*.{ts,tsx}', { cwd: SRC_DIR })
    .filter((f) => !/\.(test|stories)\.(ts|tsx)$/.test(f))
    .map((f) => join(SRC_DIR, f));

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('useQuery({')) continue;

    for (const m of src.matchAll(/useQuery\(\{/g)) {
      const block = objectLiteralAt(src, m.index + 'useQuery('.length);
      // Only READ queries through the cloud clients are in scope. A mutation surfaces failure through
      // its own `isError`/`onError`, which is a different path and already works.
      if (!/\b(?:cloudFetch|engineFetch)\b/.test(block)) continue;
      if (block.includes('throwOnError')) continue;
      if (block.includes(MARKER)) continue; // declared exception — see the file's own reason

      const line = src.slice(0, m.index).split('\n').length;
      const url = /(?:cloud|engine)Fetch<[^>]*>\(\s*[`'"]([^`'"]+)/.exec(block)?.[1] ?? '(dynamic)';
      offenders.push({ file: file.replace(SRC_DIR, 'src'), line, url });
    }
  }
  return offenders;
}

describe('#274 — no read query swallows a failure into an empty state', () => {
  it('every useQuery over cloudFetch/engineFetch either throws on error or declares why not', () => {
    const offenders = scan();
    const detail = offenders.map((o) => `  ${o.file}:${o.line}  ${o.url}`).join('\n');
    expect(
      offenders,
      `${offenders.length} read quer${offenders.length === 1 ? 'y' : 'ies'} resolve null on failure, so a ` +
        `4xx/5xx renders as an empty state (theo-cloud#274).\n\n${detail}\n\n` +
        `Fix: pass { throwOnError: true } as the 3rd arg to cloudFetch/engineFetch — the isError branch ` +
        `is then reachable. If a resolved null is a LEGITIMATE answer here, say so on the queryFn line:\n` +
        `  // ${MARKER}: <reason>\n`,
    ).toEqual([]);
  });

  it('the guard actually detects an unguarded query (self-test)', () => {
    // A guard that cannot fail is decoration. This proves the detector fires, so a green result above
    // means "nothing to find" rather than "the scanner is broken" — the failure mode that made the
    // 62 sites invisible in the first place was exactly a check nobody ran.
    const sample = `
      const q = useQuery({
        queryKey: ['cloud', '/x'] as const,
        queryFn: () => cloudFetch<Thing>('/x'),
      });
    `;
    const block = objectLiteralAt(sample, sample.indexOf('useQuery(') + 'useQuery('.length);
    expect(/\b(?:cloudFetch|engineFetch)\b/.test(block)).toBe(true);
    expect(block.includes('throwOnError')).toBe(false);
    expect(block.includes(MARKER)).toBe(false);
  });
});
