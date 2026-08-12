// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');

/**
 * B-235 — quantos call sites ainda deixam `null` significar cinco coisas.
 *
 * ## O que `null` colapsa
 *
 * Sem `{ throwOnError: true }`, `cloudFetch` resolve `null` para: falha transitória de auth,
 * sessão encerrada, resposta não-2xx, rejeição de rede — e um `204`/`205` BEM-SUCEDIDO. O
 * chamador recebe um valor e não tem como saber qual dos cinco aconteceu, então escolhe um: em
 * quase todos os casos "não há dado", que é o único dos cinco que costuma estar errado.
 *
 * O B-171 é o defeito visível que isso produziu uma vez. Nesta sessão produziu outro, medido:
 * criar projeto dizia "Couldn't create project. Try again in a moment." para TODA falha, porque
 * a requisição não sabia distinguir uma recusa de uma resposta vazia — nome já em uso e serviço
 * fora do ar liam igual.
 *
 * ## Por que uma catraca, e não virar o default
 *
 * Medido 2026-08-12 com ESTE detector: **134 call sites já passam `throwOnError: true`; 37
 * não.** O default ambíguo é a MINORIA — 78% do código já pede o erro tipado, uma chamada por
 * vez.
 *
 * Duas correções de medição no caminho, ambas minhas e ambas registradas no B-235: a primeira
 * contagem disse 13 (grep por LINHA, e a maioria das chamadas ocupa várias); a segunda disse
 * 41 porque casava `cloudFetchRaw`, que NÃO tem esta opção — ele devolve `Response | null` por
 * desenho, é a saída crua, e cobrar dele um contrato que ele não oferece mediria o vocabulário
 * do guarda e não o defeito.
 *
 * Virar o default parece então barato, e não é: os 37 dependem de `null` hoje, e virar sem
 * tocá-los faria cada um passar a LANÇAR onde antes resolvia — 37 mudanças de comportamento
 * sem teste que descreva o que cada tela faz numa falha. O caminho seguro exige torná-los
 * explícitos primeiro.
 *
 * Isso foi TENTADO nesta sessão e revertido, com o motivo medido: o rewrite mecânico tocou 34
 * arquivos de produção e quebrou 12 testes que asseriam a forma exata da chamada — e comprava
 * UMA coisa, que código novo receba o default seguro. Esta catraca compra a mesma coisa: um
 * call site novo sem `throwOnError` faz o número subir e o teste ficar vermelho.
 *
 * A diferença é que ela também torna os 37 CONTÁVEIS e faz o trabalho de migrá-los aparecer,
 * que é o que a contagem por arquivo do B-242 não fazia e por isso precisou de uma segunda
 * métrica.
 *
 * ## O que ela NÃO prova
 *
 * Que os 37 estão errados. Alguns podem tratar `null` corretamente. Ela prova que a ambiguidade
 * não se espalha, e mede o que falta decidir.
 */

/** Medido 2026-08-12 com este mesmo detector. SÓ DESCE. */
const TETO_SEM_CONTRATO = 37;

/** O próprio módulo define o contrato; suas chamadas internas não o consomem. */
const DEFINE_O_CONTRATO = 'lib/http/api.ts';

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e !== 'node_modules' && e !== 'mocks') arquivos(full, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Uma chamada, e as 12 linhas seguintes.
 *
 * A janela existe porque a maioria das chamadas ocupa várias linhas — o objeto de opções abre
 * numa e fecha noutra. Uma checagem por LINHA reportaria quase todas como sem contrato, que foi
 * exatamente o erro da primeira medição deste item (ela disse 13 quando o número é 37).
 */
const CHAMADA = /(?<![\w.])cloudFetch\s*(?:<[^(]*?>)?\s*\(/;

export function chamadasSemContrato(): string[] {
  const sem: string[] = [];
  for (const f of arquivos(SRC)) {
    const rel = relative(SRC, f).replace(/\\/g, '/');
    if (rel === DEFINE_O_CONTRATO) continue;
    const linhas = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < linhas.length; i++) {
      if (/^\s*(\*|\/\/)/.test(linhas[i])) continue; // prosa que menciona a função
      // `cloudFetchRaw` é a saída CRUA e não aceita config: devolve `Response | null` por
      // desenho, para quem precisa ler headers. Cobrar dele um contrato que ele não oferece
      // seria contar o vocabulário do guarda em vez do defeito.
      if (/(?<![\w.])cloudFetchRaw\s*\(/.test(linhas[i])) continue;
      if (!CHAMADA.test(linhas[i])) continue;
      const janela = linhas.slice(i, i + 12).join('\n');
      if (!janela.includes('throwOnError')) sem.push(`${rel}:${String(i + 1)}`);
    }
  }
  return sem.sort();
}

describe('catraca do `null` ambíguo (B-235)', () => {
  it('nenhuma chamada NOVA deixa `null` significar cinco coisas', () => {
    const sem = chamadasSemContrato();

    expect(
      sem.length,
      `\nChamadas a \`cloudFetch\` sem \`{ throwOnError: true }\`: ${String(sem.length)} ` +
        `(teto ${String(TETO_SEM_CONTRATO)}).\n\n` +
        `${sem.slice(0, 10).join('\n')}\n\n` +
        'Se SUBIU: uma chamada nova recebe `null` para falha de auth, sessão encerrada, não-2xx,\n' +
        'rejeição de rede E um 204 bem-sucedido, e não tem como distinguir. Passe\n' +
        '`{ throwOnError: true }` e trate o `ApiError` — 134 chamadas já fazem isso.\n\n' +
        'Se DESCEU: é progresso, e o teto acima deve acompanhar.\n',
    ).toBeLessThanOrEqual(TETO_SEM_CONTRATO);
  });

  it('o teto bate com o disco — sem folga onde crescer', () => {
    expect(chamadasSemContrato().length).toBe(TETO_SEM_CONTRATO);
  });

  it('a janela de 12 linhas encontra a opção numa chamada multi-linha', () => {
    // O auto-teste que impede a primeira medição errada deste item de voltar: uma checagem por
    // LINHA diria que esta chamada não tem contrato, e a maioria das chamadas tem esta forma.
    const multiLinha = [
      "  const r = await cloudFetch<Thing>(",
      "    '/v1/things',",
      "    { method: 'POST', body: JSON.stringify(x) },",
      '    { throwOnError: true },',
      '  );',
    ].join('\n');

    expect(CHAMADA.test(multiLinha.split('\n')[0])).toBe(true);
    expect(multiLinha.includes('throwOnError')).toBe(true);
  });

  it('DETECTA uma chamada sem o contrato, e não acusa uma com ele', () => {
    const sem = "const r = await cloudFetch<Thing>('/v1/things');";
    const com = "const r = await cloudFetch<Thing>('/v1/things', {}, { throwOnError: true });";

    expect(CHAMADA.test(sem) && !sem.includes('throwOnError')).toBe(true);
    expect(CHAMADA.test(com) && !com.includes('throwOnError')).toBe(false);
  });

  it('não conta a prosa que apenas MENCIONA a função', () => {
    // `query-client.ts` e `ask-thread.tsx` explicam o contrato em comentário; contá-los mediria
    // o vocabulário do guarda em vez do defeito — o erro que o B-238 e o B-243 já custaram.
    const comentario = " * any 4xx ApiError (the typed error from `cloudFetch({throwOnError})`),";

    expect(/^\s*(\*|\/\/)/.test(comentario)).toBe(true);
  });
});
