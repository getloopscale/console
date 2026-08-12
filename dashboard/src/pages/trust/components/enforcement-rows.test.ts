import { describe, expect, it } from 'vitest';

import { blockedCount, enforcementRows } from './enforcement-rows';

/**
 * M24 T7.1 — a projeção da auditoria.
 *
 * O teste que mais importa é sobre AUSÊNCIA: um campo com conteúdo bruto que o serviço
 * porventura devolva não pode atravessar. A projeção nomeia os campos que expõe, então
 * qualquer campo novo fica de fora por omissão — só entra se alguém o adicionar de propósito.
 */

const payload = {
  events: [
    {
      id: 'e1',
      decision: 'block',
      direction: 'input',
      category: 'credential_leak',
      validatorName: 'credential-mask',
      redacted: 'sk_live_***',
      createdAt: '2026-07-31T10:00:00Z',
    },
    {
      id: 'e2',
      decision: 'allow',
      direction: 'output',
      category: 'none',
      validatorName: 'pii',
      redacted: '—',
      createdAt: '2026-07-31T10:01:00Z',
    },
  ],
};

describe('enforcementRows', () => {
  it('traduz a decisão para TEXTO, não só cor', () => {
    const rows = enforcementRows(payload);
    expect(rows[0].decisionLabel).toBe('Blocked');
    expect(rows[1].decisionLabel).toBe('Allowed');
  });

  it('preserva o marcador redigido', () => {
    expect(enforcementRows(payload)[0].redacted).toBe('sk_live_***');
  });

  it('NÃO deixa passar campo de conteúdo bruto que o serviço porventura devolva', () => {
    const rows = enforcementRows({
      events: [
        {
          id: 'e1',
          decision: 'block',
          redacted: 'ok',
          // Campos que não existem hoje no contrato; se um dia existirem, não podem vazar.
          content: 'minha senha é hunter2',
          rawContent: 'segredo',
          message: 'texto bruto da conversa',
        } as never,
      ],
    });

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('segredo');
    expect(serialized).not.toContain('texto bruto da conversa');
  });

  it('trata decisão desconhecida sem quebrar e sem mentir', () => {
    const rows = enforcementRows({ events: [{ id: 'x', decision: 'algo-novo' }] });
    expect(rows[0].decision).toBe('unknown');
    expect(rows[0].decisionLabel).toBe('Unknown');
  });

  it('substitui campo ausente por travessão em vez de "undefined"', () => {
    const rows = enforcementRows({ events: [{ id: 'x', decision: 'block' }] });
    expect(rows[0].category).toBe('—');
    expect(rows[0].validatorName).toBe('—');
    expect(rows[0].createdAt).toBe('—');
  });

  it('devolve lista vazia para payload ausente ou malformado', () => {
    expect(enforcementRows(null)).toEqual([]);
    expect(enforcementRows(undefined)).toEqual([]);
    expect(enforcementRows({})).toEqual([]);
  });

  it('gera chave única mesmo sem id', () => {
    const rows = enforcementRows({ events: [{ decision: 'block' }, { decision: 'block' }] });
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe('blockedCount', () => {
  it('conta só os bloqueios', () => {
    expect(blockedCount(enforcementRows(payload))).toBe(1);
  });

  it('é zero quando nada foi bloqueado', () => {
    expect(blockedCount(enforcementRows({ events: [{ decision: 'allow' }] }))).toBe(0);
  });
});
