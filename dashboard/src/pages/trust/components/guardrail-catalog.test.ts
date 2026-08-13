// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { catalogRows, originLabel, tenantRowCount } from './guardrail-catalog';

/**
 * M24 T4.1 — a regra que decide qual linha pode ser removida.
 *
 * O teste central é uma asserção sobre AUSÊNCIA: linha de plataforma não carrega
 * `removableId`. Testar que um botão está `disabled` passaria com um desenho que o
 * milestone rejeitou de propósito (ADR D2) — um botão cinza convida a procurar como
 * habilitá-lo; a ausência comunica que aquilo não pertence ao operador.
 */

const payload = {
  catalogVersion: 1,
  validators: [
    { source: 'platform', name: 'pii', kind: 'pii', directions: ['input', 'output'] },
    { source: 'platform', name: 'jailbreak', kind: 'jailbreak', directions: ['input'] },
    { source: 'tenant', id: 'val-1', name: 'termos-internos', kind: 'ban-list', directions: ['input'] },
  ],
};

describe('catalogRows', () => {
  it('marca a origem de cada linha', () => {
    const rows = catalogRows(payload);
    expect(rows.map((r) => r.origin)).toEqual(['platform', 'platform', 'tenant']);
  });

  it('NÃO oferece remoção em linha de plataforma', () => {
    const platform = catalogRows(payload).filter((r) => r.origin === 'platform');
    expect(platform).toHaveLength(2);
    for (const row of platform) {
      expect(row.removableId).toBeUndefined();
    }
  });

  it('oferece remoção apenas na linha do tenant, pelo id do serviço', () => {
    const tenant = catalogRows(payload).find((r) => r.origin === 'tenant');
    expect(tenant?.removableId).toBe('val-1');
  });

  it('não oferece remoção a linha de tenant sem id — seria uma ação que falha no clique', () => {
    const rows = catalogRows({ validators: [{ source: 'tenant', name: 'sem-id', kind: 'ban-list' }] });
    expect(rows[0].removableId).toBeUndefined();
  });

  it('expõe as legs em que a regra atua', () => {
    expect(catalogRows(payload)[0].directions).toEqual(['input', 'output']);
  });

  it('trata linha sem directions como lista vazia, não como quebra', () => {
    const rows = catalogRows({ validators: [{ source: 'platform', name: 'x', kind: 'pii' }] });
    expect(rows[0].directions).toEqual([]);
  });

  it('trata origem desconhecida como plataforma — o lado seguro', () => {
    // Se o serviço passar a mandar um `source` novo, o pior erro seria oferecer remoção
    // de algo que o tenant não controla. Na dúvida, a linha não é removível.
    const rows = catalogRows({ validators: [{ source: 'algo-novo', id: 'x', name: 'n', kind: 'k' }] });
    expect(rows[0].origin).toBe('platform');
    expect(rows[0].removableId).toBeUndefined();
  });

  it('devolve lista vazia para payload ausente, nulo ou malformado', () => {
    expect(catalogRows(null)).toEqual([]);
    expect(catalogRows(undefined)).toEqual([]);
    expect(catalogRows({})).toEqual([]);
    expect(catalogRows({ validators: undefined })).toEqual([]);
  });

  it('gera chave estável e única mesmo sem id', () => {
    const rows = catalogRows({
      validators: [
        { source: 'platform', name: 'dup', kind: 'k' },
        { source: 'platform', name: 'dup', kind: 'k' },
      ],
    });
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe('originLabel', () => {
  it('distingue as origens por TEXTO, não só por cor', () => {
    expect(originLabel('platform')).toBe('Plataforma');
    expect(originLabel('tenant')).toBe('Deste workspace');
  });
});

describe('tenantRowCount', () => {
  it('conta apenas o que o tenant criou', () => {
    expect(tenantRowCount(catalogRows(payload))).toBe(1);
  });

  it('é zero quando só há herdadas — o estado vazio da tela fala disso', () => {
    const rows = catalogRows({ validators: [{ source: 'platform', name: 'pii', kind: 'pii' }] });
    expect(tenantRowCount(rows)).toBe(0);
  });
});

describe('o catalogo diz O QUE cada guardrail faz', () => {
  // Payload REAL capturado de app-dev em 2026-08-01. O `kind` do tenant nao vive no topo
  // como o da plataforma — vive dentro de `spec`. Ler so o topo mostrava "—" justamente nas
  // linhas que o operador criou, e descartava `terms`/`action`, que sao a unica informacao
  // que responde "esta regra ainda faz sentido?".
  const REAL = {
    catalogVersion: 1,
    validators: [
      {
        source: 'platform', name: 'credential-mask', category: 'credential_leak',
        kind: 'rule', directions: ['input', 'output'],
      },
      {
        source: 'tenant', id: 'aeb69818', name: 'dddd', category: null,
        spec: { kind: 'ban-list', terms: ['ddd'], action: 'modify', replacement: '[redigido]' },
        directions: ['input'],
      },
      {
        source: 'tenant', id: '38dabc22', name: 'pub-ban', category: null,
        spec: { kind: 'ban-list', terms: ['proibido', 'sigiloso'], action: 'block' },
        directions: ['input'],
      },
    ],
  };

  const rowNamed = (name: string) => catalogRows(REAL).find((r) => r.name === name)!;

  it('le o kind do tenant de dentro de spec', () => {
    expect(rowNamed('dddd').kind).toBe('ban-list');
    expect(rowNamed('pub-ban').kind).toBe('ban-list');
  });

  it('mantem o kind da plataforma, que vive no topo', () => {
    expect(rowNamed('credential-mask').kind).toBe('rule');
  });

  it('resume o efeito da regra do tenant — acao e quantos termos', () => {
    expect(rowNamed('pub-ban').effect).toBe('Bloqueia 2 termos');
    expect(rowNamed('dddd').effect).toBe('Substitui 1 termo');
  });

  it('para a plataforma, o efeito e a categoria que ela detecta', () => {
    // E a MESMA chave que /trust usa para dizer "credential_leak observada 2x, bloqueada" —
    // sem ela o operador ve a violacao e nao descobre qual guardrail responde por ela.
    expect(rowNamed('credential-mask').effect).toBe('credential_leak');
  });

  it('nao inventa efeito quando nao ha dado', () => {
    const [row] = catalogRows({ validators: [{ source: 'tenant', id: 'x', name: 'vazia' }] });
    expect(row.effect).toBe('—');
    expect(row.kind).toBe('—');
  });
});
