// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { conversationMessages, conversationContentState } from './trust-series';

// #347 (2) — a UI descrevia o DADO quando o fato era sobre PERMISSÃO.
//
// O back-end SUPRIME o campo `content` quando a credencial não traz `trust:content` — de
// propósito, e a razão está no LT-012: "a ausência descreve uma permissão, o vazio descreveria o
// dado". `conversationMessages` filtra exatamente essas mensagens, então uma conversa com 3
// mensagens chegava à tela como `length === 0`, e o texto dizia "não trouxe mensagens legíveis".
//
// Quem lê isso investiga ingestão, parsing, banco — tudo funcionando — e pode abrir bug contra a
// ingestão. A UI ficou do lado errado de uma distinção que o back-end fez com cuidado.
describe('conversationContentState (#347)', () => {
  it('distingue conteúdo RETIDO de conversa vazia', () => {
    const withheld = {
      messages: [
        { id: 'm1', role: 'user' },
        { id: 'm2', role: 'assistant' },
        { id: 'm3', role: 'user' },
      ],
    };
    expect(conversationContentState(withheld)).toEqual({ kind: 'withheld', total: 3 });
    // e o filtro continua devolvendo vazio — é ele que torna a distinção necessária
    expect(conversationMessages(withheld)).toHaveLength(0);
  });

  it('conversa sem mensagem alguma NÃO é conteúdo retido', () => {
    expect(conversationContentState({ messages: [] })).toEqual({ kind: 'empty', total: 0 });
    expect(conversationContentState(null)).toEqual({ kind: 'empty', total: 0 });
  });

  it('conteúdo presente é legível', () => {
    const ok = { messages: [{ id: 'm1', role: 'user', content: 'oi' }] };
    expect(conversationContentState(ok)).toEqual({ kind: 'readable', total: 1 });
  });

  // A metade que impede o oposto: conteúdo PARCIAL não pode virar "tudo retido", senão a tela
  // esconde o que ela poderia mostrar.
  it('parcial conta como legível — o que existe tem de aparecer', () => {
    const partial = {
      messages: [{ id: 'm1', role: 'user', content: 'oi' }, { id: 'm2', role: 'assistant' }],
    };
    expect(conversationContentState(partial)).toEqual({ kind: 'readable', total: 2 });
    expect(conversationMessages(partial)).toHaveLength(1);
  });
});
