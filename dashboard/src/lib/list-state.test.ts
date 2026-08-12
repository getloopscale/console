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

  /**
   * Congelado em 2026-08-11, medido com este mesmo detector.
   *
   * A primeira versão deste guarda só olhava arquivos com `empty={`, e por isso era cega a
   * `memory/webhooks.tsx` — que afirma ausência por ternário inline. Alargá-lo revelou uma
   * população maior do que as oito páginas do B-167: telas que afirmam "não há nada" sem
   * consultar erro nenhum, todas anteriores a este ciclo.
   *
   * Corrigir as oito não impede a nona, e corrigir todas de uma vez não cabia nesta fatia. A
   * catraca é a resposta que este repositório já usa para exatamente isso (orçamento de LoC,
   * asserções de ausência, tipos sem importador): a população fica congelada e só pode DESCER.
   * Nenhuma tela nova entra; cada uma que sair baixa o teto.
   */
  const TETO_SEM_ERRO = 23;

  /**
   * Os dois predicados do guarda, nomeados (B-237).
   *
   * O auto-teste lá embaixo REESCREVIA a regra numa constante local e verificava a cópia — provava
   * que a expressão que ele mesmo acabara de escrever funcionava, e nada sobre o guarda. Um
   * predicado que parasse de discriminar deixava tudo verde, que é o defeito que este arquivo
   * inteiro existe para pegar em outras telas.
   */
  const afirmaAusencia = (fonte: string) =>
    /\bempty=\{/.test(fonte) ||
    /(?:length === 0|length !== 0)[\s\S]{0,400}?(?:No |Nenhum|Nada|não há|nao ha)/i.test(fonte);

  const consultaErro = (fonte: string) =>
    /estadoDaLista\(/.test(fonte) || /\berror=\{/.test(fonte) || /\bisError\b/.test(fonte);

  function paginasSemConsultaDeErro(): string[] {
    const sem: string[] = [];
    for (const f of paginas()) {
      const fonte = readFileSync(f, 'utf-8');
      if (!afirmaAusencia(fonte)) continue;
      if (!consultaErro(fonte)) sem.push(relative(SRC, f));
    }
    return sem;
  }

  it('nenhuma tela NOVA afirma ausência sem consultar um sinal de erro', () => {
    const sem = paginasSemConsultaDeErro();

    expect(
      sem.length,
      `\nTelas que afirmam ausência sem consultar erro: ${String(sem.length)} (teto ${String(TETO_SEM_ERRO)}).\n\n` +
        `${sem.map((p) => `  ${p}`).join('\n')}\n\n` +
        'Se SUBIU: uma tela nova afirma que não há nada quando o que houve foi não conseguir ler.\n' +
        'As duas coisas pedem ações diferentes de quem está olhando. Use\n' +
        '`estadoDaLista({ erro, vazio }, recurso)` ou a prop `error=` do PageShell.\n\n' +
        'Se DESCEU: é progresso, e o teto acima deve acompanhar.\n',
    ).toBeLessThanOrEqual(TETO_SEM_ERRO);
  });

  it('o teto bate com o disco — sem folga onde crescer', () => {
    expect(paginasSemConsultaDeErro().length).toBe(TETO_SEM_ERRO);
  });

  it('o guarda ainda encontra páginas com `empty=` — um zero silencioso não passa por cobertura', () => {
    const comEmpty = paginas().filter((f) => /\bempty=\{/.test(readFileSync(f, 'utf-8')));
    expect(comEmpty.length).toBeGreaterThanOrEqual(5);
  });

  it('DETECTA uma página que monta `empty=` sem consultar erro', () => {
    // B-237 — este auto-teste declarava uma cópia da regra (`const consulta = …`) e verificava a
    // cópia. Agora chama OS MESMOS predicados que o guarda usa: se um deles parar de discriminar,
    // este caso fica vermelho junto.
    const ruim = '<PageShell loading={loading} empty={{ title: "nada aqui" }} />';
    const bom = '<PageShell loading={loading} empty={estadoDaLista({ erro, vazio }, "x")} />';

    expect(afirmaAusencia(ruim)).toBe(true);
    expect(consultaErro(ruim)).toBe(false);
    expect(consultaErro(bom)).toBe(true);
  });

  it('DETECTA a forma sem `empty=` — a que tornou o guarda cego à nona tela', () => {
    // O B-167 foi marcado shipped com uma nona tela viva porque o guarda pulava qualquer arquivo
    // sem `empty={`. A afirmação de ausência por ternário inline é a forma que faltava.
    const ternario = 'return items.length === 0 ? <p>No webhooks yet</p> : <Table />;';
    expect(afirmaAusencia(ternario)).toBe(true);
    expect(consultaErro(ternario)).toBe(false);
  });

  it('e NÃO acusa uma tela que consulta o erro por `isError`', () => {
    const comIsError = '<PageShell empty={{ title: "x" }} />\nif (query.isError) return <Alert />;';
    expect(afirmaAusencia(comIsError)).toBe(true);
    expect(consultaErro(comIsError)).toBe(true);
  });
});
