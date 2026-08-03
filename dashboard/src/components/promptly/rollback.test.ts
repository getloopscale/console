import { describe, it, expect } from 'vitest';
import {
  resultadoDoRollback,
  frasePreRollback,
  labelsOferecidos,
  mensagemDeRecusa,
} from './rollback';
import { ApiError } from '@/lib/api';

/**
 * M12 T6/T7 — o que a tela AFIRMA sobre reverter, e o que ela oferece para escolher.
 *
 * Os dois casos mais importantes deste arquivo vieram de medição contra a API real, não de
 * imaginação (`/edge-case-plan`, EC-1 e EC-2).
 */

describe('frasePreRollback — o que o diálogo promete ANTES de chamar', () => {
  it('rollback_dialog_names_the_new_revision_it_creates', () => {
    // Medido: reverter CRIA revisão nova. Um texto de "volta para a v1" faz o operador esperar
    // o histórico encolher, e ele nunca encolhe.
    const frase = frasePreRollback({ nome: 'saudacao', paraVersao: 1, ultimaVersao: 4, label: 'prod' });
    expect(frase).toContain('v5');
    expect(frase).toContain('v1');
    expect(frase).toContain('prod');
    expect(frase).not.toContain('volta para');
  });

  it('rollback_dialog_says_no_label_moves_when_none_was_chosen', () => {
    const frase = frasePreRollback({ nome: 'x', paraVersao: 1, ultimaVersao: 2, label: null });
    expect(frase).toContain('nenhum label');
  });
});

describe('resultadoDoRollback — o que a tela afirma DEPOIS (EC-1)', () => {
  it('rollback_result_comes_from_labelsMoved_not_from_the_status', () => {
    // Medido: um prompt SEM NENHUM label devolve 201 com labelsMoved: []. A revisão é criada e
    // NADA EM PRODUÇÃO MUDA. Ler "revertido" do status 201 recria o defeito LT-030 — que o
    // produto já corrigiu no CORPO da resposta — uma camada acima.
    const r = resultadoDoRollback({ version: 3, labelsMoved: [], currentLabels: [] });
    expect(r.tom).toBe('atencao');
    expect(r.texto).toContain('v3');
    expect(r.texto).toContain('nenhum label foi movido');
    expect(r.texto).not.toMatch(/revertido com sucesso/i);
  });

  it('rollback_result_names_the_label_that_actually_moved', () => {
    const r = resultadoDoRollback({
      version: 5,
      labelsMoved: ['prod'],
      currentLabels: [{ label: 'prod', version: 5 }],
    });
    expect(r.tom).toBe('sucesso');
    expect(r.texto).toContain('prod');
    expect(r.texto).toContain('v5');
  });
});

describe('labelsOferecidos + mensagemDeRecusa — a recusa vira escolha (EC-2)', () => {
  it('rollback_without_label_offers_the_available_labels', () => {
    const erro = new ApiError(400, {
      error: 'label_required',
      message: 'rollback de "x" precisa do label a reverter — existentes: prod, staging',
      availableLabels: ['prod', 'staging'],
    });
    expect(labelsOferecidos(erro)).toEqual(['prod', 'staging']);
  });

  it('rollback_label_is_chosen_never_typed', () => {
    // Medido: um label INEXISTENTE devolve 404 `prompt_not_found` — o operador erra uma letra
    // num incidente e é informado de que o prompt não existe. Oferecer só o que a API devolveu
    // torna esse 404 INALCANÇÁVEL pela UI; corrigir a mensagem seria remendo.
    const doPrompt = labelsOferecidos(null, [{ label: 'prod', version: 2 }]);
    expect(doPrompt).toEqual(['prod']);
  });

  it('rollback_missing_version_shows_the_version_it_refused', () => {
    // O corpo do 404 carrega `toVersion`. Sem renderizá-lo, "prompt não encontrado" num prompt
    // visível na tela é uma contradição que trava o operador.
    const erro = new ApiError(404, { error: 'prompt_not_found', name: 'x', toVersion: 99 });
    expect(mensagemDeRecusa(erro)).toContain('99');
  });

  it('rollback_refusal_renders_the_service_message_when_there_is_one', () => {
    const erro = new ApiError(400, { error: 'invalid_body', message: 'toVersion deve ser positivo' });
    expect(mensagemDeRecusa(erro)).toBe('toVersion deve ser positivo');
  });

  it('upstream_5xx_still_becomes_a_generic_message', () => {
    // O controle negativo. Sem ele, o repasse vira matcher cego e vaza detalhe interno do
    // serviço para a tela do cliente.
    const erro = new ApiError(502, { error: 'upstream_error', message: 'dial tcp 10.0.0.4:8080' });
    const msg = mensagemDeRecusa(erro);
    expect(msg).not.toContain('10.0.0.4');
    expect(msg).toMatch(/não foi possível/i);
  });
});
