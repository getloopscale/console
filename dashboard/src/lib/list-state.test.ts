// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { Globe } from 'lucide-react';
import { estadoDaLista } from './list-state';

const VAZIO = { icon: Globe, title: 'No custom domains yet' };

describe('estadoDaLista — ausência e ignorância não são a mesma tela', () => {
  it('devolve o estado vazio quando a leitura deu certo', () => {
    expect(estadoDaLista({ erro: false, vazio: VAZIO }, 'domains')).toBe(VAZIO);
  });

  it('NÃO afirma ausência quando a leitura falhou', () => {
    const s = estadoDaLista({ erro: true, vazio: VAZIO }, 'domains');
    expect(s.title).not.toMatch(/no custom domains yet/i);
    expect(s.title).toMatch(/could not read domains/i);
  });

  it('diz ao usuário o que a tela NÃO está mostrando', () => {
    // A diferença que importa: "não há nada" é um fato sobre os dados; "não li" é um fato
    // sobre a requisição. A segunda tem de dizer que a lista não representa o que existe.
    const s = estadoDaLista({ erro: true, vazio: VAZIO }, 'domains');
    expect(s.description).toMatch(/not showing what exists/i);
  });
});
