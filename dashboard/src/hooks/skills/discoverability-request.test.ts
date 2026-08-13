import { describe, expect, it } from 'vitest';

import { diagnosticBody } from './discoverability-request';

/**
 * M34 / theo-skills#144 — o corpo enviado ao diagnóstico de descobribilidade.
 *
 * O defeito, medido no `app-dev` em 2026-08-04: a tela de autoria enviava `has_embedding: false`
 * **fixo** para uma skill que ainda não existe. O serviço então respondia
 * `causes: ["no_embedding"]` com o conselho *"Republique para gerar o vetor"* — instrução
 * impossível para algo nunca publicado.
 *
 * E, por disparar sempre, essa causa **dominava o veredito**: as duas que o autor poderia
 * corrigir ali mesmo — descrição genérica e colisão com uma vizinha — ficavam soterradas. A
 * pergunta que ele fez ("minha descrição está boa?") não era respondida.
 *
 * O contrato distingue os três casos pela PRESENÇA do campo, não pelo seu valor:
 *
 *   ausente  → rascunho: não há revisão, logo não há vetor a cobrar
 *   false    → publicada e sem vetor: achado real, a ingestão falhou ou não rodou
 *   true     → publicada e com vetor
 *
 * O que torna isto fácil de errar é justamente a sutileza — e nós erramos. Por isso a entrada
 * aqui é uma união discriminada, e não um booleano opcional: "não publicada e com vetor" deixa
 * de ser um valor que se possa escrever.
 */

describe('corpoDoDiagnostico', () => {
  it('rascunho OMITE has_embedding — não manda `false`', () => {
    const corpo = diagnosticBody('Converter moeda', 'Converte moeda para reais.', {
      publicada: false,
    });
    expect('has_embedding' in corpo).toBe(false);
    expect(corpo).toEqual({ name: 'Converter moeda', description: 'Converte moeda para reais.' });
  });

  it('publicada sem vetor manda `false` EXPLÍCITO — ali o achado é real', () => {
    const corpo = diagnosticBody('x', 'y', { publicada: true, hasVector: false });
    expect(corpo.has_embedding).toBe(false);
  });

  it('publicada com vetor manda `true`', () => {
    const corpo = diagnosticBody('x', 'y', { publicada: true, hasVector: true });
    expect(corpo.has_embedding).toBe(true);
  });

  it('a diferença entre rascunho e publicada-sem-vetor é OBSERVÁVEL no corpo', () => {
    // O contraste que o defeito apagava: os dois casos produziam exatamente o mesmo corpo, e o
    // serviço não tinha como distinguir a pergunta que estava respondendo.
    const rascunho = diagnosticBody('x', 'y', { publicada: false });
    const publicadaSemVetor = diagnosticBody('x', 'y', { publicada: true, hasVector: false });
    expect(rascunho).not.toEqual(publicadaSemVetor);
  });
});
