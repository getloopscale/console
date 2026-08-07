import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-088 — nenhuma credencial nova entra numa URL de stream.
 *
 * ## O defeito que isto contém
 *
 * `useSSEStream` autentica pondo o JWT de sessão na query string, porque o
 * `EventSource` do navegador não aceita cabeçalhos. A razão técnica é legítima;
 * o custo é que **esse JWT não é efêmero nem escopado** — é o mesmo bearer que
 * autentica toda a API. Numa URL ele chega a access log, log de proxy, histórico
 * do navegador e header `Referer`.
 *
 * ## Por que um guard e não a correção
 *
 * A correção é o ADR-0009: SSE sobre `fetch` + `ReadableStream`, que aceita
 * `Authorization` e elimina a classe. É uma reescrita de risco concentrado numa
 * primitiva de 264 linhas com quatro consumidores — fatia própria, com plano e
 * revisão.
 *
 * Enquanto isso, o que **não** pode acontecer é o padrão se espalhar. Foi assim
 * que ele chegou ao quinto stream: B-015 unificou `use-status-stream` na
 * primitiva por um ganho real de resiliência, e trocou cookie por token-na-URL
 * sem que ninguém percebesse na hora. Aquele foi revertido. O próximo, sem este
 * teste, não seria percebido tampouco.
 *
 * A allowlist tem os quatro que já existem, nomeados. Ela só encolhe.
 */
const ALLOWLIST = new Set([
  // Os quatro consumidores da primitiva, e a primitiva. Saem juntos quando o
  // ADR-0009 for implementado — a correção é numa linha só, em use-sse-stream.
  'hooks/deploy/use-sse-stream.ts',
]);

/** Sinais de que uma credencial está sendo posta numa URL. */
const PADROES: { nome: string; re: RegExp }[] = [
  { nome: 'token= na construção de URL', re: /[?&]token=\$\{/ },
  { nome: 'access_token= na URL', re: /[?&]access_token=/ },
  { nome: 'jwt= na URL', re: /[?&]jwt=/ },
  { nome: 'authorization como query param', re: /[?&]authorization=/i },
];

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('credencial em URL de stream (B-088)', () => {
  it('nenhum arquivo novo põe credencial na query string', () => {
    const ofensores: string[] = [];
    for (const f of arquivos(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(f, 'utf8');
      for (const { nome, re } of PADROES) {
        if (re.test(src)) ofensores.push(`${rel} — ${nome}`);
      }
    }

    expect(
      ofensores,
      'Credencial numa URL. Ela vaza para access log, log de proxy, histórico do\n' +
        'navegador e header Referer — quatro lugares onde um bearer de sessão não\n' +
        'deveria estar.\n\n' +
        'Se for um stream SSE: NÃO copie o padrão de use-sse-stream. Ver ADR-0009,\n' +
        'que decide `fetch` + ReadableStream com header Authorization. Se a fatia\n' +
        'ainda não aconteceu, fale com quem a possui antes de acrescentar o quinto\n' +
        'caso — foi assim que chegamos a quatro.\n',
    ).toEqual([]);
  });

  it('a allowlist não cresceu além dos casos que o ADR-0009 registra', () => {
    expect(
      ALLOWLIST.size,
      'A allowlist de B-088 só encolhe. Se um caso novo precisa entrar, ele precisa\n' +
        'primeiro de uma linha no ADR-0009 explicando por que a correção não serve.\n',
    ).toBeLessThanOrEqual(1);
  });
});
