import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/http/api';

import { serviceCode, serviceMessage } from './trust-api';

/**
 * M24 T3.1 — a costura onde a mensagem do serviço sobrevive ou morre.
 *
 * O DoD do milestone exige que um `422 INVALID_SPEC` chegue ao operador COM o texto do serviço,
 * "nunca como erro genérico". Se este módulo colapsar `{code,message}` num `Error('erro')`, nenhuma
 * tela consegue cumprir aquilo depois — por isso o contrato é fixado aqui e não em cada tela.
 */

const FALLBACK = 'Não foi possível salvar a guardrail.';

describe('serviceMessage', () => {
  it('preserva a mensagem de um 422 INVALID_SPEC', () => {
    const err = new ApiError(422, { code: 'INVALID_SPEC', message: 'terms must not be empty' });
    expect(serviceMessage(err, FALLBACK)).toBe('terms must not be empty');
  });

  it('preserva a mensagem de um 422 VALIDATOR_NAME_RESERVED', () => {
    const err = new ApiError(422, {
      code: 'VALIDATOR_NAME_RESERVED',
      message: 'name "pii" is reserved by the platform',
    });
    expect(serviceMessage(err, FALLBACK)).toBe('name "pii" is reserved by the platform');
  });

  it('preserva a mensagem de um 409 CONFLICT', () => {
    const err = new ApiError(409, { code: 'CONFLICT', message: 'a validator with this name already exists' });
    expect(serviceMessage(err, FALLBACK)).toBe('a validator with this name already exists');
  });

  it('cai no fallback quando o erro não traz corpo tipado', () => {
    // 500 sem corpo: não há texto do serviço a preservar. O fallback diz o que falhou,
    // e a tela ainda o embrulha na estrutura de 6 elementos do DESIGN.md § 6.1.
    expect(serviceMessage(new ApiError(500), FALLBACK)).toBe(FALLBACK);
  });

  it('distingue falha de rede de recusa do serviço', () => {
    // ApiError(0) é o que cloudFetch produz quando a requisição nem chegou. Dizer
    // "não foi possível salvar" ali sugeriria que o servidor recusou, e ele nem foi consultado.
    expect(serviceMessage(new ApiError(0, undefined, 'network request failed'), FALLBACK)).toBe(
      'Não foi possível falar com o servidor.',
    );
  });

  it('ignora corpo cuja message é vazia ou não-string', () => {
    expect(serviceMessage(new ApiError(422, { code: 'X', message: '   ' }), FALLBACK)).toBe(FALLBACK);
    expect(serviceMessage(new ApiError(422, { code: 'X', message: 42 }), FALLBACK)).toBe(FALLBACK);
  });

  it('não estoura com erro que não é ApiError', () => {
    expect(serviceMessage(new Error('qualquer'), FALLBACK)).toBe(FALLBACK);
    expect(serviceMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(serviceMessage('string solta', FALLBACK)).toBe(FALLBACK);
  });
});

describe('serviceCode', () => {
  it('extrai o código tipado quando existe', () => {
    expect(serviceCode(new ApiError(422, { code: 'INVALID_SPEC', message: 'x' }))).toBe('INVALID_SPEC');
  });

  it('devolve null quando não há código', () => {
    expect(serviceCode(new ApiError(500))).toBeNull();
    expect(serviceCode(new ApiError(422, { message: 'sem code' }))).toBeNull();
    expect(serviceCode(new Error('outro'))).toBeNull();
  });
});
