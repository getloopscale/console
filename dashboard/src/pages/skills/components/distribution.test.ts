// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { adoptionRows, tokenRows, type AdoptionPayload, type TokensPayload } from './distribution';

/**
 * M35 — a lógica de projeção da tela de distribuição, testada FORA do React.
 *
 * O que estes testes protegem não é formatação: é o conjunto de decisões que, erradas, fazem a
 * tela mentir com aparência de funcionar — um token expirado exibido como ativo, uma proporção
 * calculada sobre o denominador errado, um "0%" onde o certo era "não sei".
 */

const AGORA = new Date('2026-08-04T12:00:00.000Z');

describe('tokenRows', () => {
  const base = {
    token_id: 'dtk_1',
    label: 'ci',
    quota_per_window: null,
    create_time: '2026-07-01T00:00:00.000Z',
  };

  it('um token dentro da validade e sem revogação está ativo', () => {
    const [linha] = tokenRows(
      { bundle_id: 'b', tokens: [{ ...base, expires_at: '2026-09-01T00:00:00.000Z', revoked_at: null }] },
      AGORA,
    );
    expect(linha?.status).toBe('active');
  });

  it('a revogação vence a validade — um token revogado NÃO volta a valer', () => {
    // Ordem importa: revogado E ainda dentro do prazo é `revoked`, nunca `active`. Inverter a
    // precedência exibiria como utilizável uma credencial que o operador já cortou.
    const [linha] = tokenRows(
      {
        bundle_id: 'b',
        tokens: [{ ...base, expires_at: '2026-09-01T00:00:00.000Z', revoked_at: '2026-08-02T00:00:00.000Z' }],
      },
      AGORA,
    );
    expect(linha?.status).toBe('revoked');
  });

  it('a revogação também vence a expiração — o motivo do corte é o que o operador precisa ver', () => {
    const [linha] = tokenRows(
      {
        bundle_id: 'b',
        tokens: [{ ...base, expires_at: '2026-07-15T00:00:00.000Z', revoked_at: '2026-07-10T00:00:00.000Z' }],
      },
      AGORA,
    );
    expect(linha?.status).toBe('revoked');
  });

  it('um token com prazo vencido está expirado, mesmo sem revogação', () => {
    const [linha] = tokenRows(
      { bundle_id: 'b', tokens: [{ ...base, expires_at: '2026-07-15T00:00:00.000Z', revoked_at: null }] },
      AGORA,
    );
    expect(linha?.status).toBe('expired');
  });

  it('o instante EXATO da expiração já conta como expirado', () => {
    // Borda: `expires_at === agora`. Tratar como ativo mostraria por um instante uma credencial
    // que o serviço já recusa — e a tela discordaria do backend sobre o mesmo token.
    const [linha] = tokenRows(
      { bundle_id: 'b', tokens: [{ ...base, expires_at: AGORA.toISOString(), revoked_at: null }] },
      AGORA,
    );
    expect(linha?.status).toBe('expired');
  });

  it('rótulo ausente vira "sem rótulo", não string vazia', () => {
    const [linha] = tokenRows(
      {
        bundle_id: 'b',
        tokens: [{ ...base, label: null, expires_at: '2026-09-01T00:00:00.000Z', revoked_at: null }],
      },
      AGORA,
    );
    expect(linha?.labelText).toBe('no label');
  });

  it('uma data ilegível não derruba a linha — o token continua listado e revogável', () => {
    // O pior desfecho aqui seria a tela quebrar: o operador perderia o acesso à revogação por
    // causa de um campo de exibição.
    const [linha] = tokenRows(
      { bundle_id: 'b', tokens: [{ ...base, expires_at: 'não-é-data', revoked_at: null }] },
      AGORA,
    );
    expect(linha?.tokenId).toBe('dtk_1');
    expect(linha?.status).toBe('unknown');
  });

  it('payload ausente devolve lista vazia sem lançar', () => {
    expect(tokenRows(null, AGORA)).toEqual([]);
    expect(tokenRows(undefined, AGORA)).toEqual([]);
    expect(tokenRows({} as TokensPayload, AGORA)).toEqual([]);
  });
});

describe('adoptionRows', () => {
  const payload: AdoptionPayload = {
    total_installs: 10,
    adoption: [
      { skill_id: 'sk_a', version: '1.0.0', installs: 7 },
      { skill_id: 'sk_b', version: '2.1.0', installs: 3 },
    ],
  };

  it('a proporção usa o TOTAL da janela, não a soma das linhas recebidas', () => {
    // Sob paginação a soma é de um recorte. Usá-la como denominador infla toda proporção — e o
    // gráfico erra em silêncio, que é o pior modo de errar.
    const recorte: AdoptionPayload = { total_installs: 100, adoption: [{ skill_id: 'sk_a', version: '1.0.0', installs: 7 }] };
    const [linha] = adoptionRows(recorte);
    expect(linha?.share).toBeCloseTo(0.07);
  });

  it('ordena da maior para a menor adoção — quem lê quer o topo', () => {
    const linhas = adoptionRows({
      total_installs: 10,
      adoption: [
        { skill_id: 'sk_b', version: '2.1.0', installs: 3 },
        { skill_id: 'sk_a', version: '1.0.0', installs: 7 },
      ],
    });
    expect(linhas.map((l) => l.skillId)).toEqual(['sk_a', 'sk_b']);
  });

  it('empate desempata por identificador, para a ordem não dançar entre renders', () => {
    const linhas = adoptionRows({
      total_installs: 4,
      adoption: [
        { skill_id: 'sk_z', version: '1.0.0', installs: 2 },
        { skill_id: 'sk_a', version: '1.0.0', installs: 2 },
      ],
    });
    expect(linhas.map((l) => l.skillId)).toEqual(['sk_a', 'sk_z']);
  });

  it('denominador zero devolve share nulo — não 0%, que afirmaria algo falso', () => {
    // `0%` diz "ninguém instalou esta skill". `null` diz "não dá para calcular proporção". Com
    // zero instalações na janela, a segunda é a verdadeira.
    const [linha] = adoptionRows({ total_installs: 0, adoption: [{ skill_id: 'sk_a', version: '1.0.0', installs: 0 }] });
    expect(linha?.share).toBeNull();
  });

  it('denominador ausente também devolve share nulo', () => {
    // Um backend antigo que não mande `total_installs` não pode virar proporção inventada.
    const [linha] = adoptionRows({ adoption: [{ skill_id: 'sk_a', version: '1.0.0', installs: 5 }] } as AdoptionPayload);
    expect(linha?.share).toBeNull();
  });

  it('a soma das linhas é exposta separada do total — a diferença é informação, não erro', () => {
    // Quando as duas divergem, é porque a janela tem mais do que a lista mostra. Esconder isso
    // faria o operador somar a olho e concluir que o total está errado.
    const linhas = adoptionRows(payload);
    expect(linhas.reduce((s, l) => s + l.installs, 0)).toBe(10);
  });

  it('payload ausente devolve lista vazia sem lançar', () => {
    expect(adoptionRows(null)).toEqual([]);
    expect(adoptionRows(undefined)).toEqual([]);
  });
});
