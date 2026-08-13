// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { absenceAssertionsIn, unanchoredIn, selectorCore } from '@/test/absence-assertion';

const SRC = resolve(__dirname, '..');

/**
 * Absence-assertion ratchet (B-162 · family F4 · sharpened by B-242).
 *
 * ## The defect this freezes
 *
 * `expect(queryBy…).toBeNull()` only proves something when the queried element EXISTS in the case
 * that passes and DISAPPEARS in the one that fails. When it is absent in both, the assertion is
 * satisfied by correct behaviour and by the defect alike — and no change to the code can turn it
 * red.
 *
 * Not a hypothesis. Measured on 2026-08-11, by execution, in four cases:
 *
 *   - the skills-chart guard was DELETED and its 10 tests stayed green, because `CategoryBars`
 *     returns a `<p>` and no table when the bars are empty, and every page derives empty bars from
 *     a failed read: `queryByRole('table')` is null in both worlds;
 *   - the zero-sliver floor was RESTORED and 18 tests stayed green;
 *   - `capability-overview.test.ts`'s `rendered()` matched a JSX tag inside a comment — the hole
 *     its own docblock claimed to have closed;
 *   - the trust chart came up green with the catalogue BROKEN (B-227, since fixed).
 *
 * ## Why a ratchet and not a ban
 *
 * The form is not wrong in itself: against an element that exists in the happy case it is the right
 * assertion. Banning it would produce 97 suppressions and no reading. What is wrong is the
 * POPULATION growing with nobody looking — so the number freezes and only goes down.
 *
 * When fixing a file, lower the ceiling. When adding a test, prefer asserting the absence of an
 * element that IS present in the passing case (a heading, a label) over one that disappears in both.
 *
 * ## Third measurement (2026-08-12), after a review gutted the second
 *
 * The second measurement said 116 unanchored out of 327. A reviewer mutated the detector and
 * proved the self-test was decorative — it held a hardcoded COPY of the anchor rule, so widening
 * `(?:get|find)` to accept `query` took the count from 116 to 15 with 6/6 green.
 *
 * Rebuilt in `lib/absence-assertion.ts`, with each correction measured on its own:
 *
 *   340 / 117  raw
 *   337 / 116  comments stripped     — 3 assertions that live only inside a comment or an it.skip
 *   336 / 116  balanced parentheses  — 1 selector whose arguments contain a nested call
 *   309 / 110  assertions only       — 27 occurrences were `const el = queryBy…`, which assert
 *                                      NOTHING; 6 of them were reported as unanchored assertions
 *                                      that did not exist
 *   309 / 110  queryBy as an anchor  — no change on this corpus; a presence assertion written with
 *                                      `queryBy` is a legitimate anchor and no file uses one today
 *   317 / 111  trailing comma        — MY OWN undercount, caught by the file ceiling below
 *
 * **317 absence assertions, 111 unanchored, in 98 files.**
 *
 * That last line is the one worth reading. Requiring the matcher to follow the query's closing
 * paren missed the multi-line form, where a comma sits between them:
 *
 *     expect(
 *       screen.queryByText(/…/i),
 *     ).not.toBeInTheDocument();
 *
 * Nothing about the numbers looked wrong — 110 is a plausible number, and it was LOWER, which
 * reads as progress. What caught it was the per-file count disagreeing with the old detector by
 * exactly one file (`pages/infra/components/promote-dialog.test.tsx`). Two independent counts of
 * the same population is why the file ratchet stays; it is the only thing that made a silent
 * undercount visible, and a silent undercount is how a ratchet stops guarding while still passing.
 *
 * With that fixed the two counts agree: 98 files, both ways. The unanchored figure went UP from
 * the old 116 to 111 net of six false positives — a correction in both directions, not a
 * narrowing. Lowering a ceiling by narrowing its detector is what B-238 recorded and what B-235
 * repeated hours earlier.
 *
 * ## Fourth reading (2026-08-12) — the syntax tree, B-269
 *
 *   317 / 111  text: comments stripped, parens balanced, trailing comma allowed
 *   319 / 113  `ts.createSourceFile`
 *
 * Two more, and neither is new debt — they are assertions the text reading could not see at all
 * (both named in the ceiling's own docblock below). An architecture review had called the
 * hand-rolled scanner a Rule 9 miss with a LATENT limit; measuring proved the limit was LIVE. I
 * had checked one manifestation — an unbalanced paren inside a regex — found none, and generalised
 * from it. The apostrophe in `/hasn't stored any memories/i` is the same bug wearing different
 * clothes, and it was sitting in the corpus the whole time.
 *
 * The lesson is the cycle's own, one level up: I measured whether a specific SHAPE occurred instead
 * of whether the CLASS of defect could occur, and reported the reassuring answer.
 */

const SELF = 'absence-assertion-ratchet.test.ts';

/**
 * Unanchored assertions. ONLY GOES DOWN — except when the DETECTOR gets more correct, which is
 * what happened here and is stated rather than smoothed over.
 *
 * 111 measured 2026-08-12 by reading the text. **113** the same day by reading the syntax tree
 * (B-269). The two extra are not new debt; they are assertions the text reading could not see:
 *
 *   pages/lens/monitors.test.tsx:389   expect(query, 'why this matters').not.toBeInTheDocument()
 *   pages/memory/memories.test.tsx:75  expect(screen.queryByText(/hasn't stored any memories/i))
 *
 * The first is a two-argument `expect()` carrying a custom failure message, so the matcher does
 * not follow the query's closing paren. The second holds an APOSTROPHE inside a regex literal, and
 * the hand-rolled bracket counter treated `'` as opening a string — after which it skipped the
 * parens it needed to balance. Both are the same defect in different clothes: a counter that reads
 * `(`, `)` and `'` as text cannot know it is inside a regex literal, and a matcher is not always
 * the next token.
 *
 * Measured both ways side by side before changing this number: 113 by AST, 111 by text, and the
 * delta is exactly those two files — nothing else moved.
 *
 * **106 later the same day**, and this one is real progress rather than a better measurement.
 * `app-sidebar.test.tsx` held EIGHT of them: six proved a submenu had opened by asserting that
 * 'Domains' and 'Projects' were absent, and no case in the file ever showed those two texts. The
 * file's own docblock described the pair in prose — "a asserção é pela AUSÊNCIA dos itens que só a
 * raiz tem" — and nothing executed it, so a rename or a typo in either selector satisfied all six
 * for the wrong reason. One case rendering the root and asserting both present anchors seven at
 * once; removing it puts the count straight back to 113.
 */
// 102 desde 2026-08-12, e a queda NAO foi um lote de asserções ancoradas: 3 delas nunca estiveram
// desancoradas e o DETECTOR e que nao enxergava, e 1 saiu junto com um teste reescrito noutro item.
//
// O caso medido esta em `pages/promptly/catalogo.test.tsx`: tres asserções perguntam por
// `/\d+ neste workspace/i` e o caso positivo afirma `/3 neste workspace/i`. O arquivo DISCRIMINA —
// apague o elemento da contagem e o caso positivo reprova — mas o core lido do primeiro caractere
// era `\d+ neste workspac`, que literal nenhum contem. Agora o core e o maior trecho SEM
// metacaractere, porque so os trechos literais de uma regex e que casam com texto.
//
// A mudanca foi provada por mutacao (3 mutantes, 3 mortos): sempre-ancorar reprova 3 casos, usar o
// menor trecho reprova 4, e splitar tambem strings citadas reprova 2. Um detector afrouxado passa
// nos tres.
// 91 desde 2026-08-12 (B-242): ONZE asserções ancoradas, cada uma provada por mutação — a produção
// foi quebrada e o caso NOVO ficou vermelho enquanto a asserção de ausência antiga seguia verde.
// Essa segunda metade é o achado: em nenhum dos onze a asserção de ausência reprovou sozinha, que
// é exatamente o que "não pode falhar" quer dizer.
//
//   datasets            "No items"                        — um dataset que carrega com zero itens
//   memories            "hasn't stored any memories"      — a DESCRIÇÃO, não só o título
//   log-viewer          "No lines match"                  — a busca é dirigível; o comentário do
//                                                           próprio caso dizia que não era
//   deployments         "No deployments yet"              — projeto com zero builds
//   live-url-hero       "No production deploy yet — …"    — a cópia padrão, ao lado do título
//   trust/overview × 2  heading "Violations by policy"    — o arquivo só nomeava a TABELA
//   monitors            "No evaluators — create one first" — leitura que dá certo com zero linhas
//   billing × 3         "Fast Data Transfer" / "Edge Requests" / "Concurrent Builds"
//
// DUAS LIÇÕES MEDIDAS, as duas contra mim:
//
//   1. O caso do billing primeiro afirmava os três rótulos num `for` sobre um array. O detector lê
//      o SELETOR, e um seletor que é variável não tem literal para casar: os três continuaram
//      contados como desancorados. Escrevê-los por extenso é o que fez o par existir.
//   2. O caso novo do log-viewer NASCEU com uma asserção de ausência desancorada (`/oops/`), e
//      quem apontou foi esta catraca. Corrigido afirmando a linha PRESENTE antes de filtrar.
//
// E um defeito de produção que só a mutação revelou: a regra que deriva o rótulo da chave de
// billing existe DUAS VEZES (`billing.tsx:193` e `:315`), então mutar uma sobrevivia. Registrado
// como B-277 em vez de corrigido aqui — é outro item, com outra evidência.
const CEILING_UNANCHORED = 91;

/** Files holding at least one absence assertion. Frozen 2026-08-11, remeasured 2026-08-12. */
const CEILING_FILES = 98;

/**
 * The corpus may not shrink silently.
 *
 * The B-235 ratchet had no floor, and skipping one directory took its count from 37 to 4 with every
 * case green — including the self-tests. A ratchet that cannot tell "fixed" from "stopped looking"
 * is a number, not a guard. Set below today's 376 so adding tests is never blocked and deleting a
 * swathe of them is.
 */
const TEST_FILE_FLOOR = 360;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'vendor') testFiles(full, out);
    } else if (/\.test\.tsx?$/.test(entry) && entry !== SELF) {
      // This file quotes the forms as literals in its self-tests; counting itself would be noise.
      out.push(full);
    }
  }
  return out;
}

function corpus(): { rel: string; source: string }[] {
  return testFiles(SRC).map((f) => ({
    rel: relative(SRC, f).replace(/\\/g, '/'),
    source: readFileSync(f, 'utf-8'),
  }));
}

function unanchored(): string[] {
  return corpus()
    .flatMap((a) => unanchoredIn(a.rel, a.source))
    .map((a) => `${a.file}:${String(a.line)}`)
    .sort();
}

function filesWithAbsenceAssertions(): string[] {
  return corpus()
    .filter((a) => absenceAssertionsIn(a.rel, a.source).length > 0)
    .map((a) => a.rel)
    .sort();
}

describe('ratchet on UNANCHORED absence assertions (B-242)', () => {
  it('the number only goes down — a new assertion is born anchored', () => {
    const loose = unanchored();

    expect(
      loose.length,
      `\nAbsence assertions whose selector is never asserted present in the file: ` +
        `${String(loose.length)} (ceiling ${String(CEILING_UNANCHORED)}).\n\n` +
        `${loose.slice(0, 10).join('\n')}\n\n` +
        'If it WENT UP: a new assertion queries something no case in the file ever shows, so it is\n' +
        'satisfied by the right behaviour and by the defect alike. Anchor it: assert the SAME\n' +
        'selector present in the case that renders it.\n\n' +
        'If it WENT DOWN: that is progress, and the ceiling above should follow.\n',
    ).toBeLessThanOrEqual(CEILING_UNANCHORED);
  });

  it('the ceiling matches disk', () => {
    expect(unanchored().length).toBe(CEILING_UNANCHORED);
  });

  it('the CORPUS does not shrink — the number cannot fall by looking away', () => {
    expect(corpus().length).toBeGreaterThanOrEqual(TEST_FILE_FLOOR);
  });
});

describe('ratchet on FILES using the form (F4)', () => {
  // Why both survive: the per-file count stops a NEW file slipping in unnoticed; the per-assertion
  // count measures what is actually left to fix. Anchoring an assertion does not remove its file
  // from the first count, so without the second a whole day of legitimate fixes reports as zero.

  it('the population does not grow', () => {
    const files = filesWithAbsenceAssertions();
    expect(
      files.length,
      `Files using \`expect(queryBy…)\` to assert absence: ${String(files.length)} ` +
        `(ceiling ${String(CEILING_FILES)}).\n`,
    ).toBeLessThanOrEqual(CEILING_FILES);
  });

  it('the ceiling matches disk — no slack to grow into', () => {
    expect(filesWithAbsenceAssertions().length).toBe(CEILING_FILES);
  });
});

describe('the detector, exercised — not a copy of it', () => {
  // The previous self-test re-implemented the anchor rule on a string literal and checked its own
  // copy. Widening `(?:get|find)` to `(?:get|find|query)` in the real detector took the corpus
  // count from 116 to 15 and all six cases stayed green. These call the SAME functions the ratchet
  // uses, so gutting the detector turns them red.

  const absence = "expect(screen.queryByText(/nothing here/i)).toBeNull();";

  it('flags an absence assertion with no anchor', () => {
    expect(unanchoredIn('x.test.ts', absence)).toHaveLength(1);
  });

  it('does NOT flag one anchored by a findBy on the same selector', () => {
    const source = "expect(await screen.findByText(/nothing here/i)).toBeInTheDocument();\n" + absence;
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(1);
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(0);
  });

  it('does NOT accept a bare `queryBy` as an anchor — that is the mutation that gutted it', () => {
    // Reading a node is not asserting it is there. Accepting this took 116 to 15.
    const source = "const el = screen.queryByText(/nothing here/i);\n" + absence;
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(1);
  });

  it('DOES accept a `queryBy` used to assert PRESENCE', () => {
    const source =
      "expect(screen.queryByText(/nothing here/i)).toBeInTheDocument();\n" + absence;
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(0);
  });

  it('a bare read is not an assertion at all', () => {
    // 27 of 336 occurrences were reads like this; the previous detector counted every one.
    expect(absenceAssertionsIn('x.test.ts', "const el = screen.queryByRole('table');")).toHaveLength(0);
  });

  it('an assertion that exists only inside a COMMENT is not counted', () => {
    const source = ['// ' + absence, '/* ' + absence + ' */'].join('\n');
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(0);
  });

  it('reads a selector whose arguments contain a nested call', () => {
    // `[^)]*?` stopped at the first `)`, so this selector's core was never seen.
    const source = "expect(screen.queryByRole('row', { name: new RegExp(label) })).toBeNull();";
    const found = absenceAssertionsIn('x.test.ts', source);
    expect(found).toHaveLength(1);
    expect(found[0].selector).toContain('new RegExp(label)');
  });

  it('reads the multi-line form, where a comma sits before the closing `expect(`', () => {
    // My own undercount. Requiring the matcher to follow the query's `)` missed this shape and
    // silently dropped one file; only the per-file ceiling disagreeing by one made it visible.
    const source = [
      'expect(',
      '  screen.queryByText(/nothing here/i),',
      ').not.toBeInTheDocument();',
    ].join('\n');

    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(1);
  });

  it('an anchor on a DIFFERENT query kind does not count', () => {
    // `getByTestId('nothing here')` does not prove `queryByText(/nothing here/)` can fail.
    const source = "expect(screen.getByTestId('nothing here')).toBeInTheDocument();\n" + absence;
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(1);
  });

  it('a matcher on a DIFFERENT value does not make this query an assertion', () => {
    // Review found the detector also carried an `expect(`-proximity check that no fixture could
    // discriminate: deleting it left every case green, because `.toBeNull()` exists only on an
    // `expect()` result, so the matcher already implies the wrapper. The check was deleted rather
    // than shipped with a test that cannot fail; this case pins what actually does the work — the
    // matcher must follow THIS query's closing paren, not appear somewhere later in the file.
    const source = 'const maybe = screen.queryByText(/nothing here/i);\nexpect(other).toBeNull();';
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(0);
  });

  it('an argument-less `queryBy…()` is skipped rather than counted with an empty selector', () => {
    // LOW from review: the `selector !== ''` filter was unexercised. An empty selector has no
    // core, so it can never be anchored — counting it would inflate the ceiling with a call that
    // says nothing about the defect.
    const source = 'expect(screen.queryByText()).toBeNull();';
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(0);
  });

  it('a matcher chain that does NOT start at `expect(` is not an assertion', () => {
    // The text version carried an equivalent check that no fixture could discriminate — a matcher
    // implies `expect()` in valid code — so it was deleted rather than shipped unexercised. On the
    // tree the wrapper is not implied, it is REQUIRED: the walk starts at the matcher and must
    // arrive at a call to `expect`. That makes the check meaningful and this fixture possible.
    const source = "assertThat(screen.queryByText(/nothing here/i)).toBeNull();";
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(0);
  });

  it('sees an assertion carrying a custom failure message (B-269)', () => {
    // `expect(x, 'why this matters')` — the matcher does not follow the query's closing paren, so
    // the text reading dropped it. Live in `pages/lens/monitors.test.tsx:389`.
    const source = "expect(screen.queryByText(/nothing here/i), 'the reason').not.toBeInTheDocument();";
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(1);
  });

  it('sees a selector whose regex literal contains an APOSTROPHE (B-269)', () => {
    // The hand-rolled counter treated `'` as opening a string and then skipped the parens it had
    // to balance. Live in `pages/memory/memories.test.tsx:75`. To a parser a regex literal is one
    // token, so nothing inside it is syntax.
    const source = "expect(screen.queryByText(/hasn't stored any memories/i)).not.toBeInTheDocument();";
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(1);
  });

  it('`selectorCore` needs 4 characters, so short noise is not an anchor', () => {
    expect(selectorCore("/nothing here/i")).toBe('nothing here');
    expect(selectorCore("'ab'")).toBeNull();
  });

  it('a regex core is its longest LITERAL run, so a quantifier does not hide the anchor', () => {
    // Measured on `pages/promptly/catalogo.test.tsx`: the absence assertions query
    // `/\d+ neste workspace/i` and the presence case asserts `/3 neste workspace/i`. The file
    // DISCRIMINATES — delete the count element and the presence case fails — but a core taken
    // from the first character onwards is `\d+ neste workspac`, which no literal ever contains.
    //
    // What anchors an absence assertion is that the same TEXT was proven renderable, and only a
    // regex's literal segments ever match text. So the core is the longest run with no
    // metacharacter in it.
    expect(selectorCore(String.raw`/\d+ neste workspace/i`)).toBe(' neste workspace');
    expect(selectorCore(String.raw`/^Deploy \d+$/`)).toBe('Deploy ');
    // A selector that is ALL metacharacters anchors nothing, and must not anchor everything.
    expect(selectorCore(String.raw`/\d+/`)).toBeNull();
    // In a QUOTED string a dot is literal text, so splitting there would discard specificity the
    // selector really has. Only a regex gets split.
    expect(selectorCore("'Save changes.'")).toBe('Save changes.');
  });

  it('an absence assertion is anchored by a presence case sharing its literal run', () => {
    const source = [
      `it('a', async () => { expect(await screen.findByText(/3 neste workspace/i)).toBeInTheDocument(); });`,
      `it('b', () => { expect(screen.queryByText(/\\d+ neste workspace/i)).not.toBeInTheDocument(); });`,
    ].join('\n');
    expect(unanchoredIn('x.test.tsx', source)).toHaveLength(0);
  });

  it('a never-leak assertion stays unanchored, and the reason is recorded not fixed', () => {
    // The SECOND discriminating shape, which the presence rule cannot express. Nothing on the
    // recovery screen may ever render the word `kratos`, so there is no positive case to point
    // at — yet the assertion can still fail, because the mocked upstream error contains the word.
    // Delete the message mapping and the raw text renders.
    //
    // It is still counted here, and that is a decision. The rule that would clear it — anchor an
    // absence assertion when any string literal in the file contains its core — was implemented
    // and MEASURED before being rejected: it moved 50 of the 102 assertions at once and broke the
    // query-kind invariant the case below protects (fixture text has no kind, so a `queryByRole`
    // absence would be anchored by an unrelated `getByText` string). Fifty is not a population of
    // never-leak assertions; it is a rule that anchors almost everything.
    //
    // Registered as B-276. Until it has a rule that discriminates, the honest number counts them.
    const source = [
      "mockSubmitFlow.mockRejectedValueOnce(new Error('kratos credential method failed'));",
      'expect(screen.queryByText(/kratos/i)).not.toBeInTheDocument();',
    ].join('\n');
    expect(unanchoredIn('x.test.tsx', source)).toHaveLength(1);
  });

  it('recognises the absence matchers, and only those', () => {
    for (const form of [
      `expect(screen.queryByRole('table')).toBeNull();`,
      `expect(screen.queryByText(/xxxx/)).not.toBeInTheDocument();`,
      `expect(within(card).queryByLabelText('yyyy')).toBeNull();`,
      `expect(screen.queryByTestId('zzzz')).toBeFalsy();`,
    ]) {
      expect(absenceAssertionsIn('x.test.ts', form), `should have flagged: ${form}`).toHaveLength(1);
    }
    for (const benign of [
      `expect(screen.getByRole('table')).toBeInTheDocument();`,
      `const el = screen.queryByRole('table');`,
      `await screen.findByText(/xxxx/);`,
    ]) {
      expect(absenceAssertionsIn('x.test.ts', benign), `should NOT have flagged: ${benign}`).toHaveLength(0);
    }
  });
});
