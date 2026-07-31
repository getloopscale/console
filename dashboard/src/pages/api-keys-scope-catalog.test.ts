// O catálogo de escopos da tela x o enum que o backend aceita — lidos JUNTOS.
//
// O DEFEITO QUE ISTO PREVINE, medido em 2026-07-31: as duas listas divergiram em
// silêncio, nos dois sentidos.
//
//   `trust:*`   — a cadeia Model B do theo-trust estava inteira de pé (borda roteando,
//                 forward-auth ligado, broker cunhando chave por tenant) e NENHUM cliente
//                 podia alcançá-la: o escopo não existia nem na tela nem no backend.
//   `storage:*` — o oposto: o backend aceitava `storage:read`/`storage:write` (e havia
//                 teste Go fixando isso) e a TELA não os oferecia. Uma capacidade
//                 emitível por API e invisível para quem usa o produto.
//
// Por que aconteceu: cada lado tinha o SEU teste. `storage_test.go` provava o backend;
// `api-keys.test.tsx` provava a tela. Nenhum confrontava os dois, então concordar era
// disciplina, não garantia — e disciplina não sobrevive a seis verticais.
//
// Este teste lê o FONTE GO em vez de manter um terceiro literal espelhado, que seria só
// mais uma cópia para divergir. Precedente no repo: `use-service-versions.test.ts` lê
// `internal/routes/service_versions.go` para fixar o path do endpoint.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACTIVE_SCOPES } from './api-keys';

/**
 * Extrai as chaves do mapa `validScopes` do fonte Go.
 *
 * O mapa é a fronteira real: um escopo fora dele é rejeitado na criação da chave,
 * independentemente do que a tela mostre.
 */
function backendActiveScopes(): string[] {
  const go = readFileSync(resolve(process.cwd(), '../internal/routes/api_keys.go'), 'utf8');
  const block = go.match(/var validScopes = map\[string\]bool\{([\s\S]*?)\n\}/);
  expect(block, 'validScopes não foi encontrado em internal/routes/api_keys.go').not.toBeNull();
  return [...block![1].matchAll(/"([a-z-]+:[a-z-]+)"\s*:\s*true/g)].map((m) => m[1]).sort();
}

describe('catálogo de escopos: tela x backend', () => {
  it('a tela oferece EXATAMENTE os escopos que o backend aceita', () => {
    const ui = ACTIVE_SCOPES.map((s) => s.id).sort();

    // Igualdade nos dois sentidos, de propósito:
    //   um escopo só no backend  → capacidade emitível que ninguém descobre pela UI
    //   um escopo só na UI       → o cliente seleciona e a criação falha com 422
    expect(ui).toEqual(backendActiveScopes());
  });

  it('não oferece escopos de ciclo de vida do broker', () => {
    const ui = ACTIVE_SCOPES.map((s) => s.id);

    // `*:admin` de vertical com broker é a credencial que CUNHA chaves por tenant —
    // oferecê-la ao consumidor entrega a chave-mestra junto com a porta.
    for (const forbidden of ['rag:admin', 'storage:admin', 'trust:admin', 'trust:platform-admin']) {
      expect(ui, `${forbidden} nunca é emitível pelo cliente`).not.toContain(forbidden);
    }
  });
});
