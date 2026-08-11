// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Globe } from 'lucide-react';
import { estadoDaLista } from './list-state';

const VAZIO = { icon: Globe, title: 'No custom domains yet' };

describe('estadoDaLista — ausência e ignorância não são a mesma tela', () => {
  it('devolve o estado vazio quando a leitura deu certo', () => {
    expect(estadoDaLista({ erro: false, vazio: VAZIO }, 'domains')).toBe(VAZIO);
  });

  it('NÃO afirma ausência quando a leitura falhou', () => {
    const s = estadoDaLista({ erro: true, vazio: VAZIO }, 'domains')!;
    expect(s.title).not.toMatch(/no custom domains yet/i);
    expect(s.title).toMatch(/could not read domains/i);
  });

  it('diz ao usuário o que a tela NÃO está mostrando', () => {
    // A diferença que importa: "não há nada" é um fato sobre os dados; "não li" é um fato
    // sobre a requisição. A segunda tem de dizer que a lista não representa o que existe.
    const s = estadoDaLista({ erro: true, vazio: VAZIO }, 'domains')!;
    expect(s.description).toMatch(/not showing what exists/i);
  });
});

describe('estadoDaLista — quando a lista tem linhas', () => {
  it('não vira estado de erro por cima de dados que existem', () => {
    // `vazio === undefined` é como o PageShell diz "há linhas". Um erro de refetch sobre
    // dados velhos pede uma tarja, não um estado vazio — e essa decisão não é desta função.
    expect(estadoDaLista({ erro: true, vazio: undefined }, 'domains')).toBeUndefined();
  });
});

describe('B-167 — nenhuma página afirma ausência sem consultar um sinal de erro', () => {
  const SRC = resolve(__dirname, '..');

  /** Todos os `.tsx` de página, sem testes. */
  function paginas(): string[] {
    const achados: string[] = [];
    const pilha = [join(SRC, 'pages')];
    while (pilha.length > 0) {
      const atual = pilha.pop();
      if (atual === undefined) break;
      for (const nome of readdirSync(atual)) {
        const caminho = join(atual, nome);
        if (statSync(caminho).isDirectory()) pilha.push(caminho);
        else if (nome.endsWith('.tsx') && !nome.includes('.test.')) achados.push(caminho);
      }
    }
    return achados;
  }

  it('toda página que passa `empty=` consulta um erro para montá-lo', () => {
    // O defeito: `PageShell` tem `loading` e `empty`, as páginas escrevem o descritor à mão, e uma
    // leitura que FALHOU produz zero linhas — zero linhas caem no ramo `empty`, e a tela afirma
    // ausência. `infra/domains.tsx` dizia "No custom domains yet" durante um 5xx.
    //
    // Consertar as oito não impede a nona. Este guarda exige que quem monta um `empty=` tenha
    // consultado um sinal de erro no mesmo arquivo — por `estadoDaLista`, pela prop `error=` do
    // PageShell, ou lendo `isError`/`error` diretamente.
    const sem: string[] = [];
    for (const f of paginas()) {
      const fonte = readFileSync(f, 'utf-8');
      if (!/\bempty=\{/.test(fonte)) continue;
      // DUAS formas sancionadas, e só duas. A primeira versão deste predicado aceitava também
      // um `isError` ou um `error:` qualquer no arquivo, e uma mutação que arrancava a consulta
      // de erro passava mesmo assim — casando outra coisa em outro lugar. Um guarda que aprova
      // pelo motivo errado não é guarda, e a frouxidão era o motivo errado.
      //
      // Exigir uma das duas também dá à página UM jeito de fazer isso, em vez de cinco.
      const consultaErro = /estadoDaLista\(/.test(fonte) || /\berror=\{/.test(fonte);
      if (!consultaErro) sem.push(relative(SRC, f));
    }

    expect(
      sem,
      '\nPágina(s) que montam um estado vazio SEM consultar nenhum sinal de erro:\n\n' +
        `${sem.map((p) => `  ${p}`).join('\n')}\n\n` +
        'Uma leitura que falhou produz zero linhas, e zero linhas caem no ramo `empty`. A tela\n' +
        'afirma que não há nada quando o que houve foi não conseguir ler — e as duas coisas pedem\n' +
        'ações diferentes de quem está olhando.\n\n' +
        'Use `estadoDaLista({ erro, vazio }, recurso)` de `lib/list-state.ts`, ou a prop `error=`\n' +
        'do PageShell (que o design system aceita e `lens/labeling-queue.tsx` já usa).\n',
    ).toEqual([]);
  });

  it('o guarda ainda encontra páginas com `empty=` — um zero silencioso não passa por cobertura', () => {
    const comEmpty = paginas().filter((f) => /\bempty=\{/.test(readFileSync(f, 'utf-8')));
    expect(comEmpty.length).toBeGreaterThanOrEqual(5);
  });

  it('DETECTA uma página que monta `empty=` sem consultar erro', () => {
    // Auto-teste do predicado contra uma amostra sintética. Sem ele, um predicado que parasse de
    // discriminar deixaria o caso acima verde — que foi exatamente o que aconteceu com a primeira
    // versão deste guarda, e só uma mutação revelou.
    const ruim = '<PageShell loading={loading} empty={{ title: "nada aqui" }} />';
    const bom = '<PageShell loading={loading} empty={estadoDaLista({ erro, vazio }, "x")} />';
    const consulta = (f: string) => /estadoDaLista\(/.test(f) || /\berror=\{/.test(f);

    expect(/\bempty=\{/.test(ruim)).toBe(true);
    expect(consulta(ruim)).toBe(false);
    expect(consulta(bom)).toBe(true);
  });
});
