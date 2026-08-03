import { describe, expect, it } from 'vitest';

import { promotionConfirmation, promotionPhrase } from './confirm-text';

/**
 * M26 T2.2 — o texto da confirmação de promoção de canal, testado FORA do React.
 *
 * **DECISÃO 1, opção (a) do DoD.** O diálogo nomeia o que é VERIFICÁVEL hoje — a revisão que sai e
 * a que entra — e **não afirma contagem de consumidores**, porque essa contagem não existe na API:
 * a telemetria de adoção do `theo-skills` responde por *bundle*
 * (`GET /v1/bundles/:bundleId/adoption`), não por canal.
 *
 * A **terceira via está proibida pelo próprio DoD**: a tela derivar a contagem por conta própria a
 * partir de dados de bundle seria a interface afirmando um número que o serviço não afirma — o
 * Risco 1 deste milestone, literalmente.
 */

describe('promotionConfirmation', () => {
  it('nomeia a revisão que SAI e a que ENTRA', () => {
    // A asserção é sobre CONTEÚDO. "não vazio" passaria com "Tem certeza?", que é exatamente o
    // texto genérico que este trabalho existe para substituir.
    const t = promotionConfirmation({
      channel: 'stable',
      fromRevision: 'rev_antiga',
      toRevision: 'rev_nova',
      version: '1.10.0',
    });

    expect(t).toContain('rev_antiga');
    expect(t).toContain('rev_nova');
    expect(t).toContain('stable');
    expect(t).toContain('1.10.0');
  });

  it('NUNCA afirma quantos consumidores são afetados — o serviço não sabe esse número', () => {
    const t = promotionConfirmation({
      channel: 'stable',
      fromRevision: 'rev_antiga',
      toRevision: 'rev_nova',
      version: '1.10.0',
    });

    // Qualquer dígito seguido de palavra sobre consumidores seria um número fabricado.
    expect(t).not.toMatch(/\d+\s*(consumidor|consumidores|agentes?|clientes?)/i);
    expect(t.toLowerCase()).not.toContain('consumidores serão');
  });

  it('diz que o consumidor que JÁ LEU não é desfeito — o dano não é reversível pela tela', () => {
    // Promover de volta restaura o ponteiro, não a leitura. Um texto que dissesse apenas
    // "você pode reverter" mentiria sobre a consequência real.
    const t = promotionConfirmation({
      channel: 'stable',
      fromRevision: 'rev_antiga',
      toRevision: 'rev_nova',
      version: '1.10.0',
    });

    expect(t.toLowerCase()).toContain('já');
    expect(t).toMatch(/não desfaz|não reverte|já leu|já resolveu/i);
  });

  it('quando o canal NÃO existe ainda, não inventa uma revisão que sai', () => {
    // Promover para um canal novo não tira nada de serviço. Inventar um `previous` seria
    // afirmar um estado anterior que nunca houve.
    const t = promotionConfirmation({
      channel: 'beta',
      fromRevision: null,
      toRevision: 'rev_nova',
      version: '2.0.0',
    });

    expect(t).toContain('beta');
    expect(t).toContain('rev_nova');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
    expect(t).toMatch(/passa a existir|ainda não serv|nenhuma revisão/i);
  });
});

describe('promotionPhrase', () => {
  it('a frase digitada é o NOME DO CANAL — o que o ato de fato move', () => {
    // Digitar "PROMOVER" seria reflexo muscular: a mesma palavra em qualquer canal. O nome do
    // canal obriga a ler QUAL ponteiro está sendo movido, que é o erro que o gate previne.
    expect(promotionPhrase('stable')).toBe('stable');
    expect(promotionPhrase('beta')).toBe('beta');
  });
});

describe('promotionConfirmation — a revisão que SAI também é identificada por versão', () => {
  it('nomeia a VERSÃO que deixa de servir, não só o id opaco', () => {
    // Achado da validação independente (2026-08-02): o texto dizia a versão da que ENTRA e só o
    // id da que SAI. Um id opaco obriga quem está prestes a confirmar a ir procurar o que aquilo
    // era — no exato momento em que precisa decidir. O diálogo existe para dizer O QUE DEIXA DE
    // VALER, e meia identificação é meia informação.
    const t = promotionConfirmation({
      channel: 'stable',
      fromRevision: 'rev_antiga',
      fromVersion: '1.0.0',
      toRevision: 'rev_nova',
      version: '1.10.0',
    });

    expect(t).toContain('1.0.0');
    expect(t).toContain('rev_antiga');
    expect(t).toMatch(/1\.0\.0/);
  });

  it('quando a revisão que sai NÃO tem versão publicada, diz isso — não inventa uma', () => {
    // Caso real e medido: um canal pode servir uma revisão sem linha em `/versions` (promovida
    // pelo `latest_revision_id`). Inventar "versão desconhecida" seria fabricar; omitir seria
    // mentir por ausência. O texto declara a lacuna.
    const t = promotionConfirmation({
      channel: 'stable',
      fromRevision: 'rev_sem_versao',
      fromVersion: null,
      toRevision: 'rev_nova',
      version: '2.0.0',
    });

    expect(t).toContain('rev_sem_versao');
    expect(t).toMatch(/sem versão publicada|não versionada/i);
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('null');
  });
});
