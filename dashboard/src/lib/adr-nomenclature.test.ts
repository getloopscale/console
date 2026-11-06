// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const ADR_DIR = resolve(__dirname, '../../docs/adr');

/**
 * B-098 — as duas nomenclaturas de ADR, e qual delas resolve.
 *
 * ## O que foi medido
 *
 * 234 comentários citam `ADR D1`..`ADR D9`. Nenhum resolve para os arquivos de
 * `docs/adr/`, que são `ADR-0001`..`ADR-0009`.
 *
 * O item foi filado como "citação quebrada", e essa leitura estava errada. Elas
 * não são referências mal-escritas aos ADRs do repositório: são referências à
 * decisão `D<n>` de um **plano**, pela convenção do `/to-plan`, em que cada
 * plano numera as suas próprias decisões. O `D2` de um arquivo e o `D2` de outro
 * são, em geral, decisões diferentes de planos diferentes.
 *
 * Por isso as duas saídas que o DoD oferecia não servem:
 *
 * - **"as citações usam a mesma nomenclatura dos arquivos"** exigiria decidir,
 *   para cada uma das 234, qual dos 9 ADRs ela significa — e para a maioria a
 *   resposta é nenhum. `ADR D2` sobre contraste WCAG não vira `ADR-0002`, que é
 *   sobre orçamento de LoC.
 * - **"existe um mapa D1..D9 → ADR-000N"** é impossível, não difícil: não há
 *   função de um para o outro.
 *
 * E os planos citados não existem mais em `.claude/knowledge-base/plans/`
 * (verificado 2026-08-07), então nem as 33 citações que nomeiam o plano levam a
 * algum lugar.
 *
 * ## O que este teste faz então
 *
 * Fecha a CLASSE em vez de reescrever a arqueologia. A contagem existente é
 * congelada e só pode encolher; `docs/adr/README.md` explica as duas
 * nomenclaturas para quem esbarrar numa. Reescrever as 234 exigiria inventar
 * conteúdo que ninguém pode recuperar — e uma citação errada é mais convincente
 * que uma que não resolve.
 */

/**
 * Contagem congelada em 2026-08-07 com 234. **Só encolhe.**
 *
 * B-246 mediu a promessa desta nota em 2026-08-12 e ela não se sustentava como
 * estava escrita. "Encolhe sozinha à medida que os arquivos sejam reescritos por
 * outros motivos" rendeu **1 citação em 5 dias**, sobre 134 arquivos: 234 -> 233.
 * Nesse ritmo a classe leva cerca de três anos, o que é uma aposta e não um
 * plano — que foi exatamente a crítica que abriu o item.
 *
 * A resposta não é acelerar. As duas saídas que restam foram medidas e nenhuma
 * paga:
 *
 *   - reescrever para `ADR-000N` exigiria decidir, para cada citação, qual ADR
 *     ela significa, e para a maioria a resposta é nenhum (B-098);
 *   - renomear a classe para `plan decision D<n>` tocaria 234 sítios em 134
 *     arquivos — incluindo NOMES DE TESTE, como
 *     `reverify-button.test.tsx:25` — e trocaria uma referência enganosa por uma
 *     honesta que continua não resolvendo, porque os planos citados usam o
 *     formato `data-slug` e nenhum está no disco (re-verificado 2026-08-12
 *     contra os 42 planos que existem, todos em formato de tópico).
 *
 * Então o valor desta catraca NÃO é encolher: é **impedir crescer**, e isso ela
 * faz e prova. O segundo caso deste arquivo garante que a notação canônica
 * `ADR-000N` sempre resolve, e o terceiro que o README que explica as duas
 * existe e está atualizado. A classe está contida, documentada e fechada para
 * novos membros — que é o resultado, não um consolo.
 */
const TETO_CITACOES_DE_PLANO = 233;

/**
 * O arquivo cuja MATÉRIA é a notação não conta como uso dela.
 *
 * A primeira execução acusou 237 contra um teto de 234 — e as três a mais eram a
 * prosa deste próprio arquivo, que escreve `ADR D1`..`ADR D9` para explicar o
 * que são. O guard estava certo sobre o texto e errado sobre o fato: é a mesma
 * confusão entre FORMA e SIGNIFICADO que ele existe para resolver.
 *
 * Excluir só este arquivo, e não todos os testes: um teste pode legitimamente
 * carregar uma citação, e escondê-los todos abriria uma porta pela qual a classe
 * voltaria a crescer sem ser vista.
 */
const DESCREVE_A_NOTACAO = 'adr-nomenclature.test.ts';

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx|css)$/.test(e) && e !== DESCREVE_A_NOTACAO) out.push(full);
  }
  return out;
}

describe('nomenclatura de ADR (B-098)', () => {
  it('as citações `ADR D<n>` só encolhem — nenhuma nova entra', () => {
    let total = 0;
    for (const f of arquivos(SRC)) {
      total += (readFileSync(f, 'utf8').match(/ADR D\d/g) ?? []).length;
    }

    expect(
      total,
      `Há ${total} citações \`ADR D<n>\` no código, e o teto é ${TETO_CITACOES_DE_PLANO}.\n\n` +
        'Elas referenciam a decisão D<n> de um PLANO, não um ADR deste repositório,\n' +
        'e os planos citados não estão mais no disco — então elas não resolvem.\n\n' +
        'Uma citação nova deve usar `ADR-000N`, a forma versionada. Ver\n' +
        'docs/adr/README.md, que explica as duas nomenclaturas e por que um mapa\n' +
        'entre elas é impossível (cada plano numera o seu próprio D1..D9).\n',
    ).toBeLessThanOrEqual(TETO_CITACOES_DE_PLANO);
  });

  it('toda citação `ADR-000N` resolve para um arquivo real', () => {
    const existentes = new Set(
      readdirSync(ADR_DIR)
        .filter((f) => /^\d{4}-/.test(f))
        .map((f) => f.slice(0, 4)),
    );
    const quebradas: string[] = [];

    for (const f of arquivos(SRC)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/ADR-(\d{4})/g)) {
        if (!existentes.has(m[1])) quebradas.push(`${f} → ADR-${m[1]}`);
      }
    }

    expect(
      quebradas,
      'Citação `ADR-000N` que não resolve. Esta nomenclatura é a canônica, e o\n' +
        'ponto dela é justamente resolver — se ela também não resolvesse, não\n' +
        'haveria diferença entre as duas e o README seria ficção.\n',
    ).toEqual([]);
  });

  it('o README das duas nomenclaturas existe e lista os ADRs reais', () => {
    const readme = readFileSync(join(ADR_DIR, 'README.md'), 'utf8');
    const reais = readdirSync(ADR_DIR).filter((f) => /^\d{4}-/.test(f));
    // Um índice que envelhece em silêncio é pior que nenhum: quem o lê acredita
    // que a lista está completa.
    for (const f of reais) {
      expect(readme, `README não menciona ${f}`).toContain(`ADR-${f.slice(0, 4)}`);
    }
  });
});
