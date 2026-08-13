// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * B-131 — o `<meta>` do index.html e o header do nginx declaram A MESMA política.
 *
 * Políticas múltiplas de CSP não se substituem: o navegador aplica todas, e vale a INTERSEÇÃO.
 * O header servido em produção era estritamente mais estreito que o `<meta>`, então revogava em
 * silêncio seis permissões que a página declarava precisar — entre elas `style-src`/`font-src`
 * das fontes do Google, que a linha 76 do index.html carrega, e o `blob:` do preview de arquivos
 * do workspace. Nenhum erro de configuração aparece nesse caso: o mais estreito simplesmente
 * ganha, e o que quebra é a página.
 *
 * O guarda anterior verificava UMA diretiva de UM dos dois arquivos (`script-src` sem
 * `'unsafe-inline'` no `<meta>`) — a divergência inteira passava por baixo dele. Este compara os
 * dois arquivos diretiva a diretiva, e falha na próxima.
 */

const RAIZ = resolve(__dirname, '../..');

function lerMeta(caminho: string): string | null {
  let html: string;
  try {
    html = readFileSync(caminho, 'utf-8');
  } catch {
    return null;
  }
  return html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? null;
}

function lerHeader(): string {
  const conf = readFileSync(resolve(RAIZ, 'nginx-security-headers.conf'), 'utf-8');
  const m = conf.match(/add_header Content-Security-Policy "([^"]+)" always;/);
  expect(m, 'nginx-security-headers.conf must ship a Content-Security-Policy').not.toBeNull();
  return m![1];
}

/** `{ 'script-src': ['self'], … }` — a ordem das fontes dentro de uma diretiva não importa. */
function emDiretivas(csp: string): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  for (const parte of csp.split(';')) {
    const campos = parte.trim().split(/\s+/).filter(Boolean);
    if (campos.length === 0) continue;
    saida[campos[0]] = campos.slice(1).sort();
  }
  return saida;
}

/**
 * As duas diferenças declaradas — e a única razão pela qual este teste não é uma igualdade seca.
 *
 * `ws:`/`wss:` existem só no `<meta>` porque o Vite serve o index.html tal e qual em dev e o HMR
 * abre um WebSocket; em produção o header não os traz e a interseção os corta. `frame-ancestors`
 * existe só no header porque a diretiva é ignorada em `<meta>` por especificação.
 */
const SO_NO_META: Readonly<Record<string, readonly string[]>> = { 'connect-src': ['ws:', 'wss:'] };
const SO_NO_HEADER = ['frame-ancestors'];

describe('B-131 — as duas políticas de CSP dizem a mesma coisa', () => {
  const meta = lerMeta(resolve(RAIZ, 'index.html'));
  const header = lerHeader();

  it('o index.html declara um CSP', () => {
    expect(meta).not.toBeNull();
  });

  it('as duas trazem exatamente as mesmas diretivas, salvo frame-ancestors', () => {
    const noMeta = Object.keys(emDiretivas(meta!)).sort();
    const noHeader = Object.keys(emDiretivas(header))
      .filter((d) => !SO_NO_HEADER.includes(d))
      .sort();
    expect(noHeader).toEqual(noMeta);
  });

  it.each([
    'default-src',
    'script-src',
    'style-src',
    'font-src',
    'img-src',
    'connect-src',
    'form-action',
    'base-uri',
    'object-src',
  ])('%s tem as mesmas fontes nas duas', (diretiva) => {
    const doMeta = emDiretivas(meta!)[diretiva] ?? [];
    const doHeader = emDiretivas(header)[diretiva] ?? [];
    const permitidoSoNoMeta = SO_NO_META[diretiva] ?? [];

    // O header nunca pode ser mais ESTREITO: é a interseção que vale, então uma fonte que só o
    // `<meta>` traz está revogada em produção — o defeito exato do B-131.
    expect(
      doMeta.filter((f) => !doHeader.includes(f) && !permitidoSoNoMeta.includes(f)),
      `${diretiva}: o <meta> permite fontes que o header do nginx revoga. A interseção vale em ` +
        `produção, então a página pede algo que o navegador vai bloquear — sem erro nenhum.`,
    ).toEqual([]);

    // Nem mais LARGO: uma fonte só no header é permissão que ninguém declarou precisar.
    expect(
      doHeader.filter((f) => !doMeta.includes(f)),
      `${diretiva}: o header do nginx permite fontes que o <meta> não declara.`,
    ).toEqual([]);
  });

  it('frame-ancestors continua fechado no header', () => {
    // A defesa contra clickjacking, que só pode viver deste lado.
    expect(emDiretivas(header)['frame-ancestors']).toEqual(["'none'"]);
  });
});

describe('Red Team theo-cloud#67 — script-src sem unsafe-inline', () => {
  // `'unsafe-inline'` em `script-src` derruba a defesa principal contra XSS. O bundle não tem
  // handler inline (React usa eventos sintéticos), então a diretiva era espaço morto que só
  // enfraquecia. Vale para os três artefatos: o fonte, o header e o bundle publicado.
  it.each([
    ['index.html', () => lerMeta(resolve(RAIZ, 'index.html'))],
    ['nginx-security-headers.conf', () => lerHeader()],
    ['dist/index.html', () => lerMeta(resolve(RAIZ, 'dist/index.html'))],
  ])('%s', (nome, obter) => {
    const csp = obter();
    if (csp === null) {
      // O bundle só existe depois do build; em CI sem build, não há o que verificar. Os outros
      // dois são arquivos versionados e nunca caem aqui.
      expect(nome).toBe('dist/index.html');
      return;
    }
    const scriptSrc = emDiretivas(csp)['script-src'];
    expect(scriptSrc, `${nome}: script-src deve existir`).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");
  });
});
