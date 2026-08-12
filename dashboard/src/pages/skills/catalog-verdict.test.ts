// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { catalogVerdict } from './catalog-verdict';

/**
 * O veredito do acervo de skills (B-126, decisão D1 do plano).
 *
 * ## O que a tela fazia
 *
 * `/skills` abria num `<Card>` com `<h2>Published skills</h2>` e um `DataTable`. Quem chegava via
 * uma LISTA — e uma lista não responde "como está esta capacidade?". Medido em 2026-08-11: das
 * sete overviews de capacidade, era a única que não respondia nada.
 *
 * ## Por que veredito e não KPI
 *
 * A decisão D1 de `capability-overviews-answer-a-question-plan.md` decide pela existência de uma REGRA. `1.284 memórias` não é bom nem ruim, então memory
 * usa KPI. O acervo de skills TEM um "deveria": uma skill publicada deveria ser carregável. E
 * `latest_revision_id: null` significa exatamente que ela não é — está no acervo e agente nenhum
 * consegue usá-la.
 *
 * `N skills publicadas` não diz isso. O veredito diz.
 *
 * ## O que NÃO é veredito
 *
 * Depreciada com revisão continua carregável. Tratá-la como falha inflaria o número com casos que
 * funcionam, e um alarme que inclui o que está certo é um alarme que ninguém lê.
 */

function skill(over: Partial<Record<string, unknown>> = {}) {
  return {
    skill_id: 's-1',
    name: 'alguma',
    description: '',
    state: 'published',
    latest_revision_id: 'rev-1',
    ...over,
  };
}

describe('o veredito distingue ignorância de saúde', () => {
  it('test_sem_leitura_nao_afirma_nada', () => {
    // A distinção que este repositório defende em toda superfície: "não consegui ler" não é "está
    // tudo bem". Um veredito de saúde sobre uma leitura que não aconteceu é a pior linha possível,
    // porque tranquiliza sobre o que ninguém olhou.
    expect(catalogVerdict({ skills: null, truncated: false })).toMatchObject({ kind: 'unknown' });
  });

  it('test_acervo_vazio_nao_e_acervo_saudavel', () => {
    // Zero skills é um acervo que ninguém montou, não um acervo em ordem. Dizer "tudo carregável"
    // sobre nada seria verdade vacuamente e mentira na prática.
    expect(catalogVerdict({ skills: [], truncated: false })).toMatchObject({ kind: 'empty' });
  });
});

describe('a regra: uma skill publicada deveria ser carregável', () => {
  it('test_skill_sem_revisao_e_o_veredito', () => {
    const v = catalogVerdict({
      skills: [skill(), skill({ skill_id: 's-2', latest_revision_id: null })],
      truncated: false,
    });

    expect(v.kind).toBe('problem');
    expect(v.headline, 'o veredito não nomeia o número nem o problema').toMatch(/1/);
    expect(v.headline.toLowerCase()).toMatch(/load|revision/);
  });

  it('test_concorda_no_plural', () => {
    // Uma frase que diz "2 skill has" é lida como descuido, e descuido na frase faz duvidar do
    // número. O plural é parte do veredito, não polimento.
    const v = catalogVerdict({
      skills: [
        skill({ skill_id: 'a', latest_revision_id: null }),
        skill({ skill_id: 'b', latest_revision_id: null }),
      ],
      truncated: false,
    });
    expect(v.headline).toMatch(/2 skills/);
    expect(v.headline).not.toMatch(/2 skill\b/);
  });

  it('test_deprecada_com_revisao_nao_e_a_mesma_coisa', () => {
    // Ela continua carregável. Contá-la como falha inflaria o alarme com casos que funcionam — e
    // um alarme que inclui o que está certo deixa de ser lido.
    const v = catalogVerdict({
      skills: [skill({ lifecycle: 'deprecated' })],
      truncated: false,
    });
    expect(v.kind).toBe('healthy');
  });

  it('test_acervo_saudavel_diz_isso_em_vez_de_ficar_mudo', () => {
    // A contraparte de `problem`. Sem ela, o conserto poderia ser "só mostra quando há erro", e a
    // tela voltaria a não responder nada no caso comum — que é o defeito original.
    const v = catalogVerdict({ skills: [skill(), skill({ skill_id: 's-2' })], truncated: false });
    expect(v.kind).toBe('healthy');
    expect(v.headline).toMatch(/2 skills/);
  });
});

describe('parcialidade é declarada, não escondida (decisão D2 do plano)', () => {
  it('test_leitura_truncada_marca_o_veredito_como_parcial', () => {
    // A mesma disciplina do `has_more` do B-114, um nível acima: lá era uma lista que truncava em
    // silêncio; aqui é um RESUMO calculado sobre uma lista truncada, o que é pior — um número
    // parcial apresentado como total não tem como ser desconfiado por quem lê.
    const v = catalogVerdict({ skills: [skill()], truncated: true });
    expect(v.partial).toBe(true);
  });

  it('test_leitura_inteira_nao_avisa_de_nada', () => {
    // Um aviso que sempre aparece deixa de ser lido, e aí some quando importa.
    const v = catalogVerdict({ skills: [skill()], truncated: false });
    expect(v.partial).toBe(false);
  });

  it('test_o_veredito_SAUDAVEL_tambem_carrega_a_parcialidade', () => {
    // A combinação mais perigosa das quatro, e a que eu errei na primeira versão: "toda skill
    // publicada tem revisão" sobre uma leitura de 100 num acervo de 300 é uma afirmação sobre a
    // PÁGINA apresentada como afirmação sobre o acervo. Ela tranquiliza com base no que não olhou.
    const v = catalogVerdict({ skills: [skill()], truncated: true });
    expect(v.kind).toBe('healthy');
    expect(v.partial).toBe(true);
    expect(v.detail, 'a frase saudável não ressalva a página').toMatch(/this page/i);
  });

  it('test_o_veredito_de_problema_tambem_carrega_a_parcialidade', () => {
    // O caso que mais importa: `1 skill cannot be loaded` sobre uma leitura truncada significa
    // "pelo menos 1". Perder a ressalva aqui faria o operador acreditar que consertou tudo depois
    // de consertar uma.
    const v = catalogVerdict({
      skills: [skill({ latest_revision_id: null })],
      truncated: true,
    });
    expect(v.kind).toBe('problem');
    expect(v.partial).toBe(true);
  });
});
