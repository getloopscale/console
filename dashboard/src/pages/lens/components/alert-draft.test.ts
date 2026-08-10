import { describe, expect, it } from 'vitest';
import {
  EMPTY_ALERT_DRAFT,
  METRICA_DE_PROMPT,
  alertProblems,
  exigeNomeDePrompt,
  toCreateBody,
  visibleAlertProblems,
} from './alert-draft';

// M22 — o pareamento métrica↔prompt, validado FORA do React.
//
// O banco torna o par inválido irrepresentável (`lens_alert_rules_prompt_pairing_check`) e a rota
// o recusa com `INVALID_PROMPT`. Um formulário que **permite montá-lo** não fica mais permissivo —
// só empurra a recusa para depois do clique, onde ela chega como erro de servidor em vez de
// orientação.

describe('exigeNomeDePrompt', () => {
  it('é verdadeiro só para a métrica de prompt', () => {
    expect(exigeNomeDePrompt(METRICA_DE_PROMPT)).toBe(true);
    for (const m of ['error_rate', 'cost', 'p95_latency', '']) {
      expect(exigeNomeDePrompt(m)).toBe(false);
    }
  });

  it('reconhece por igualdade, não por prefixo', () => {
    // `startsWith('prompt_')` passaria em tudo acima e ainda assim estaria errado: uma métrica
    // futura de nome parecido — mas de outra fonte — pediria um campo que não lhe serve.
    for (const m of ['prompt_', 'prompt_p50_latency', 'prompt_resolutions_v2']) {
      expect(exigeNomeDePrompt(m)).toBe(false);
    }
  });
});

describe('alertProblems', () => {
  it('acusa métrica de prompt SEM nome de prompt', () => {
    const problemas = alertProblems({
      ...EMPTY_ALERT_DRAFT,
      name: 'uso da saudação',
      metric: METRICA_DE_PROMPT,
      threshold: '3',
      webhookId: 'wh-1',
    });
    // A mensagem ESPECÍFICA, não "alguma que cite prompt": as duas do ramo contêm a palavra, e um
    // `toMatch(/prompt/i)` sobrevive a trocar uma pela outra — mutante medido pelo `/review`.
    expect(problemas.join(' ')).toMatch(/Say which prompt/i);
  });

  it('acusa nome de prompt numa métrica de workspace', () => {
    // O estado silencioso: o backend simplesmente ignora o campo, e o próximo leitor da regra não
    // sabe dizer se o escopo valia ou não.
    const problemas = alertProblems({
      ...EMPTY_ALERT_DRAFT,
      name: 'erro geral',
      metric: 'error_rate',
      promptName: 'saudacao',
      threshold: '5',
      webhookId: 'wh-1',
    });
    expect(problemas.join(' ')).toMatch(/workspace-wide/i);
  });

  it('não acusa o par válido', () => {
    expect(
      alertProblems({
        ...EMPTY_ALERT_DRAFT,
        name: 'uso da saudação',
        metric: METRICA_DE_PROMPT,
        promptName: 'saudacao',
        threshold: '3',
        webhookId: 'wh-1',
      }),
    ).toEqual([]);
  });

  it('não acusa uma métrica de workspace sem nome de prompt', () => {
    // A regressão que o milestone exige: alargar a tela não pode estreitar o que já servia.
    expect(
      alertProblems({
        ...EMPTY_ALERT_DRAFT,
        name: 'erro geral',
        metric: 'error_rate',
        threshold: '5',
        webhookId: 'wh-1',
      }),
    ).toEqual([]);
  });

  it('trata nome só com espaços como ausente', () => {
    const problemas = alertProblems({
      ...EMPTY_ALERT_DRAFT,
      name: 'x',
      metric: METRICA_DE_PROMPT,
      promptName: '   ',
      threshold: '3',
      webhookId: 'wh-1',
    });
    expect(problemas.join(' ')).toMatch(/Say which prompt/i);
  });

  // F2 do `/review` — a regra do limiar não tinha fronteira nem caso negativo. Dois mutantes
  // sobreviviam por construção, e o segundo cria uma regra que dispara no primeiro tick.
  it('aceita limiar ZERO — é a fronteira legítima de `gt 0`', () => {
    expect(
      alertProblems({ ...EMPTY_ALERT_DRAFT, name: 'x', metric: 'error_rate', threshold: '0', webhookId: 'wh-1' }),
    ).toEqual([]);
  });

  it('recusa limiar vazio — `Number("")` é 0 e finito, e passaria', () => {
    // Sem esta guarda a regra nasce com limiar 0 e dispara no primeiro tick: exatamente o "alerta
    // que dispara sem motivo" que o risco #2 do milestone nomeia.
    const problemas = alertProblems({
      ...EMPTY_ALERT_DRAFT, name: 'x', metric: 'error_rate', threshold: '', webhookId: 'wh-1',
    });
    expect(problemas.join(' ')).toMatch(/threshold/i);
  });

  it('recusa limiar que não é número', () => {
    for (const t of ['abc', '   ', 'NaN']) {
      const problemas = alertProblems({
        ...EMPTY_ALERT_DRAFT, name: 'x', metric: 'error_rate', threshold: t, webhookId: 'wh-1',
      });
      expect(problemas.join(' ')).toMatch(/threshold/i);
    }
  });

  it('aceita limiar negativo — decisão explícita, não descuido', () => {
    // Nada no domínio proíbe: `lt -1` é inútil mas não é inválido, e o serviço aceita. Registrar
    // aqui impede que alguém "conserte" isso sem perceber que está mudando o contrato.
    expect(
      alertProblems({ ...EMPTY_ALERT_DRAFT, name: 'x', metric: 'error_rate', threshold: '-1', webhookId: 'wh-1' }),
    ).toEqual([]);
  });
});

describe('visibleAlertProblems', () => {
  it('não acusa campo que o operador ainda não tocou', () => {
    // O formulário abre vazio porque esse é o estado inicial legítimo, não um engano dele. Acusar
    // antes do primeiro toque transforma a tela de partida numa tela de erro — e ensina a ignorar
    // o vermelho justamente onde ele vai importar.
    const vazio = { ...EMPTY_ALERT_DRAFT, metric: METRICA_DE_PROMPT };
    expect(visibleAlertProblems(vazio, new Set())).toEqual({});
  });

  it('acusa o campo depois de tocado', () => {
    const vazio = { ...EMPTY_ALERT_DRAFT, metric: METRICA_DE_PROMPT };
    expect(visibleAlertProblems(vazio, new Set(['promptName'])).promptName).toBeTruthy();
  });

  it('a exibição afrouxa, a validação não', () => {
    // `alertProblems` continua sendo quem libera o submit, independentemente do que está visível.
    const vazio = { ...EMPTY_ALERT_DRAFT, metric: METRICA_DE_PROMPT };
    expect(visibleAlertProblems(vazio, new Set())).toEqual({});
    expect(alertProblems(vazio).length).toBeGreaterThan(0);
  });
});

describe('a chave do problema é o campo', () => {
  it('associa o problema ao campo que o causa, pelo contrato público', () => {
    // Provado por `visibleAlertProblems` em vez de pelo helper interno: a chave que o formulário
    // usa para posicionar a mensagem é a mesma, e testar pelo público mantém o módulo livre de
    // export que ninguém consome.
    const d = { ...EMPTY_ALERT_DRAFT, metric: METRICA_DE_PROMPT, name: 'x', threshold: '3', webhookId: 'wh-1' };
    expect(visibleAlertProblems(d, new Set(['promptName']))).toHaveProperty('promptName');
  });
});

describe('toCreateBody', () => {
  it('envia prompt_name na métrica de prompt', () => {
    const body = toCreateBody({
      ...EMPTY_ALERT_DRAFT,
      name: 'uso',
      metric: METRICA_DE_PROMPT,
      promptName: '  saudacao  ',
      comparator: 'gt',
      threshold: '3',
      windowSeconds: '3600',
      webhookId: 'wh-1',
    });
    expect(body.prompt_name).toBe('saudacao'); // aparado — o backend compara literal
    expect(body.metric).toBe(METRICA_DE_PROMPT);
    expect(body.threshold).toBe(3); // número, não string: o campo do formulário é texto
  });

  it('OMITE prompt_name numa métrica de workspace', () => {
    // Mandar o campo aqui faz o backend recusar por pareamento — o CHECK vale nos dois sentidos.
    const body = toCreateBody({
      ...EMPTY_ALERT_DRAFT,
      name: 'erro',
      metric: 'error_rate',
      promptName: 'saudacao',
      comparator: 'gt',
      threshold: '5',
      windowSeconds: '3600',
      webhookId: 'wh-1',
    });
    expect(body).not.toHaveProperty('prompt_name');
  });
});
